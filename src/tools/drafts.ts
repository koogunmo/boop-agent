import { tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { getServerByName } from "partyserver";
import { z } from "zod";
import type { ToolCallLogger } from "@/lib/tool-logger";
import { randomId } from "@/memory/types";
import { api } from "../../convex/_generated/api";

interface DraftToolDeps {
  convex: ConvexHttpClient;
  conversationId: string;
  env?: Env;
  logger?: ToolCallLogger;
}

export function createDraftStagingTools(deps: DraftToolDeps) {
  const { convex, conversationId, logger } = deps;

  return {
    save_draft: tool({
      description: `Save a draft of an external action (email, calendar event, message, etc.) for the user to review.
ALWAYS call this instead of sending or creating something directly. The user will say "send it" in the next turn to commit.

- summary: one-line description the user will see.
- payload: JSON string with everything needed to execute the draft (provider-specific fields).
- kind: short type tag like "gmail.reply", "gmail.new", "gcal.event", "slack.message".`,
      inputSchema: z.object({
        kind: z.string(),
        summary: z.string(),
        payload: z.string().describe("JSON string with the data needed to execute."),
      }),
      execute: async (args) => {
        await logger?.onToolCall("save_draft", args);
        const draftId = randomId("draft");
        await convex.mutation(api.drafts.create, {
          draftId,
          conversationId,
          kind: args.kind,
          summary: args.summary,
          payload: args.payload,
        });
        const result = `Draft saved as ${draftId}. Surface the summary to the user and ask them to confirm "send" or "cancel".`;
        await logger?.onToolResult("save_draft", result);
        return result;
      },
    }),
  };
}

export function createDraftDecisionTools(deps: DraftToolDeps) {
  const { convex, conversationId } = deps;

  return {
    list_drafts: tool({
      description:
        "List pending drafts in this conversation. Call this when the user says 'send it', 'yes', 'go ahead', etc. without a specific id.",
      inputSchema: z.object({}),
      execute: async () => {
        const drafts = await convex.query(api.drafts.pendingByConversation, {
          conversationId,
        });
        if (drafts.length === 0) {
          return "No pending drafts.";
        }
        return drafts
          .map(
            (d: { draftId: string; kind: string; summary: string }) =>
              `• [${d.draftId}] (${d.kind}) ${d.summary}`,
          )
          .join("\n");
      },
    }),

    send_draft: tool({
      description:
        "Approve and execute a draft. Spawns an execution agent to actually perform the action based on the stored payload.",
      inputSchema: z.object({
        draftId: z.string(),
        integrations: z.array(z.string()),
      }),
      execute: async (args) => {
        const draft: {
          status: string;
          kind: string;
          summary: string;
          payload: string;
        } | null = await convex.query(api.drafts.get, {
          draftId: args.draftId,
        });

        if (!draft || draft.status !== "pending") {
          return `Draft ${args.draftId} not found or already decided.`;
        }

        await convex.mutation(api.drafts.setStatus, {
          draftId: args.draftId,
          status: "sent",
        });

        if (!deps.env) {
          return `Draft ${args.draftId} marked as sent but execution not available.`;
        }

        const execAgentId = randomId("agent");
        const execTask = `Execute this approved draft. Use the matching integration tool to actually send/create it.\nkind: ${draft.kind}\nsummary: ${draft.summary}\npayload JSON: ${draft.payload}`;

        await convex.mutation(api.agents.create, {
          agentId: execAgentId,
          conversationId,
          name: `send:${draft.kind}`,
          task: execTask,
          mcpServers: args.integrations,
        });

        const stub = await getServerByName(deps.env.EXEC_AGENT, execAgentId);
        const execRes = await stub.fetch("http://agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: execTask,
            integrations: args.integrations,
            conversationId,
            name: `send:${draft.kind}`,
            agentId: execAgentId,
          }),
        });

        if (!execRes.ok) {
          return `Draft ${args.draftId} approved but execution failed.`;
        }

        const execResult = (await execRes.json()) as { result: string };
        return `Draft ${args.draftId} executed.\n\n${execResult.result}`;
      },
    }),

    reject_draft: tool({
      description:
        "Cancel a pending draft when the user says 'no', 'cancel', or revises the request.",
      inputSchema: z.object({
        draftId: z.string(),
      }),
      execute: async (args) => {
        await convex.mutation(api.drafts.setStatus, {
          draftId: args.draftId,
          status: "rejected",
        });
        return `Draft ${args.draftId} rejected.`;
      },
    }),
  };
}
