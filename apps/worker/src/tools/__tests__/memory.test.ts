import type { BroadcastFn } from "@boop/shared/events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { SEGMENT_DEFAULTS } from "@/memory/types";
import { createMemoryTools } from "@/tools/memory";

const CONV_ID = "test:conv";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

function mockBroadcast(): BroadcastFn & { calls: Array<{ event: string; data: unknown }> } {
  const calls: Array<{ event: string; data: unknown }> = [];
  const fn = ((event: string, data: unknown) => {
    calls.push({ event, data });
  }) as BroadcastFn & { calls: Array<{ event: string; data: unknown }> };
  fn.calls = calls;
  return fn;
}

describe("write_memory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses segment default tier for identity (permanent) and calls upsert + emit", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.write_memory.execute!(
      { content: "User is an engineer", segment: "identity", importance: 0.85 },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("tier=permanent");
    expect(resultStr).toContain("segment=identity");

    expect(convex.mutation).toHaveBeenCalledTimes(2);

    // First call: memoryRecords.upsert
    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs).toMatchObject({
      content: "User is an engineer",
      tier: "permanent",
      segment: "identity",
      importance: 0.85,
      decayRate: 0,
    });

    // Second call: memoryEvents.emit
    const emitArgs = convex.mutation.mock.calls[1]![1];
    expect(emitArgs).toMatchObject({
      eventType: "memory.written",
      conversationId: CONV_ID,
    });
    const emitData = z
      .object({ tier: z.string(), segment: z.string(), importance: z.number() })
      .parse(JSON.parse(emitArgs.data));
    expect(emitData.tier).toBe("permanent");
  });

  it("uses segment default tier for context (short)", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.write_memory.execute!(
      { content: "Currently at a coffee shop", segment: "context", importance: 0.4 },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("tier=short");

    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs.tier).toBe("short");
    // write_memory uses DEFAULT_DECAY[tier], not SEGMENT_DEFAULTS[segment].decayRate
    expect(upsertArgs.decayRate).toBe(0.05);
  });

  it("passes supersedes array when provided", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    await tools.write_memory.execute!(
      {
        content: "Name is actually Alex",
        segment: "correction",
        importance: 0.8,
        supersedes: ["mem_old1", "mem_old2"],
      },
      toolOpts,
    );

    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs.supersedes).toEqual(["mem_old1", "mem_old2"]);
  });

  it("broadcasts memory.written event", async () => {
    const convex = mockConvex();
    const broadcast = mockBroadcast();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
      broadcast,
    });

    await tools.write_memory.execute!(
      { content: "User likes coffee", segment: "preference", importance: 0.7 },
      toolOpts,
    );

    expect(broadcast.calls).toHaveLength(1);
    expect(broadcast.calls[0]!.event).toBe("memory.written");
    const data = broadcast.calls[0]!.data as { memoryId: string; segment: string; tier: string };
    expect(data.segment).toBe("preference");
    expect(data.tier).toBe("long");
    expect(data.memoryId).toMatch(/^mem_/);
  });

  it("allows explicit tier override", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.write_memory.execute!(
      { content: "Temporary note", segment: "knowledge", importance: 0.5, tier: "short" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("tier=short");

    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs.tier).toBe("short");
  });
});

describe("recall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 'No memories matched.' when search returns empty", async () => {
    const convex = mockConvex([]);
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.recall.execute!({ query: "nonexistent topic", limit: 10 }, toolOpts);

    expect(z.string().parse(result)).toBe("No memories matched.");
  });

  it("formats results with tier/segment/importance and calls markAccessed", async () => {
    const memories = [
      {
        memoryId: "mem_abc",
        tier: "permanent",
        segment: "identity",
        importance: 0.85,
        content: "User is an engineer",
      },
      {
        memoryId: "mem_def",
        tier: "long",
        segment: "preference",
        importance: 0.7,
        content: "Prefers dark mode",
      },
    ];
    const convex = mockConvex(memories);
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.recall.execute!({ query: "user info", limit: 10 }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("permanent/identity");
    expect(resultStr).toContain("importance=0.85");
    expect(resultStr).toContain("mem_abc");
    expect(resultStr).toContain("User is an engineer");
    expect(resultStr).toContain("long/preference");
    expect(resultStr).toContain("Prefers dark mode");

    // markAccessed called once per result
    const markAccessedCalls = convex.mutation.mock.calls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown>;
      return "memoryId" in args && !("eventType" in args);
    });
    expect(markAccessedCalls).toHaveLength(2);
    expect(markAccessedCalls[0]![1]).toMatchObject({ memoryId: "mem_abc" });
    expect(markAccessedCalls[1]![1]).toMatchObject({ memoryId: "mem_def" });
  });

  it("emits memory.recalled event", async () => {
    const convex = mockConvex([]);
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    await tools.recall.execute!({ query: "anything", limit: 5 }, toolOpts);

    // The last mutation call should be the emit
    const lastCall = convex.mutation.mock.calls[convex.mutation.mock.calls.length - 1]!;
    expect(lastCall[1]).toMatchObject({
      eventType: "memory.recalled",
      conversationId: CONV_ID,
    });
    const data = z
      .object({ query: z.string(), hits: z.number(), mode: z.string() })
      .parse(JSON.parse(lastCall[1].data));
    expect(data.query).toBe("anything");
    expect(data.hits).toBe(0);
    expect(data.mode).toBe("substring");
  });

  it("broadcasts memory.recalled event", async () => {
    const memories = [
      { memoryId: "mem_x", tier: "long", segment: "knowledge", importance: 0.6, content: "fact" },
    ];
    const convex = mockConvex(memories);
    const broadcast = mockBroadcast();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
      broadcast,
    });

    await tools.recall.execute!({ query: "fact", limit: 5 }, toolOpts);

    expect(broadcast.calls).toHaveLength(1);
    expect(broadcast.calls[0]!.event).toBe("memory.recalled");
    const data = broadcast.calls[0]!.data as { query: string; hits: number };
    expect(data.query).toBe("fact");
    expect(data.hits).toBe(1);
  });
});

describe("SEGMENT_DEFAULTS", () => {
  it("identity defaults to permanent tier", () => {
    expect(SEGMENT_DEFAULTS.identity.tier).toBe("permanent");
  });

  it("context defaults to short tier", () => {
    expect(SEGMENT_DEFAULTS.context.tier).toBe("short");
  });

  it("preference defaults to long tier", () => {
    expect(SEGMENT_DEFAULTS.preference.tier).toBe("long");
  });

  it("correction defaults to long tier", () => {
    expect(SEGMENT_DEFAULTS.correction.tier).toBe("long");
  });

  it("all segments have importance between 0 and 1", () => {
    for (const [, defaults] of Object.entries(SEGMENT_DEFAULTS)) {
      expect(defaults.importance).toBeGreaterThanOrEqual(0);
      expect(defaults.importance).toBeLessThanOrEqual(1);
    }
  });

  it("identity has highest importance", () => {
    expect(SEGMENT_DEFAULTS.identity.importance).toBeGreaterThan(
      SEGMENT_DEFAULTS.preference.importance,
    );
    expect(SEGMENT_DEFAULTS.identity.importance).toBeGreaterThan(
      SEGMENT_DEFAULTS.context.importance,
    );
  });

  it("context has lowest importance", () => {
    for (const [segment, defaults] of Object.entries(SEGMENT_DEFAULTS)) {
      if (segment !== "context") {
        expect(defaults.importance).toBeGreaterThan(SEGMENT_DEFAULTS.context.importance);
      }
    }
  });
});
