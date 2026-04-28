import type {
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import type { LanguageModel } from "ai";

interface DoGenerateResult {
  content: LanguageModelV2Content[];
  finishReason: LanguageModelV2FinishReason;
  usage: LanguageModelV2Usage;
  warnings: LanguageModelV2CallWarning[];
}

export function mockModel(textResponse: string): LanguageModel {
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

export function mockModelThatFails(error: Error): LanguageModel {
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

export function mockProvider(model: LanguageModel) {
  return (_modelId: string) => model;
}
