import { tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { embed, embeddingsAvailable } from "@/lib/embeddings";
import type { MemorySegment, MemoryTier } from "@/memory/types";
import { DEFAULT_DECAY, makeMemoryId, SEGMENT_DEFAULTS } from "@/memory/types";
import { api } from "../../convex/_generated/api";

const tierEnum = z.enum(["short", "long", "permanent"]);
const segmentEnum = z.enum([
  "identity",
  "preference",
  "correction",
  "relationship",
  "project",
  "knowledge",
  "context",
]);

interface MemoryToolDeps {
  convex: ConvexHttpClient;
  env: Env;
  conversationId: string;
}

export function createMemoryTools(deps: MemoryToolDeps) {
  const { convex, env, conversationId } = deps;

  return {
    write_memory: tool({
      description:
        "Persist a fact about the user or conversation that you want available in future turns. Prefer aggressive writing — memory is cheap, forgetting is expensive. Only use for durable facts (preferences, identity, projects, relationships), NOT for transient conversational state.",
      inputSchema: z.object({
        content: z.string().describe("The fact to remember, in one clear sentence."),
        segment: segmentEnum.describe(
          "identity: core facts about who they are. preference: how they like things done. correction: corrections the user made. relationship: people they know. project: ongoing work. knowledge: facts about their world. context: current situation.",
        ),
        importance: z.number().min(0).max(1).describe("0-1; how critical to retain."),
        tier: tierEnum.optional().describe("Override; defaults by segment."),
        supersedes: z
          .array(z.string())
          .optional()
          .describe("memoryId(s) this replaces (will be archived)."),
      }),
      execute: async (args) => {
        const tier: MemoryTier = args.tier ?? SEGMENT_DEFAULTS[args.segment as MemorySegment].tier;
        const memoryId = makeMemoryId();
        const vec = await embed(env, args.content);
        await convex.mutation(api.memoryRecords.upsert, {
          memoryId,
          content: args.content,
          tier,
          segment: args.segment,
          importance: args.importance,
          decayRate: DEFAULT_DECAY[tier],
          ...(args.supersedes ? { supersedes: args.supersedes } : {}),
          ...(vec ? { embedding: vec } : {}),
        });
        await convex.mutation(api.memoryEvents.emit, {
          eventType: "memory.written",
          conversationId,
          memoryId,
          data: JSON.stringify({
            tier,
            segment: args.segment,
            importance: args.importance,
          }),
        });
        return `Stored ${memoryId} (tier=${tier}, segment=${args.segment}).`;
      },
    }),

    recall: tool({
      description:
        "Search your memories for anything relevant to the current turn. Call this early in any conversation that touches the user's preferences, projects, or past decisions.",
      inputSchema: z.object({
        query: z.string().describe("Keywords or topic to search for."),
        limit: z.number().optional().default(10),
      }),
      execute: async (args) => {
        let results: Array<{
          memoryId: string;
          tier: string;
          segment: string;
          importance: number;
          content: string;
        }> = [];
        let mode: "vector" | "substring" = "substring";

        if (embeddingsAvailable(env)) {
          const queryVec = await embed(env, args.query);
          if (queryVec) {
            const hits = await convex.action(api.memoryRecords.vectorSearch, {
              embedding: queryVec,
              limit: args.limit,
            });
            results = hits.map((h: { record: (typeof results)[number] }) => h.record);
            mode = "vector";
          }
        }

        if (results.length === 0) {
          results = await convex.query(api.memoryRecords.search, {
            query: args.query,
            limit: args.limit,
          });
        }

        for (const r of results) {
          await convex.mutation(api.memoryRecords.markAccessed, {
            memoryId: r.memoryId,
          });
        }

        await convex.mutation(api.memoryEvents.emit, {
          eventType: "memory.recalled",
          conversationId,
          data: JSON.stringify({
            query: args.query,
            hits: results.length,
            mode,
          }),
        });

        if (results.length === 0) {
          return "No memories matched.";
        }

        return results
          .map(
            (r) =>
              `• [${r.tier}/${r.segment} importance=${r.importance.toFixed(2)}] ${r.memoryId}: ${r.content}`,
          )
          .join("\n");
      },
    }),
  };
}
