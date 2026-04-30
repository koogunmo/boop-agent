import { api } from "@boop/convex";
import type { BroadcastFn } from "@boop/shared/events";
import { tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { getServerByName } from "partyserver";
import { z } from "zod";
import { randomId } from "@/memory/types";

interface SpawnToolDeps {
  convex: ConvexHttpClient;
  env: Env;
  conversationId: string;
  broadcast: BroadcastFn;
}

export function createSpawnTools(deps: SpawnToolDeps) {
  const { convex, env, conversationId, broadcast } = deps;

  return {
    spawn_agent: tool({
      description:
        "Spawn a focused sub-agent to do real work using external tools. Returns the agent's final answer. Use for anything requiring lookups, drafting, or actions in the user's integrations.",
      inputSchema: z.object({
        task: z
          .string()
          .describe("Crisp task description — what to find/draft/do, not the raw user message."),
        integrations: z.array(z.string()).describe("Which integrations to give the agent."),
        name: z.string().optional().describe("Short label for the agent."),
        toolHint: z
          .string()
          .optional()
          .describe(
            "2-4 keyword hint for selecting the right integration tools, e.g. 'fetch emails', 'send message', 'list calendar events'. Helps the agent load only relevant tools instead of the full toolkit.",
          ),
      }),
      execute: async (args) => {
        const agentId = randomId("agent");
        const name = args.name ?? (args.integrations.join("+") || "general");

        await convex.mutation(api.agents.create, {
          agentId,
          conversationId,
          name,
          task: args.task,
          mcpServers: args.integrations,
        });
        broadcast("agent_spawned", { agentId, name, task: args.task });

        const stub = await getServerByName(env.EXEC_AGENT, agentId);
        const res = await stub.fetch("http://agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: args.task,
            integrations: args.integrations,
            conversationId,
            name,
            agentId,
            toolHint: args.toolHint,
          }),
        });

        const result = (await res.json()) as {
          agentId: string;
          result: string;
          status: "completed" | "failed";
        };

        broadcast("agent_done", {
          agentId,
          status: result.status,
          result: result.result.slice(0, 200),
        });

        return result.result;
      },
    }),
  };
}
