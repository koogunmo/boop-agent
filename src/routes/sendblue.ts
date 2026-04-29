import { zValidator } from "@hono/zod-validator";
import { ConvexHttpClient } from "convex/browser";
import { Hono } from "hono";
import { z } from "zod";
import { dispatchToAgent } from "@/lib/agent-dispatch";
import { sendImessage, startTypingLoop } from "@/lib/sendblue";
import { api } from "../../convex/_generated/api";

const webhookBody = z.object({
  content: z.string().optional(),
  from_number: z.string().optional(),
  is_outbound: z.boolean().optional(),
  message_handle: z.string().optional(),
});

async function processInbound(
  env: Env,
  conversationId: string,
  content: string,
  fromNumber: string,
): Promise<void> {
  const start = Date.now();
  const stopTyping = startTypingLoop(env, fromNumber);
  try {
    const result = await dispatchToAgent(env.BOOP_AGENT, conversationId, content);

    if (!result.ok) {
      console.error(`[sendblue] agent error ${result.status}: ${result.error}`);
      await sendImessage(env, fromNumber, "Sorry — something went wrong. Try again.");
      return;
    }

    if (result.reply) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[sendblue] → reply (${elapsed}s, ${result.reply.length} chars)`);
      await sendImessage(env, fromNumber, result.reply);
    }
  } catch (err) {
    console.error("[sendblue] handler error", err);
  } finally {
    stopTyping();
  }
}

const sendblue = new Hono<{ Bindings: Env }>().post(
  "/webhook",
  zValidator("json", webhookBody),
  async (c) => {
    const body = c.req.valid("json");

    if (body.is_outbound || !body.content || !body.from_number) {
      return c.json({ ok: true, skipped: true });
    }

    const convex = new ConvexHttpClient(c.env.CONVEX_URL);

    if (body.message_handle) {
      const { claimed } = await convex.mutation(api.sendblueDedup.claim, {
        handle: body.message_handle,
      });
      if (!claimed) {
        return c.json({ ok: true, deduped: true });
      }
    }

    const conversationId = `sms:${body.from_number}`;
    console.log(
      `[sendblue] ← ${body.from_number}: ${JSON.stringify(body.content.length > 100 ? `${body.content.slice(0, 100)}…` : body.content)}`,
    );

    c.executionCtx.waitUntil(processInbound(c.env, conversationId, body.content, body.from_number));

    return c.json({ ok: true });
  },
);

export { sendblue };
