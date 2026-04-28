import { tool } from "ai";
import { z } from "zod";

export function createSpawnTools() {
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
      }),
      execute: async () => {
        return "Execution agents not yet available (Phase 3).";
      },
    }),
  };
}
