import { describe, expect, it, vi } from "vitest";
import { getEmbeddingStatus, reembed } from "@/lib/reembed";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";

describe("getEmbeddingStatus", () => {
  it("returns stats with running=false when idle", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue({
      total: 20,
      withEmbedding: 15,
      withoutEmbedding: 5,
      truncated: false,
    });

    const env = testEnv({ AI: { run: vi.fn() } as unknown as Ai });

    const status = await getEmbeddingStatus(cvx(convex), env);
    expect(status.total).toBe(20);
    expect(status.withEmbedding).toBe(15);
    expect(status.withoutEmbedding).toBe(5);
    expect(status.running).toBe(false);
    expect(status.provider).toBe("workers-ai");
  });
});

describe("reembed", () => {
  it("embeds unembedded memories and calls setEmbedding for each", async () => {
    const convex = mockConvex();
    let callCount = 0;
    convex.query.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          page: [
            { memoryId: "mem_1", content: "hello world" },
            { memoryId: "mem_2", content: "goodbye world" },
          ],
          isDone: true,
          continueCursor: "done",
        };
      }
      return { page: [], isDone: true, continueCursor: "done" };
    });

    const mockAiRun = vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
    const env = testEnv({ AI: { run: mockAiRun } as unknown as Ai });

    const broadcast = vi.fn();
    const result = await reembed(cvx(convex), env, broadcast);

    expect(result.embedded).toBe(2);
    expect(result.failed).toBe(0);
    expect(convex.mutation).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledWith(
      "memory.reembed.progress",
      expect.objectContaining({ embedded: 1, memoryId: "mem_1" }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      "memory.reembed.done",
      expect.objectContaining({ embedded: 2, failed: 0 }),
    );
  });

  it("counts failures when embedding returns null", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue({
      page: [{ memoryId: "mem_1", content: "hello" }],
      isDone: true,
      continueCursor: "done",
    });

    const mockAiRun = vi.fn().mockResolvedValue({ data: [] });
    const env = testEnv({ AI: { run: mockAiRun } as unknown as Ai });

    const broadcast = vi.fn();
    const result = await reembed(cvx(convex), env, broadcast);

    expect(result.embedded).toBe(0);
    expect(result.failed).toBe(1);
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("deduplicates memoryIds across pages", async () => {
    const convex = mockConvex();
    let callCount = 0;
    convex.query.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return {
          page: [{ memoryId: "mem_1", content: "same" }],
          isDone: callCount === 2,
          continueCursor: callCount === 1 ? "page2" : "done",
        };
      }
      return { page: [], isDone: true, continueCursor: "done" };
    });

    const mockAiRun = vi.fn().mockResolvedValue({ data: [[0.1]] });
    const env = testEnv({ AI: { run: mockAiRun } as unknown as Ai });

    const broadcast = vi.fn();
    const result = await reembed(cvx(convex), env, broadcast);

    expect(result.embedded).toBe(1);
    expect(mockAiRun).toHaveBeenCalledOnce();
  });
});
