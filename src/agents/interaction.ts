import { DurableObject } from "cloudflare:workers";
import { ConvexHttpClient } from "convex/browser";
import type OpenAI from "openai";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { createLlmClient } from "../lib/llm";

const INTERACTION_SYSTEM = `You are Boop, a personal agent the user texts from iMessage.

You are a DISPATCHER, not a doer. Your job:
1. Understand what the user wants.
2. Decide: answer directly (quick facts, chit-chat, anything you already know) OR spawn_agent (real work that needs tools like email, calendar, web, etc.).
3. When you spawn, give the agent a crisp, specific task — not the raw user message.
4. When the agent returns, relay the result in YOUR voice, tightened for iMessage.

Tone: Warm, witty, concise. Write like you're texting a friend. No corporate voice. No bullet dumps unless the user asked for a list.

Format: Plain iMessage-friendly text. Markdown sparingly. Keep replies under ~400 chars when you can.`;

const handleRequestSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
});

export class BoopInteractionAgent extends DurableObject<Env> {
  _convex: ConvexHttpClient | null = null;
  _llm: OpenAI | null = null;

  private get convex(): ConvexHttpClient {
    this._convex ??= new ConvexHttpClient(this.env.CONVEX_URL);
    return this._convex;
  }

  private get llm(): OpenAI {
    this._llm ??= createLlmClient(this.env);
    return this._llm;
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

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // inbound messages from dashboard clients — not used yet
  }

  webSocketClose(ws: WebSocket): void {
    ws.close();
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

  private async handleMessage(conversationId: string, content: string): Promise<string> {
    const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const history = await this.convex.query(api.messages.recent, {
      conversationId,
      limit: 10,
    });

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: INTERACTION_SYSTEM },
    ];

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
      const response = await this.llm.chat.completions.create({
        model: this.env.MODEL_DISPATCHER,
        messages,
        max_tokens: 1024,
      });

      const reply = response.choices[0]?.message?.content?.trim() ?? "(no reply)";

      await this.convex.mutation(api.messages.send, {
        conversationId,
        role: "assistant",
        content: reply,
        turnId,
      });

      this.broadcast("assistant_message", { conversationId, content: reply });

      return reply;
    } catch (err) {
      console.error("[interaction] LLM call failed", err);
      return "Sorry — I hit an error processing that. Try again in a moment.";
    }
  }
}
