import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createProvider(env: Env) {
  return createOpenAICompatible({
    name: "cloudflare",
    apiKey: env.CF_API_TOKEN,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`,
  });
}
