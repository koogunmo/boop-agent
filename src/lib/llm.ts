import OpenAI from "openai";

export function createLlmClient(env: Env): OpenAI {
  return new OpenAI({
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`,
    apiKey: env.CF_API_TOKEN,
  });
}
