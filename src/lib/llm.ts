import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createProvider(env: Env) {
  return createOpenAICompatible({
    name: "cloudflare",
    apiKey: env.CF_API_TOKEN,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`,
  });
}

export type GatewayMetadata =
  | { source: "dispatcher"; conversationId: string; turnId: string }
  | { source: "execution"; conversationId: string; agentId: string }
  | { source: "extract"; conversationId: string; turnId: string }
  | { source: "consolidation-proposer"; conversationId: string; runId: string }
  | { source: "consolidation-adversary"; conversationId: string; runId: string }
  | { source: "consolidation-judge"; conversationId: string; runId: string };

export function gatewayMetadataHeader(metadata: GatewayMetadata): Record<string, string> {
  return { "cf-aig-metadata": JSON.stringify(metadata) };
}
