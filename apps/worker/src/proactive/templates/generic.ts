import type { TriggerTemplate } from "@/proactive/types";
import { str } from "@/proactive/util";

export const genericTemplate: TriggerTemplate = {
  name: "generic",

  normalize(data, meta) {
    const sender = str(data.sender) || str(data.from) || str(data.user) || str(data.actor) || "";
    const subject =
      str(data.subject) || str(data.title) || str(data.summary) || str(data.action) || "";
    const body =
      str(data.body) ||
      str(data.text) ||
      str(data.message) ||
      str(data.content) ||
      JSON.stringify(data, null, 2).slice(0, 1500);

    const id = str(data.id) || str(data.messageId) || str(data.event_id) || "";
    const dedupKey = id || `${meta.trigger_slug}:${meta.connected_account_id}:${Date.now()}`;

    const slug = meta.trigger_slug.toLowerCase();
    const appSlug = slug.split("_")[0] ?? "unknown";

    return {
      triggerSlug: meta.trigger_slug,
      appSlug,
      sender,
      subject,
      body,
      dedupKey,
      connectedAccountId: meta.connected_account_id,
      raw: data,
    };
  },

  rubric: `You are deciding whether a notification warrants interrupting the user with a proactive iMessage.

You are looking at a raw event payload from an integration. Use your judgment based on the content.

Surface (return important=true) when:
- Someone is directly asking the user a question or requesting action.
- There is a time-sensitive deadline or change.
- Something requires the user's immediate attention (security, outage, urgent request).
- A person the user works with needs a response.

Drop (return important=false) when:
- Automated notifications, status updates, or digests.
- Low-priority informational updates.
- Events that don't require the user to do anything.
- Routine system events (deployments, backups, metrics).

When important=true, write a summary in 1-2 short sentences. Under ~200 chars.

When important=false, omit the summary.`,
};
