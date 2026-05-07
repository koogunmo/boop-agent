import { api } from "@boop/convex";
import type { BroadcastFn } from "@boop/shared/events";
import type { ConvexHttpClient } from "convex/browser";
import { sendImessage } from "@/lib/sendblue";
import type {
  NormalizedEvent,
  PipelineResult,
  TriggerTemplate,
  WebhookMeta,
} from "@/proactive/types";

const WARMUP_KEY_PREFIX = "warmup:";

interface PipelineDeps {
  env: Env;
  data: Record<string, unknown>;
  meta: WebhookMeta;
  template: TriggerTemplate;
  convex: ConvexHttpClient;
  broadcast: BroadcastFn;
  classify: (
    env: Env,
    event: NormalizedEvent,
    rubric: string,
  ) => Promise<{ important: boolean; summary?: string }>;
  dispatch: (conversationId: string, content: string) => Promise<string>;
  userIdentities?: string[];
}

function skip(reason: string, broadcast: BroadcastFn, triggerSlug: string): PipelineResult {
  broadcast("proactive_skipped", { triggerSlug, reason });
  return { action: "skipped", reason };
}

export async function runProactivePipeline(deps: PipelineDeps): Promise<PipelineResult> {
  const { env, data, meta, template, convex, broadcast, classify, dispatch } = deps;

  const event = template.normalize(data, meta);
  if (!event) return skip("normalize_failed", broadcast, meta.trigger_slug);

  const kv = env.PROACTIVE_KV;

  const [alreadySeen, config, warmupDone] = await Promise.all([
    kv.get(`dedup:${event.dedupKey}`),
    convex.query(api.triggerConfigs.getBySlug, {
      triggerSlug: meta.trigger_slug,
      connectedAccountId: meta.connected_account_id,
    }),
    kv.get(`${WARMUP_KEY_PREFIX}${meta.connected_account_id}`),
  ]);

  if (alreadySeen) return skip("duplicate", broadcast, meta.trigger_slug);
  await kv.put(`dedup:${event.dedupKey}`, "1", { expirationTtl: 86400 });

  if (!warmupDone) {
    await kv.put(`${WARMUP_KEY_PREFIX}${meta.connected_account_id}`, "1", {
      expirationTtl: 86400 * 30,
    });
    return skip("warmup", broadcast, meta.trigger_slug);
  }

  if (config && !config.enabled) return skip("disabled", broadcast, meta.trigger_slug);

  if (template.isSelfSend && deps.userIdentities) {
    if (template.isSelfSend(event, deps.userIdentities)) {
      return skip("self_send", broadcast, meta.trigger_slug);
    }
  }

  const { important, summary } = await classify(env, event, template.rubric);
  broadcast("proactive_classified", {
    triggerSlug: event.triggerSlug,
    appSlug: event.appSlug,
    important,
  });
  if (!important || !summary) return skip("not_important", broadcast, meta.trigger_slug);

  const conversationId = await resolveConversationId(convex);
  if (!conversationId) return skip("no_conversation", broadcast, meta.trigger_slug);

  const reply = await dispatch(conversationId, `[proactive notice] ${summary}`);

  if (reply && conversationId.startsWith("sms:")) {
    const phone = conversationId.slice(4);
    await sendImessage(deps.env, phone, reply);
  }

  broadcast("proactive_dispatched", {
    triggerSlug: event.triggerSlug,
    sender: event.sender,
    subject: event.subject,
  });

  return { action: "dispatched", summary: reply };
}

async function resolveConversationId(convex: ConvexHttpClient): Promise<string | null> {
  const phone = await convex.query(api.settings.get, { key: "proactive_phone" });
  if (phone) return `sms:${phone}`;
  return null;
}
