import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex, testEnv } from "../lib/test-helpers";
import { createSelfTools } from "./self";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

describe("get_config", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns JSON config with model field from env", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue(null);
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z
      .object({
        model: z.string(),
        envDefault: z.string(),
        availableModels: z.array(z.string()),
        composioEnabled: z.boolean(),
        embeddingsEnabled: z.boolean(),
        sendblueEnabled: z.boolean(),
      })
      .parse(JSON.parse(z.string().parse(result)));

    expect(config.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(config.composioEnabled).toBe(true);
    expect(config.sendblueEnabled).toBe(true);
  });

  it("uses stored model from settings when available and known", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("anthropic/claude-sonnet-4-6");
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z.object({ model: z.string() }).parse(JSON.parse(z.string().parse(result)));
    expect(config.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("falls back to env model when stored model is unknown", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("unknown-model");
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z.object({ model: z.string() }).parse(JSON.parse(z.string().parse(result)));
    expect(config.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
  });
});

describe("set_model", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves alias and calls settings.set", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!({ model: "opus" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("anthropic/claude-opus-4-7");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      key: "model",
      value: "anthropic/claude-opus-4-7",
    });
  });

  it("accepts canonical model ID", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!(
      { model: "workers-ai/@cf/moonshotai/kimi-k2.6" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(convex.mutation).toHaveBeenCalledOnce();
  });

  it("returns error for unknown model", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!({ model: "gpt-5-turbo" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Unknown model");
    expect(resultStr).toContain("gpt-5-turbo");
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});
