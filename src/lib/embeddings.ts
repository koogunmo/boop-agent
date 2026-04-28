const MODEL = "@cf/baai/bge-m3";

export function embeddingsAvailable(env: Env): boolean {
  return Boolean(env.AI);
}

export async function embed(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI) return null;
  try {
    const result = await env.AI.run(MODEL, { text: [text] });
    if ("data" in result && Array.isArray(result.data)) {
      return result.data[0] ?? null;
    }
    return null;
  } catch (err) {
    console.warn("[embeddings] workers ai error", err);
    return null;
  }
}
