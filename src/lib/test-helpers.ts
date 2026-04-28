import type {
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { vi } from "vitest";

interface DoGenerateResult {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
  warnings: LanguageModelV2CallWarning[];
}

function mockModel(textResponse: string): LanguageModel {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},

    doGenerate(_options: LanguageModelV2CallOptions): PromiseLike<DoGenerateResult> {
      const content: LanguageModelV2Content[] = [{ type: "text", text: textResponse }];
      const result: DoGenerateResult = {
        content,
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        warnings: [],
      };
      return Promise.resolve(result);
    },

    doStream(
      _options: LanguageModelV2CallOptions,
    ): PromiseLike<{ stream: ReadableStream<LanguageModelV2StreamPart> }> {
      return Promise.reject(new Error("streaming not implemented in mock"));
    },
  };
}

function mockModelThatFails(error: Error): LanguageModel {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},

    doGenerate(_options: LanguageModelV2CallOptions): PromiseLike<DoGenerateResult> {
      return Promise.reject(error);
    },

    doStream(
      _options: LanguageModelV2CallOptions,
    ): PromiseLike<{ stream: ReadableStream<LanguageModelV2StreamPart> }> {
      return Promise.reject(error);
    },
  };
}

function mockProvider(model: LanguageModel) {
  return (_modelId: string) => model;
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return {
    SENDBLUE_API_KEY: "test-key",
    SENDBLUE_API_SECRET: "test-secret",
    SENDBLUE_FROM_NUMBER: "+14155550000",
    CONVEX_URL: "http://localhost:3210",
    CF_ACCOUNT_ID: "test",
    CF_GATEWAY_ID: "test",
    CF_API_TOKEN: "test",
    COMPOSIO_API_KEY: "test",
    BOOP_MODEL: "workers-ai/@cf/moonshotai/kimi-k2.6",
    MODEL_DISPATCHER: "workers-ai/@cf/moonshotai/kimi-k2.6",
    MODEL_EXECUTOR: "workers-ai/@cf/moonshotai/kimi-k2.6",
    MODEL_EXTRACTION: "workers-ai/@cf/moonshotai/kimi-k2.6",
    MODEL_ADVERSARY: "workers-ai/@cf/zai-org/glm-4.7-flash",
    MODEL_PROPOSER: "anthropic/claude-sonnet-4-6",
    MODEL_JUDGE: "anthropic/claude-sonnet-4-6",
    COMPOSIO_USER_ID: "boop-default",
    ...overrides,
  } satisfies Record<string, string> as unknown as Env;
}

export function cvx(mock: MockConvex): import("convex/browser").ConvexHttpClient {
  return mock as unknown as import("convex/browser").ConvexHttpClient;
}

export function mockConvex(queryResult: unknown = []) {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    mutation: vi.fn().mockResolvedValue(null),
    action: vi.fn().mockResolvedValue([]),
  };
}

export type MockConvex = ReturnType<typeof mockConvex>;

export async function injectMocksIntoDO(
  stub: DurableObjectStub,
  convex: MockConvex,
  reply: string,
) {
  const { runInDurableObject } = await import("cloudflare:test");
  await runInDurableObject(stub, async (instance: unknown) => {
    const agent = instance as { _convex: unknown; _provider: unknown };
    agent._convex = convex;
    agent._provider = mockProvider(mockModel(reply));
  });
}

export async function injectMocksWithErrorIntoDO(
  stub: DurableObjectStub,
  convex: MockConvex,
  error: Error,
) {
  const { runInDurableObject } = await import("cloudflare:test");
  await runInDurableObject(stub, async (instance: unknown) => {
    const agent = instance as { _convex: unknown; _provider: unknown };
    agent._convex = convex;
    agent._provider = mockProvider(mockModelThatFails(error));
  });
}
