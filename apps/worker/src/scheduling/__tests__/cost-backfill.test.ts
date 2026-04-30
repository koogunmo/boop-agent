import { afterEach, describe, expect, it, vi } from "vitest";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { type BackfillDeps, backfillCosts } from "@/scheduling/cost-backfill";

function mockStorage(data: Record<string, unknown> = {}): BackfillDeps["storage"] {
  const store = new Map(Object.entries(data));
  return {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
}

describe("backfillCosts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("queries gateway logs and updates matched records", async () => {
    const convex = mockConvex();
    const storage = mockStorage();
    const metadata = JSON.stringify({
      source: "execution",
      agentId: "agent_abc",
      conversationId: "conv_1",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              id: "log_1",
              created_at: new Date().toISOString(),
              provider: "workers-ai",
              model: "kimi-k2.6",
              duration: 5000,
              success: true,
              cached: false,
              tokens_in: 100,
              tokens_out: 50,
              cost: 0.0015,
              metadata,
            },
          ],
          result_info: { total_count: 1, page: 1, per_page: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await backfillCosts({
      env: testEnv(),
      convex: cvx(convex),
      storage,
    });

    expect(result.processed).toBe(1);
    expect(result.matched).toBeGreaterThanOrEqual(1);
    expect(convex.mutation).toHaveBeenCalled();
  });

  it("handles empty log response", async () => {
    const convex = mockConvex();
    const storage = mockStorage();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: [],
          result_info: { total_count: 0, page: 1, per_page: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await backfillCosts({ env: testEnv(), convex: cvx(convex), storage });
    expect(result.processed).toBe(0);
    expect(result.matched).toBe(0);
  });

  it("handles API error gracefully", async () => {
    const convex = mockConvex();
    const storage = mockStorage();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error", { status: 500 }));

    const result = await backfillCosts({ env: testEnv(), convex: cvx(convex), storage });
    expect(result.processed).toBe(0);
  });

  it("skips entries without metadata", async () => {
    const convex = mockConvex();
    const storage = mockStorage();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              id: "log_1",
              created_at: new Date().toISOString(),
              provider: "workers-ai",
              model: "kimi",
              duration: 1000,
              success: true,
              cached: false,
              tokens_in: 50,
              tokens_out: 20,
              cost: 0.001,
            },
          ],
          result_info: { total_count: 1, page: 1, per_page: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await backfillCosts({ env: testEnv(), convex: cvx(convex), storage });
    expect(result.processed).toBe(1);
    expect(result.matched).toBe(0);
  });

  it("stores lastBackfillAt after processing", async () => {
    const convex = mockConvex();
    const putSpy = vi.fn();
    const storage: BackfillDeps["storage"] = {
      get: async () => undefined,
      put: putSpy,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: [],
          result_info: { total_count: 0, page: 1, per_page: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await backfillCosts({ env: testEnv(), convex: cvx(convex), storage });
    expect(putSpy).toHaveBeenCalledWith("lastBackfillAt", expect.any(Number));
  });
});
