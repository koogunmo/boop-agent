import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { BroadcastFn } from "@/lib/events";
import type { GatewayMetadata } from "@/lib/llm";
import type { MockConvex } from "@/lib/test-helpers";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { extractAndStore } from "@/memory/extract";

/* ---------- mock ai module ---------- */

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

/* ---------- mock embeddings (always return null so we isolate extraction logic) ---------- */

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn().mockResolvedValue(null),
}));

/* ---------- mock llm provider ---------- */

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

function baseOpts(convex: MockConvex) {
  return {
    env: testEnv(),
    convex: cvx(convex),
    conversationId: "test:extract",
    userMessage: "My name is Alex",
    assistantReply: "Nice to meet you, Alex!",
    turnId: "turn_123",
  };
}

describe("extractAndStore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes gateway metadata header with source, conversationId, turnId", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ facts: [] }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const convex = mockConvex();
    await extractAndStore(baseOpts(convex));

    expect(generateTextMock).toHaveBeenCalledOnce();
    const callArgs = generateTextMock.mock.calls[0]![0] as { headers: Record<string, string> };
    const expected: GatewayMetadata = {
      source: "extract",
      conversationId: "test:extract",
      turnId: "turn_123",
    };
    expect(callArgs.headers["cf-aig-metadata"]).toBe(JSON.stringify(expected));
  });

  it("stores extracted facts and emits memory.extracted event", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          { content: "User's name is Alex", segment: "identity", importance: 0.85 },
          { content: "User prefers dark mode", segment: "preference", importance: 0.7 },
        ],
      }),
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    const convex = mockConvex();
    await extractAndStore(baseOpts(convex));

    // 1 usage record + 2 memory upserts + 1 emit = 4 mutations
    expect(convex.mutation).toHaveBeenCalledTimes(4);

    // First mutation: usage record
    const usageArgs = convex.mutation.mock.calls[0]![1];
    expect(usageArgs).toMatchObject({
      source: "extract",
      conversationId: "test:extract",
      turnId: "turn_123",
    });

    // Second mutation: first fact upsert
    const fact1 = convex.mutation.mock.calls[1]![1];
    expect(fact1).toMatchObject({
      content: "User's name is Alex",
      segment: "identity",
      tier: "permanent",
      importance: 0.85,
    });
    // memoryId should be present
    z.string().startsWith("mem_").parse(fact1.memoryId);

    // Third mutation: second fact upsert
    const fact2 = convex.mutation.mock.calls[2]![1];
    expect(fact2).toMatchObject({
      content: "User prefers dark mode",
      segment: "preference",
      tier: "long",
    });

    // Fourth mutation: memory.extracted event
    const emitArgs = convex.mutation.mock.calls[3]![1];
    expect(emitArgs).toMatchObject({ eventType: "memory.extracted" });
    const emitData = z
      .object({ turnId: z.string(), count: z.number() })
      .parse(JSON.parse(emitArgs.data));
    expect(emitData.count).toBe(2);
  });

  it("handles empty facts array gracefully", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ facts: [] }),
      usage: { inputTokens: 20, outputTokens: 5 },
    } as never);

    const convex = mockConvex();
    await extractAndStore(baseOpts(convex));

    // 1 usage + 0 upserts + 1 emit = 2 mutations
    expect(convex.mutation).toHaveBeenCalledTimes(2);

    const emitArgs = convex.mutation.mock.calls[1]![1];
    const emitData = z.object({ count: z.number() }).parse(JSON.parse(emitArgs.data));
    expect(emitData.count).toBe(0);
  });

  it("does not throw when generateText fails (fire-and-forget)", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockRejectedValue(new Error("API timeout"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const convex = mockConvex();

    await expect(extractAndStore(baseOpts(convex))).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("handles malformed JSON from LLM gracefully", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: "not json at all",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const convex = mockConvex();

    await expect(extractAndStore(baseOpts(convex))).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("handles invalid schema from LLM gracefully", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ facts: [{ wrong: "schema" }] }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const convex = mockConvex();

    await expect(extractAndStore(baseOpts(convex))).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("adds metadata for correction segment with corrects field", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          {
            content: "User's name is Alex, not Alice",
            segment: "correction",
            importance: 0.8,
            corrects: "Name was Alice",
          },
        ],
      }),
      usage: { inputTokens: 30, outputTokens: 15 },
    } as never);

    const convex = mockConvex();
    await extractAndStore(baseOpts(convex));

    // usage + 1 upsert + emit = 3
    expect(convex.mutation).toHaveBeenCalledTimes(3);

    const upsertArgs = convex.mutation.mock.calls[1]![1];
    expect(upsertArgs.segment).toBe("correction");
    expect(upsertArgs.tier).toBe("long");
    const metadata = z.object({ corrects: z.string() }).parse(JSON.parse(upsertArgs.metadata));
    expect(metadata.corrects).toBe("Name was Alice");
  });

  it("broadcasts memory.extracted event", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        facts: [{ content: "User is Alex", segment: "identity", importance: 0.85 }],
      }),
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    const convex = mockConvex();
    const calls: Array<{ event: string; data: unknown }> = [];
    const broadcast = ((event: string, data: unknown) =>
      calls.push({ event, data })) as BroadcastFn;

    await extractAndStore({ ...baseOpts(convex), broadcast });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe("memory.extracted");
    const data = calls[0]!.data as { turnId: string; count: number };
    expect(data.turnId).toBe("turn_123");
    expect(data.count).toBe(1);
  });

  it("records usage even when no facts are extracted", async () => {
    const { generateText } = await import("ai");
    const generateTextMock = vi.mocked(generateText);
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ facts: [] }),
      usage: { inputTokens: 15, outputTokens: 5 },
    } as never);

    const convex = mockConvex();
    await extractAndStore(baseOpts(convex));

    // First mutation should be the usage record
    const usageArgs = convex.mutation.mock.calls[0]![1];
    expect(usageArgs).toMatchObject({
      source: "extract",
      model: "workers-ai/@cf/moonshotai/kimi-k2.6",
      inputTokens: 15,
      outputTokens: 5,
    });
  });
});
