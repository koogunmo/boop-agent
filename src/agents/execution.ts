import { DurableObject } from "cloudflare:workers";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { generateText, stepCountIs } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { createProvider } from "../lib/llm";
import { createWebTools } from "../lib/web-tools";
import { createDraftStagingTools } from "../tools/drafts";

const EXECUTION_SYSTEM = `You are a focused background worker for the user.

Your job:
1. Perform the task you were given, end to end.
2. Use your tools — web_search, web_fetch, and any integrations loaded for this spawn — to investigate and act.
3. Return a concise, well-structured answer — not a data dump.

Research discipline:
- Prefer web_search for fresh/factual questions. web_fetch when you need the content of a known URL.
- Cite real URLs only — NEVER invent sources. If a page failed to load, say so.
- Cross-check when it matters: one search is rarely enough for a claim.

MANDATORY: for any task that used web_search or web_fetch, end your response with
a "Sources:" section listing the ACTUAL URLs you fetched or found. Example:

  Sources:
  - https://www.lonelyplanet.com/japan/tokyo
  - https://www.japan-guide.com/e/e3008.html

No URLs = no sources section. Never write vague names like "Lonely Planet" or
"official guide" without the specific URL. The interaction agent relays your
output to the user verbatim, so if you don't include URLs, the user won't see
any.

Style:
- Optimize for iMessage delivery: short sentences, bullets over paragraphs, no tables.
- Prefer markdown with **bold** keywords and • bullets.
- Under 500 words unless explicitly asked for more.
- If you can't complete something, say why in one sentence.

Safety:
- Anything that sends a message, creates an event, or takes an external action: call save_draft with a JSON payload instead of the real send/create tool. Return the summary so the interaction agent can show it to the user.
- Only the interaction agent's send_draft tool commits. You never commit.`;

const runTaskSchema = z.object({
  task: z.string().min(1),
  integrations: z.array(z.string()),
  conversationId: z.string().min(1),
  name: z.string().optional(),
  agentId: z.string().min(1),
});

export class BoopExecutionAgent extends DurableObject<Env> {
  private abortController: AbortController | null = null;

  private get convex(): ConvexHttpClient {
    return new ConvexHttpClient(this.env.CONVEX_URL);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/run" && request.method === "POST") {
      const raw: unknown = await request.json();
      const parsed = runTaskSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response("bad request", { status: 400 });
      }
      this.abortController = new AbortController();
      const result = await this.runTask(parsed.data);
      this.abortController = null;
      return Response.json(result);
    }

    if (url.pathname === "/cancel" && request.method === "POST") {
      if (this.abortController) {
        this.abortController.abort();
        return Response.json({ cancelled: true });
      }
      return Response.json({ cancelled: false });
    }

    return new Response("not found", { status: 404 });
  }

  private async buildIntegrationTools(_integrations: string[]): Promise<Record<string, never>> {
    // Phase 4: dynamically build Composio tools per integration slug.
    // Each integration in the array maps to a Composio toolkit session
    // whose tools get converted to AI SDK tools.
    return {};
  }

  private async runTask(opts: z.infer<typeof runTaskSchema>): Promise<{
    agentId: string;
    result: string;
    status: "completed" | "failed" | "cancelled";
  }> {
    const { task, integrations, conversationId, agentId } = opts;
    const name = opts.name ?? (integrations.join("+") || "general");
    const convex = this.convex;
    const started = Date.now();

    await convex.mutation(api.agents.update, { agentId, status: "running" });

    const provider = createProvider(this.env);
    const webTools = createWebTools(this.env);
    const draftTools = createDraftStagingTools({ convex, conversationId });

    // Build tool set dynamically per spawn.
    // Web + draft tools are always available.
    // Integration tools (Composio) will be added per-integration in Phase 4.
    const integrationTools = await this.buildIntegrationTools(integrations);
    const allTools = {
      ...webTools,
      ...draftTools,
      ...integrationTools,
    };

    let buffer = "";
    let status: "completed" | "failed" | "cancelled" = "completed";
    let errorMsg: string | undefined;

    try {
      const executor = new DynamicWorkerExecutor({
        loader: this.env.LOADER,
        timeout: 60000,
        globalOutbound: null,
      });

      const codemode = createCodeTool({
        tools: allTools,
        executor,
      });

      const result = await generateText({
        model: provider(this.env.MODEL_EXECUTOR),
        system: EXECUTION_SYSTEM,
        prompt: task,
        tools: { codemode },
        stopWhen: stepCountIs(5),
        ...(this.abortController ? { abortSignal: this.abortController.signal } : {}),
        onStepFinish: async (step) => {
          const interactionId = this.env.BOOP_AGENT.idFromName(conversationId);
          const interactionStub = this.env.BOOP_AGENT.get(interactionId);

          for (const toolCall of step.toolCalls) {
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "tool_use",
              toolName: toolCall.toolName,
              content: JSON.stringify(toolCall.input).slice(0, 2000),
            });
            interactionStub
              .fetch("http://agent/broadcast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  event: "agent_tool",
                  data: { agentId, toolName: toolCall.toolName },
                }),
              })
              .catch(() => {});
          }
          for (const toolResult of step.toolResults) {
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "tool_result",
              content: String(toolResult.output).slice(0, 2000),
            });
          }
        },
      });

      buffer = result.text;

      if (buffer) {
        await convex.mutation(api.agents.addLog, {
          agentId,
          logType: "text",
          content: buffer.slice(0, 2000),
        });
      }

      if (result.usage) {
        await convex.mutation(api.usageRecords.record, {
          source: "execution",
          conversationId,
          agentId,
          model: this.env.MODEL_EXECUTOR,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
          durationMs: Date.now() - started,
        });
      }
    } catch (err) {
      status = this.abortController?.signal.aborted ? "cancelled" : "failed";
      errorMsg = String(err);
      await convex.mutation(api.agents.addLog, {
        agentId,
        logType: "error",
        content: errorMsg.slice(0, 2000),
      });
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[agent ${agentId.slice(-6)} ${name}] done (${status}, ${elapsed}s)`);

    await convex.mutation(api.agents.update, {
      agentId,
      status,
      result: buffer,
      ...(errorMsg ? { error: errorMsg } : {}),
    });

    return { agentId, result: buffer || errorMsg || "(no output)", status };
  }
}
