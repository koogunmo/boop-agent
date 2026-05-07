import { api } from "@boop/convex";
import type { BroadcastFn } from "@boop/shared/events";
import type { ConvexHttpClient } from "convex/browser";
import { embed, embeddingsAvailable } from "@/lib/embeddings";

let running = false;

export async function getEmbeddingStatus(
  convex: ConvexHttpClient,
  env: Env,
): Promise<{
  total: number;
  withEmbedding: number;
  withoutEmbedding: number;
  truncated: boolean;
  running: boolean;
  provider: string;
}> {
  const stats = await convex.query(api.memoryRecords.embeddingStats, {});
  return {
    ...stats,
    running,
    provider: embeddingsAvailable(env) ? "workers-ai" : "none",
  };
}

export async function reembed(
  convex: ConvexHttpClient,
  env: Env,
  broadcast: BroadcastFn,
): Promise<{ embedded: number; failed: number }> {
  let embedded = 0;
  let failed = 0;
  const attempted = new Set<string>();
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const result: {
      page: Array<{ memoryId: string; content: string }>;
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.memoryRecords.listUnembeddedPage, {
      cursor,
      pageSize: 50,
    });
    cursor = result.continueCursor;
    isDone = result.isDone;

    const fresh = result.page.filter((row) => {
      if (attempted.has(row.memoryId)) return false;
      attempted.add(row.memoryId);
      return true;
    });

    const BATCH = 5;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const batch = fresh.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (row) => {
          const vec = await embed(env, row.content);
          return { row, vec };
        }),
      );
      for (const { row, vec } of results) {
        if (!vec) {
          failed++;
        } else {
          await convex.mutation(api.memoryRecords.setEmbedding, {
            memoryId: row.memoryId,
            embedding: vec,
          });
          embedded++;
        }
        broadcast("memory.reembed.progress", {
          embedded,
          failed,
          memoryId: row.memoryId,
        });
      }
    }
  }

  broadcast("memory.reembed.done", { embedded, failed });
  return { embedded, failed };
}

export function startReembed(
  convex: ConvexHttpClient,
  env: Env,
  broadcast: BroadcastFn,
): { started: boolean; error?: string } {
  if (running) {
    return { started: false, error: "re-embed already in progress" };
  }
  running = true;
  reembed(convex, env, broadcast)
    .catch((err) => {
      console.error("[reembed]", err);
      broadcast("memory.reembed.done", { embedded: 0, failed: 0 });
    })
    .finally(() => {
      running = false;
    });
  return { started: true };
}
