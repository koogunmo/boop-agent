import { afterEach, describe, expect, it, vi } from "vitest";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { runConsolidation } from "@/scheduling/consolidation";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  createProvider: () => (_modelId: string) => ({
    specificationVersion: "v2",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    doGenerate: () =>
      Promise.resolve({
        content: [],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      }),
    doStream: () => Promise.reject(new Error("not implemented")),
  }),
  gatewayMetadataHeader: (metadata: Record<string, unknown>) => ({
    "cf-aig-metadata": JSON.stringify(metadata),
  }),
}));

function mockProvider() {
  return (_modelId: string) => ({});
}

function baseDeps(convex: ReturnType<typeof mockConvex>) {
  return {
    env: testEnv(),
    convex: cvx(convex),
    provider: mockProvider() as ReturnType<typeof import("@/lib/llm").createProvider>,
    broadcast: vi.fn(),
    trigger: "test",
  };
}

describe("runConsolidation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skips when fewer than 6 memories", async () => {
    const convex = mockConvex([
      {
        memoryId: "m1",
        content: "fact 1",
        tier: "long",
        segment: "identity",
        importance: 0.8,
        createdAt: Date.now(),
        decayRate: 0.01,
      },
      {
        memoryId: "m2",
        content: "fact 2",
        tier: "long",
        segment: "preference",
        importance: 0.7,
        createdAt: Date.now(),
        decayRate: 0.01,
      },
    ]);

    const result = await runConsolidation(baseDeps(convex));

    expect(result.proposals).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.pruned).toBe(0);
    expect(convex.mutation).toHaveBeenCalledTimes(2);
  });

  it("creates run and broadcasts phases", async () => {
    const memories = Array.from({ length: 7 }, (_, i) => ({
      memoryId: `m${i}`,
      content: `fact ${i}`,
      tier: "long",
      segment: "knowledge",
      importance: 0.6,
      createdAt: Date.now() - i * 86400000,
      decayRate: 0.01,
    }));
    const convex = mockConvex(memories);

    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValueOnce({
      text: '{"proposals":[]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const deps = baseDeps(convex);
    const result = await runConsolidation(deps);

    expect(result.proposals).toBe(0);
    expect(deps.broadcast).toHaveBeenCalledWith(
      "consolidation_started",
      expect.objectContaining({ trigger: "test" }),
    );
    expect(deps.broadcast).toHaveBeenCalledWith(
      "consolidation_phase",
      expect.objectContaining({ phase: "loaded" }),
    );
  });

  it("applies merge proposals correctly", async () => {
    const memories = Array.from({ length: 7 }, (_, i) => ({
      memoryId: `m${i}`,
      content: `fact ${i}`,
      tier: "long",
      segment: "knowledge",
      importance: 0.6,
      createdAt: Date.now() - i * 86400000,
      decayRate: 0.01,
    }));
    const convex = mockConvex(memories);

    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock
      .mockResolvedValueOnce({
        text: JSON.stringify({
          proposals: [
            { type: "merge", keep: "m0", absorb: ["m1"], rewriteContent: "combined fact" },
          ],
        }),
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          challenges: [{ proposalIndex: 0, objection: null, severity: "low" }],
        }),
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          decisions: [{ proposalIndex: 0, approve: true, rationale: "clean merge" }],
        }),
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

    const result = await runConsolidation(baseDeps(convex));

    expect(result.merged).toBe(1);
    expect(result.pruned).toBe(0);
    const upsertCall = convex.mutation.mock.calls.find(
      (c) => c[1]?.memoryId === "m0" && c[1]?.content === "combined fact",
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall![1]).toMatchObject({
      memoryId: "m0",
      content: "combined fact",
      supersedes: ["m1"],
    });
  });

  it("applies prune proposals correctly", async () => {
    const memories = Array.from({ length: 7 }, (_, i) => ({
      memoryId: `m${i}`,
      content: `fact ${i}`,
      tier: "long",
      segment: "knowledge",
      importance: 0.6,
      createdAt: Date.now() - i * 86400000,
      decayRate: 0.01,
    }));
    const convex = mockConvex(memories);

    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock
      .mockResolvedValueOnce({
        text: JSON.stringify({
          proposals: [{ type: "prune", memoryId: "m5", reason: "redundant" }],
        }),
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          challenges: [{ proposalIndex: 0, objection: null, severity: "low" }],
        }),
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          decisions: [{ proposalIndex: 0, approve: true, rationale: "agreed" }],
        }),
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

    const result = await runConsolidation(baseDeps(convex));

    expect(result.pruned).toBe(1);
    const pruneCall = convex.mutation.mock.calls.find(
      (c) => c[1]?.memoryId === "m5" && c[1]?.lifecycle === "pruned",
    );
    expect(pruneCall).toBeDefined();
  });

  it("handles malformed JSON from LLM", async () => {
    const memories = Array.from({ length: 7 }, (_, i) => ({
      memoryId: `m${i}`,
      content: `fact ${i}`,
      tier: "long",
      segment: "knowledge",
      importance: 0.6,
      createdAt: Date.now(),
      decayRate: 0.01,
    }));
    const convex = mockConvex(memories);

    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock
      .mockResolvedValueOnce({
        text: "not json at all",
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: "also not json",
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: "still not json",
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never);

    const result = await runConsolidation(baseDeps(convex));
    expect(result.proposals).toBe(0);
    expect(result.merged).toBe(0);
  });
});
