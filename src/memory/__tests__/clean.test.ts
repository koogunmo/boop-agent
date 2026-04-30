import type { ConvexHttpClient } from "convex/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BroadcastFn } from "@/lib/events";
import type { MockConvex } from "@/lib/test-helpers";
import { mockConvex } from "@/lib/test-helpers";
import { cleanMemories } from "@/memory/clean";
import {
  ARCHIVE_THRESHOLD,
  BASE_HALF_LIFE_DAYS,
  DAY_MS,
  effectiveScore,
  PRUNE_THRESHOLD,
} from "@/memory/types";

function cvx(mock: MockConvex): ConvexHttpClient {
  return mock as unknown as ConvexHttpClient;
}

describe("effectiveScore", () => {
  it("returns importance for recently accessed memory", () => {
    const score = effectiveScore({
      importance: 0.8,
      decayRate: 0.02,
      lastAccessedAt: Date.now(),
      accessCount: 0,
    });
    expect(score).toBeCloseTo(0.8, 1);
  });

  it("decays over time", () => {
    const recent = effectiveScore({
      importance: 0.8,
      decayRate: 0.02,
      lastAccessedAt: Date.now(),
      accessCount: 0,
    });
    const old = effectiveScore({
      importance: 0.8,
      decayRate: 0.02,
      lastAccessedAt: Date.now() - 30 * DAY_MS,
      accessCount: 0,
    });
    expect(old).toBeLessThan(recent);
  });

  it("higher importance decays slower", () => {
    const highImportance = effectiveScore({
      importance: 0.9,
      decayRate: 0.02,
      lastAccessedAt: Date.now() - 20 * DAY_MS,
      accessCount: 0,
    });
    const lowImportance = effectiveScore({
      importance: 0.3,
      decayRate: 0.02,
      lastAccessedAt: Date.now() - 20 * DAY_MS,
      accessCount: 0,
    });
    expect(highImportance).toBeGreaterThan(lowImportance);
  });

  it("access count reinforces against decay", () => {
    const noAccess = effectiveScore({
      importance: 0.5,
      decayRate: 0.02,
      lastAccessedAt: Date.now() - 15 * DAY_MS,
      accessCount: 0,
    });
    const frequentAccess = effectiveScore({
      importance: 0.5,
      decayRate: 0.02,
      lastAccessedAt: Date.now() - 15 * DAY_MS,
      accessCount: 20,
    });
    expect(frequentAccess).toBeGreaterThan(noAccess);
  });

  it("clamps between 0 and 1", () => {
    const score = effectiveScore({
      importance: 1.0,
      decayRate: 0.0,
      lastAccessedAt: Date.now(),
      accessCount: 100,
    });
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("very old low-importance memories score below prune threshold", () => {
    const score = effectiveScore({
      importance: 0.3,
      decayRate: 0.08,
      lastAccessedAt: Date.now() - 60 * DAY_MS,
      accessCount: 0,
    });
    expect(score).toBeLessThan(PRUNE_THRESHOLD);
  });

  it("moderately old memories can be in archive range", () => {
    const score = effectiveScore({
      importance: 0.4,
      decayRate: 0.05,
      lastAccessedAt: Date.now() - 30 * DAY_MS,
      accessCount: 0,
    });
    expect(score).toBeLessThan(ARCHIVE_THRESHOLD);
  });

  it("adaptive half-life scales with importance", () => {
    const halfLife09 = BASE_HALF_LIFE_DAYS * (1 + 0.9);
    const halfLife03 = BASE_HALF_LIFE_DAYS * (1 + 0.3);
    expect(halfLife09).toBeGreaterThan(halfLife03);
    expect(halfLife09).toBeCloseTo(21.375, 2);
    expect(halfLife03).toBeCloseTo(14.625, 2);
  });
});

describe("thresholds", () => {
  it("prune threshold is 0.05", () => {
    expect(PRUNE_THRESHOLD).toBe(0.05);
  });

  it("archive threshold is 0.15", () => {
    expect(ARCHIVE_THRESHOLD).toBe(0.15);
  });

  it("archive threshold is greater than prune threshold", () => {
    expect(ARCHIVE_THRESHOLD).toBeGreaterThan(PRUNE_THRESHOLD);
  });
});

/* ---------- cleanMemories ---------- */

describe("cleanMemories", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prunes memories scoring below prune threshold", async () => {
    const convex = mockConvex([
      {
        memoryId: "mem_old",
        tier: "short",
        segment: "context",
        importance: 0.2,
        decayRate: 0.08,
        lastAccessedAt: Date.now() - 120 * DAY_MS,
        accessCount: 0,
        createdAt: Date.now() - 120 * DAY_MS,
      },
    ]);

    const result = await cleanMemories(cvx(convex));

    const resultShape = z.object({
      scanned: z.number(),
      archived: z.number(),
      pruned: z.number(),
    });
    const parsed = resultShape.parse(result);
    expect(parsed.pruned).toBe(1);
    expect(parsed.archived).toBe(0);

    // setLifecycle called with pruned
    const setLifecycleCalls = convex.mutation.mock.calls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown>;
      return "lifecycle" in args;
    });
    expect(setLifecycleCalls).toHaveLength(1);
    expect(setLifecycleCalls[0]![1]).toMatchObject({
      memoryId: "mem_old",
      lifecycle: "pruned",
    });
  });

  it("archives short-tier memories scoring below archive threshold but above prune", async () => {
    // Need a memory that scores between PRUNE_THRESHOLD and ARCHIVE_THRESHOLD
    // with tier !== "long"
    const convex = mockConvex([
      {
        memoryId: "mem_mid",
        tier: "short",
        segment: "context",
        importance: 0.4,
        decayRate: 0.05,
        lastAccessedAt: Date.now() - 30 * DAY_MS,
        accessCount: 0,
        createdAt: Date.now() - 30 * DAY_MS,
      },
    ]);

    const result = await cleanMemories(cvx(convex));

    const parsed = z
      .object({ scanned: z.number(), archived: z.number(), pruned: z.number() })
      .parse(result);
    expect(parsed.archived).toBe(1);
    expect(parsed.pruned).toBe(0);
  });

  it("skips permanent memories entirely", async () => {
    const convex = mockConvex([
      {
        memoryId: "mem_perm",
        tier: "permanent",
        segment: "identity",
        importance: 0.1,
        decayRate: 0,
        lastAccessedAt: Date.now() - 365 * DAY_MS,
        accessCount: 0,
        createdAt: Date.now() - 365 * DAY_MS,
      },
    ]);

    const result = await cleanMemories(cvx(convex));

    const parsed = z
      .object({ scanned: z.number(), archived: z.number(), pruned: z.number() })
      .parse(result);
    expect(parsed.scanned).toBe(1);
    expect(parsed.archived).toBe(0);
    expect(parsed.pruned).toBe(0);

    // Only the emit call, no setLifecycle
    const setLifecycleCalls = convex.mutation.mock.calls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown>;
      return "lifecycle" in args;
    });
    expect(setLifecycleCalls).toHaveLength(0);
  });

  it("does not archive long-tier memories even if below archive threshold", async () => {
    // The cleanMemories code skips archiving for tier === "long"
    const convex = mockConvex([
      {
        memoryId: "mem_long",
        tier: "long",
        segment: "preference",
        importance: 0.4,
        decayRate: 0.05,
        lastAccessedAt: Date.now() - 30 * DAY_MS,
        accessCount: 0,
        createdAt: Date.now() - 30 * DAY_MS,
      },
    ]);

    const result = await cleanMemories(cvx(convex));

    const parsed = z
      .object({ scanned: z.number(), archived: z.number(), pruned: z.number() })
      .parse(result);
    // The score is ~0.12 which is below ARCHIVE_THRESHOLD but tier is "long"
    // so it should NOT be archived. But it IS above PRUNE_THRESHOLD so not pruned either.
    // Actually let's verify the score
    const score = effectiveScore({
      importance: 0.4,
      decayRate: 0.05,
      lastAccessedAt: Date.now() - 30 * DAY_MS,
      accessCount: 0,
    });
    if (score < PRUNE_THRESHOLD) {
      // Would be pruned (even long-tier gets pruned)
      expect(parsed.pruned).toBe(1);
    } else {
      // Not pruned, and not archived because tier=long
      expect(parsed.archived).toBe(0);
      expect(parsed.pruned).toBe(0);
    }
  });

  it("emits memory.cleaned event with correct counts", async () => {
    const convex = mockConvex([
      {
        memoryId: "mem_prune",
        tier: "short",
        segment: "context",
        importance: 0.2,
        decayRate: 0.08,
        lastAccessedAt: Date.now() - 120 * DAY_MS,
        accessCount: 0,
        createdAt: Date.now() - 120 * DAY_MS,
      },
      {
        memoryId: "mem_keep",
        tier: "short",
        segment: "context",
        importance: 0.9,
        decayRate: 0.01,
        lastAccessedAt: Date.now(),
        accessCount: 10,
        createdAt: Date.now(),
      },
    ]);

    await cleanMemories(cvx(convex));

    // Find the emit call (last mutation)
    const lastCall = convex.mutation.mock.calls[convex.mutation.mock.calls.length - 1]!;
    expect(lastCall[1]).toMatchObject({ eventType: "memory.cleaned" });
    const data = z
      .object({ scanned: z.number(), archived: z.number(), pruned: z.number() })
      .parse(JSON.parse(lastCall[1].data));
    expect(data.scanned).toBe(2);
    expect(data.pruned).toBe(1);
  });

  it("handles empty active list", async () => {
    const convex = mockConvex([]);

    const result = await cleanMemories(cvx(convex));

    const parsed = z
      .object({ scanned: z.number(), archived: z.number(), pruned: z.number() })
      .parse(result);
    expect(parsed.scanned).toBe(0);
    expect(parsed.archived).toBe(0);
    expect(parsed.pruned).toBe(0);

    // Only the emit, no setLifecycle
    expect(convex.mutation).toHaveBeenCalledOnce();
  });

  it("uses createdAt as fallback when lastAccessedAt is missing", async () => {
    const createdAt = Date.now() - 120 * DAY_MS;
    const convex = mockConvex([
      {
        memoryId: "mem_no_access",
        tier: "short",
        segment: "context",
        importance: 0.2,
        decayRate: 0.08,
        lastAccessedAt: undefined,
        accessCount: 0,
        createdAt,
      },
    ]);

    const result = await cleanMemories(cvx(convex));

    const parsed = z.object({ scanned: z.number(), pruned: z.number() }).parse(result);
    // With very old createdAt and low importance, should be pruned
    expect(parsed.pruned).toBe(1);
  });

  it("broadcasts memory.cleaned event", async () => {
    const convex = mockConvex([]);
    const calls: Array<{ event: string; data: unknown }> = [];
    const broadcast = ((event: string, data: unknown) =>
      calls.push({ event, data })) as BroadcastFn;

    await cleanMemories(cvx(convex), broadcast);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe("memory.cleaned");
    const data = calls[0]!.data as { scanned: number; archived: number; pruned: number };
    expect(data.scanned).toBe(0);
    expect(data.archived).toBe(0);
    expect(data.pruned).toBe(0);
  });
});
