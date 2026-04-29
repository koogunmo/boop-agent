import type { ConvexHttpClient } from "convex/browser";
import { ARCHIVE_THRESHOLD, effectiveScore, PRUNE_THRESHOLD } from "@/memory/types";
import { api } from "../../convex/_generated/api";

interface CleanResult {
  scanned: number;
  archived: number;
  pruned: number;
}

export async function cleanMemories(convex: ConvexHttpClient): Promise<CleanResult> {
  const active = await convex.query(api.memoryRecords.list, {
    lifecycle: "active",
    limit: 500,
  });

  let archived = 0;
  let pruned = 0;

  for (const mem of active) {
    if (mem.tier === "permanent") continue;

    const score = effectiveScore({
      importance: mem.importance,
      decayRate: mem.decayRate,
      lastAccessedAt: mem.lastAccessedAt ?? mem.createdAt,
      accessCount: mem.accessCount ?? 0,
    });

    if (score < PRUNE_THRESHOLD) {
      await convex.mutation(api.memoryRecords.setLifecycle, {
        memoryId: mem.memoryId,
        lifecycle: "pruned",
      });
      pruned++;
    } else if (score < ARCHIVE_THRESHOLD && mem.tier !== "long") {
      await convex.mutation(api.memoryRecords.setLifecycle, {
        memoryId: mem.memoryId,
        lifecycle: "archived",
      });
      archived++;
    }
  }

  await convex.mutation(api.memoryEvents.emit, {
    eventType: "memory.cleaned",
    data: JSON.stringify({ scanned: active.length, archived, pruned }),
  });

  return { scanned: active.length, archived, pruned };
}
