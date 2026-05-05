import { api } from "@boop/convex";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { Agent } from "agents";
import { stepCountIs, streamText } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { getServerByName } from "partyserver";
import { z } from "zod";
import { createComposioClient } from "@/lib/composio";
import { buildComposioTools } from "@/lib/composio-tools";
import { createProvider, gatewayMetadataHeader } from "@/lib/llm";
import { extractAccounts, serializeToolResult, type ToolCallLogger } from "@/lib/tool-logger";
import { createWebTools } from "@/lib/web-tools";
import { createDateTimeTool } from "@/tools/datetime";
import { createDraftStagingTools } from "@/tools/drafts";

const EXECUTION_SYSTEM = `You are a focused background worker for the user.

Your job:
1. Perform the task you were given, end to end.
2. Use your tools — web_search, web_fetch, and any integrations loaded for this spawn — to investigate and act.
3. Return a concise, well-structured answer — not a data dump.

Research discipline:
- Prefer web_search for fresh/factual questions. web_fetch when you need the content of a known URL.
- Cite real URLs only — NEVER invent sources. If a page failed to load, say so.
- If web_search returns a direct answer (answerBox, knowledgeGraph, featured snippet), trust it and stop. Don't fetch extra pages to verify Google's own answer.
- Cross-check only when the answer comes from regular search results and the claim is ambiguous or contested.

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
  toolHint: z.string().optional(),
});

export class BoopExecutionAgent extends Agent<Env> {
  private abortController: AbortController | null = null;
  private _convex: ConvexHttpClient | null = null;

  private get convex(): ConvexHttpClient {
    this._convex ??= new ConvexHttpClient(this.env.CONVEX_URL);
    return this._convex;
  }

  onRequest(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/run" && request.method === "POST") {
      return this.handleRun(request);
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

  private async handleRun(request: Request): Promise<Response> {
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

  private async buildIntegrationTools(
    integrations: string[],
    logger: ToolCallLogger,
    toolHint?: string,
  ): Promise<Record<string, Awaited<ReturnType<typeof buildComposioTools>>[string]>> {
    if (integrations.length === 0) return {};
    const client = createComposioClient(this.env);
    if (!client) {
      console.warn("[exec] Composio not configured, skipping integration tools");
      return {};
    }
    return buildComposioTools(client, integrations, logger, toolHint);
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
    const shortId = agentId.slice(-6);
    const log = (msg: string) => console.log(`[agent ${shortId}] ${msg}`);

    const taskPreview = task.length > 120 ? `${task.slice(0, 120)}…` : task;
    const hintStr = opts.toolHint ? ` hint="${opts.toolHint}"` : "";
    log(
      `spawn: ${name} [${integrations.join(", ") || "no integrations"}]${hintStr} — ${JSON.stringify(taskPreview)}`,
    );

    await convex.mutation(api.agents.update, { agentId, status: "running" });

    const interactionStub = await getServerByName(this.env.BOOP_AGENT, conversationId);

    function broadcastEvent(event: string, data: Record<string, unknown>) {
      interactionStub
        .fetch("http://agent/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, data }),
        })
        .catch(() => {});
    }

    const logger: ToolCallLogger = {
      async onToolCall(toolName, args) {
        const accounts = extractAccounts(args);
        const acctSuffix = accounts.length ? ` [${accounts.join(", ")}]` : "";
        log(`tool: ${toolName}${acctSuffix}`);
        await convex.mutation(api.agents.addLog, {
          agentId,
          logType: "tool_use",
          toolName,
          ...(accounts.length ? { accounts } : {}),
          content: JSON.stringify(args).slice(0, 2000),
        });
        broadcastEvent("agent_tool", { agentId, toolName });
      },
      async onToolResult(toolName, result) {
        await convex.mutation(api.agents.addLog, {
          agentId,
          logType: "tool_result",
          toolName,
          content: serializeToolResult(result),
        });
      },
    };

    const provider = createProvider(this.env);
    const webTools = createWebTools(this.env, logger);
    const draftTools = createDraftStagingTools({ convex, conversationId, logger });
    const integrationTools = await this.buildIntegrationTools(integrations, logger, opts.toolHint);

    const allTools = {
      ...webTools,
      ...draftTools,
      ...integrationTools,
      ...createDateTimeTool(),
    };

    let buffer = "";
    let status: "completed" | "failed" | "cancelled" = "completed";
    let errorMsg: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const executor = new DynamicWorkerExecutor({
        loader: this.env.LOADER,
        timeout: 60000,
      });

      const codemode = createCodeTool({
        tools: allTools,
        executor,
      });

      const stream = streamText({
        model: provider(this.env.MODEL_EXECUTOR),
        system: EXECUTION_SYSTEM,
        prompt: task,
        tools: { codemode },
        stopWhen: stepCountIs(5),
        headers: gatewayMetadataHeader({ source: "execution", agentId, conversationId }),
        ...(this.abortController ? { abortSignal: this.abortController.signal } : {}),
        onChunk: async ({ chunk }) => {
          if (chunk.type === "text-delta") {
            buffer += chunk.text;
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "text",
              content: chunk.text,
            });
          } else if (chunk.type === "tool-call") {
            const accounts = extractAccounts(chunk.input);
            log(`codemode: ${chunk.toolName}${accounts.length ? ` [${accounts.join(", ")}]` : ""}`);
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "tool_use",
              toolName: chunk.toolName,
              ...(accounts.length ? { accounts } : {}),
              content: JSON.stringify(chunk.input).slice(0, 2000),
            });
          } else if (chunk.type === "tool-result") {
            await convex.mutation(api.agents.addLog, {
              agentId,
              logType: "tool_result",
              content: serializeToolResult(chunk.output),
            });
          }
        },
        onFinish: async ({ usage }) => {
          inputTokens = usage.inputTokens ?? 0;
          outputTokens = usage.outputTokens ?? 0;
        },
      });

      await stream.consumeStream();
      buffer = await stream.text;
    } catch (err) {
      status = this.abortController?.signal.aborted ? "cancelled" : "failed";
      if (err instanceof Error) {
        const parts = [err.message];
        const statusCode =
          "statusCode" in err ? (err as { statusCode: number }).statusCode : undefined;
        const url = "url" in err ? (err as { url: string }).url : undefined;
        const responseBody =
          "responseBody" in err ? (err as { responseBody: string }).responseBody : undefined;
        if (statusCode) parts.push(`status=${statusCode}`);
        if (url) parts.push(`url=${url}`);
        if (responseBody) parts.push(`body=${responseBody}`);
        errorMsg = parts.join(" | ");
      } else {
        errorMsg = String(err);
      }
      await convex.mutation(api.agents.addLog, {
        agentId,
        logType: "error",
        content: errorMsg.slice(0, 2000),
      });
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    log(`done (${status}, ${elapsed}s, in/out ${inputTokens}/${outputTokens})`);

    await convex.mutation(api.agents.update, {
      agentId,
      status,
      result: buffer,
      ...(errorMsg ? { error: errorMsg } : {}),
      inputTokens,
      outputTokens,
    });

    if (inputTokens > 0 || outputTokens > 0) {
      await convex.mutation(api.usageRecords.record, {
        source: "execution",
        conversationId,
        agentId,
        model: this.env.MODEL_EXECUTOR,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
      });
    }

    broadcastEvent("agent_done", {
      agentId,
      status,
      result: buffer.slice(0, 200),
    });

    return { agentId, result: buffer || errorMsg || "(no output)", status };
  }
}
