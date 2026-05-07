import { ConvexHttpClient } from "convex/browser";
import { Hono } from "hono";
import { getServerByName } from "partyserver";
import { dispatchToAgent } from "@/lib/agent-dispatch";
import { createComposioClient } from "@/lib/composio";
import { classifyEvent } from "@/proactive/classify";
import { runProactivePipeline } from "@/proactive/pipeline";
import { defaultTemplateForSlug, getTemplate } from "@/proactive/templates/index";
import type { WebhookMeta } from "@/proactive/types";

const webhooks = new Hono<{ Bindings: Env }>().post("/composio", async (c) => {
  const composioClient = createComposioClient(c.env);
  if (!composioClient) return c.json({ error: "composio disabled" }, 503);

  const id = c.req.header("webhook-id") ?? "";
  const signature = c.req.header("webhook-signature") ?? "";
  const timestamp = c.req.header("webhook-timestamp") ?? "";
  const rawBody = await c.req.text();

  if (!id || !signature || !timestamp || !rawBody) {
    return c.json({ error: "missing webhook headers" }, 400);
  }

  const secret = c.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "webhook secret not configured" }, 503);

  let verified: Awaited<ReturnType<typeof composioClient.raw.triggers.verifyWebhook>> | undefined;
  try {
    verified = await composioClient.raw.triggers.verifyWebhook({
      id,
      signature,
      timestamp,
      payload: rawBody,
      secret,
    });
  } catch (err) {
    console.warn("[webhook] signature verification failed", err);
    return c.json({ error: "invalid signature" }, 401);
  }

  const payload = verified?.payload;
  if (!payload) return c.json({ ok: true, skipped: "empty_payload" });

  const meta: WebhookMeta = {
    trigger_slug: payload.triggerSlug ?? "",
    connected_account_id: payload.metadata?.connectedAccount?.id ?? "",
  };

  if (!meta.trigger_slug) return c.json({ ok: true, skipped: "no_trigger_slug" });

  const templateName = defaultTemplateForSlug(meta.trigger_slug);
  const template = getTemplate(templateName);
  const convex = new ConvexHttpClient(c.env.CONVEX_URL);
  const agentStub = await getServerByName(c.env.BOOP_AGENT, "default");

  c.executionCtx.waitUntil(
    runProactivePipeline({
      env: c.env,
      data: payload as unknown as Record<string, unknown>,
      meta,
      template,
      convex,
      broadcast: (event, data) => {
        agentStub
          .fetch("http://agent/broadcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event, data }),
          })
          .catch((err) => console.error("[webhook] broadcast failed", err));
      },
      classify: classifyEvent,
      dispatch: async (conversationId, content) => {
        const result = await dispatchToAgent(
          c.env.BOOP_AGENT,
          conversationId,
          content,
          "proactive",
        );
        return result.ok ? result.reply : "";
      },
    }).catch((err) => {
      console.error("[webhook] pipeline error", err);
      agentStub
        .fetch("http://agent/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "proactive_skipped",
            data: { triggerSlug: meta.trigger_slug, reason: `error: ${String(err)}` },
          }),
        })
        .catch(() => {});
    }),
  );

  return c.json({ ok: true });
});

export { webhooks };
