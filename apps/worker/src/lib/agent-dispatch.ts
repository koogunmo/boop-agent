import { z } from "zod";

const agentReply = z.object({ reply: z.string() });

export async function dispatchToAgent<T extends Rpc.DurableObjectBranded>(
  namespace: DurableObjectNamespace<T>,
  conversationId: string,
  content: string,
): Promise<{ ok: true; reply: string } | { ok: false; status: number; error: string }> {
  const id = namespace.idFromName(conversationId);
  const stub = namespace.get(id);

  const res = await stub.fetch(
    new Request("http://agent/handle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": conversationId,
      },
      body: JSON.stringify({ conversationId, content }),
    }),
  );

  if (!res.ok) {
    const error = await res.text();
    return { ok: false, status: res.status, error };
  }

  const parsed = agentReply.safeParse(await res.json());
  if (!parsed.success) {
    return { ok: false, status: 500, error: "unexpected response shape from agent" };
  }

  return { ok: true, reply: parsed.data.reply };
}
