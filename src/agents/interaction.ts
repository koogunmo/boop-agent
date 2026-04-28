import { DurableObject } from "cloudflare:workers";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { createProvider } from "../lib/llm";
import { cleanMemories } from "../memory/clean";
import { extractAndStore } from "../memory/extract";
import { randomId } from "../memory/types";
import { createAckTools } from "../tools/ack";
import { createAutomationTools } from "../tools/automations";
import { createDraftDecisionTools } from "../tools/drafts";
import { createMemoryTools } from "../tools/memory";
import { createSelfTools } from "../tools/self";
import { createSpawnTools } from "../tools/spawn";

const INTERACTION_SYSTEM = `You are Boop, a personal agent the user texts from iMessage.

You are a DISPATCHER, not a doer. Your job:
1. Understand what the user wants.
2. Decide: answer directly (quick facts, chit-chat, anything you already know) OR spawn_agent (real work that needs tools like email, calendar, web, etc.).
3. When you spawn, give the agent a crisp, specific task — not the raw user message.
4. When the agent returns, relay the result in YOUR voice, tightened for iMessage.

Tone: Warm, witty, concise. Write like you're texting a friend. No corporate voice. No bullet dumps unless the user asked for a list.

Your only tools:
- recall / write_memory (durable memory for this user)
- spawn_agent (dispatches a sub-agent that CAN touch the world — NOT YET AVAILABLE, tell user it's coming soon if they need it)
- create_automation / list_automations / toggle_automation / delete_automation
- list_drafts / send_draft / reject_draft
- get_config / set_model / list_integrations / search_composio_catalog / inspect_toolkit (self-inspection)
- send_ack (send immediate acknowledgment before slow operations)

You cannot answer factual questions from your own knowledge. Not allowed.
You have NO browser, NO WebSearch, NO WebFetch, NO file access, NO APIs.
You are not allowed to recite facts about places, events, people, prices,
news, URLs, statistics, or anything "in the world." Your training data does
not count as a source.

Hard rule: if the user asks for information, research, a lookup, a
recommendation that requires real-world data, a current event, a comparison,
a tutorial, a how-to, any URL, or anything you'd be tempted to "just know" —
spawn_agent. No exceptions. Even if you're 99% sure. If spawn_agent returns
that it's not yet available, tell the user honestly that this capability is
coming soon.

Acknowledgment rule (iMessage UX):
BEFORE every spawn_agent call, you MUST call send_ack first with a short
1-sentence message. The user otherwise sees nothing for 10-30 seconds while
the sub-agent works. Examples of good acks:
  "On it — one sec"
  "Looking into your calendar…"
  "Drafting that email now."
  "Checking Slack, hold tight."
Order: send_ack → spawn_agent → (wait) → final reply with the result.
Skip the ack ONLY for things you'll answer in under 2 seconds (chit-chat,
simple memory recall, single automation toggle).

Memory:
- Call recall() early for anything that might touch the user's preferences, projects, or history.
- Call write_memory() aggressively for durable facts. Err on the side of saving.

Safe to answer directly (no spawn needed):
- Greetings, acknowledgments, short conversational turns ("thanks", "lol", "ok got it").
- Explaining what you just did, confirming a draft, relaying a sub-agent's result.
- Clarifying your own abilities ("yes I can do that", "I'll need your X to proceed").
- Anything that's purely about the user (using recall).

Everything else — SPAWN.

Never fabricate URLs, site names, "sources", statistics, news, quotes, prices,
dates, or any external fact. "Sources: [vague site names]" is fabrication.

When relaying a sub-agent's answer:
- Pass through the Sources section the sub-agent included, VERBATIM. Don't
  add, remove, paraphrase, or summarize URLs.
- If the sub-agent did NOT include a Sources section, YOU DO NOT ADD ONE.
- You may tighten the body for iMessage (shorter bullets, fewer emojis),
  but the URLs are ground truth — don't touch them.

Automations:
- When the user asks for anything recurring ("every morning", "each week", "remind me", "check X daily"), use create_automation — don't just promise to do it later.
- Pick a cron expression (5 fields) and a specific task for the sub-agent.
- If they ask "what have I set up" or want to change/cancel something, use list_automations / toggle_automation / delete_automation.

Drafts:
- Any external action (email, calendar event, Slack message) goes through the draft flow. Execution agents SAVE drafts rather than sending directly.
- When the user confirms ("send it", "yes", "go ahead"), call list_drafts then send_draft with the matching integrations.
- When the user cancels or revises, call reject_draft.
- Never claim something was sent unless send_draft returned success.

Self-inspection (no spawn needed — answer instantly):
- "What model are you running?" → get_config
- "Use opus" / "switch to sonnet" / "make it faster" → set_model (takes effect next turn)
- "What integrations / accounts are connected?" → list_integrations
- "Is there a tool for X?" / "Can you connect to Y?" → search_composio_catalog
- "Is Slack connected?" / "What tools does Notion expose?" → inspect_toolkit
Use these tools when the user asks about Boop's own configuration, connected
accounts, or whether a service is reachable. They're cheap and synchronous —
no ack required.

Format: Plain iMessage-friendly text. Markdown sparingly. Keep replies under ~400 chars when you can.`;

const handleRequestSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
});

export class BoopInteractionAgent extends DurableObject<Env> {
  _convex: ConvexHttpClient | null = null;
  _provider: ReturnType<typeof createProvider> | null = null;

  private get convex(): ConvexHttpClient {
    this._convex ??= new ConvexHttpClient(this.env.CONVEX_URL);
    return this._convex;
  }

  private get provider() {
    this._provider ??= createProvider(this.env);
    return this._provider;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/handle" && request.method === "POST") {
      const raw: unknown = await request.json();
      const parsed = handleRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response("bad request", { status: 400 });
      }
      const reply = await this.handleMessage(parsed.data.conversationId, parsed.data.content);
      return Response.json({ reply });
    }

    return new Response("not found", { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ event: "hello", data: { ok: true }, at: Date.now() }));

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {}

  webSocketClose(ws: WebSocket): void {
    ws.close();
  }

  async alarm(): Promise<void> {
    try {
      const result = await cleanMemories(this.convex);
      console.log(
        `[cleanup] scanned=${result.scanned} archived=${result.archived} pruned=${result.pruned}`,
      );
    } catch (err) {
      console.error("[cleanup] error", err);
    }
    await this.ctx.storage.setAlarm(Date.now() + 6 * 60 * 60 * 1000);
  }

  broadcast(event: string, data: unknown): void {
    const payload = JSON.stringify({ event, data, at: Date.now() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // client disconnected
      }
    }
  }

  private async getRuntimeModel(): Promise<string> {
    try {
      const stored = await this.convex.query(api.settings.get, { key: "model" });
      if (stored && typeof stored === "string") return stored;
    } catch {
      // settings table may be empty
    }
    return this.env.MODEL_DISPATCHER;
  }

  private buildTools(conversationId: string, turnId: string) {
    const deps = {
      convex: this.convex,
      env: this.env,
      conversationId,
      turnId,
      broadcast: this.broadcast.bind(this),
    };
    return {
      ...createMemoryTools(deps),
      ...createAckTools(deps),
      ...createSpawnTools(),
      ...createAutomationTools(deps),
      ...createDraftDecisionTools(deps),
      ...createSelfTools(deps),
    };
  }

  private async handleMessage(conversationId: string, content: string): Promise<string> {
    const turnId = randomId("turn");

    const history = await this.convex.query(api.messages.recent, {
      conversationId,
      limit: 10,
    });

    const messages: ModelMessage[] = [];

    for (const m of history) {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({ role: m.role, content: m.content });
      }
    }

    messages.push({ role: "user", content });

    await this.convex.mutation(api.messages.send, {
      conversationId,
      role: "user",
      content,
      turnId,
    });

    this.broadcast("user_message", { conversationId, content });

    try {
      const tools = this.buildTools(conversationId, turnId);
      const turnStart = Date.now();

      const modelId = await this.getRuntimeModel();
      const result = await generateText({
        model: this.provider(modelId),
        system: INTERACTION_SYSTEM,
        messages,
        tools,
        stopWhen: stepCountIs(10),
      });

      const reply = result.text.trim() || "(no reply)";

      if (result.usage) {
        const durationMs = Date.now() - turnStart;
        await this.convex.mutation(api.usageRecords.record, {
          source: "dispatcher",
          conversationId,
          turnId,
          model: modelId,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
          durationMs,
        });
      }

      await this.convex.mutation(api.messages.send, {
        conversationId,
        role: "assistant",
        content: reply,
        turnId,
      });

      this.broadcast("assistant_message", { conversationId, content: reply });

      extractAndStore({
        env: this.env,
        convex: this.convex,
        conversationId,
        userMessage: content,
        assistantReply: reply,
        turnId,
      }).catch((err) => console.error("[interaction] extraction error", err));

      return reply;
    } catch (err) {
      console.error("[interaction] LLM call failed", err);
      return "Sorry — I hit an error processing that. Try again in a moment.";
    }
  }
}
