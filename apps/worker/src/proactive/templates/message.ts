import type { TriggerTemplate } from "@/proactive/types";
import { str } from "@/proactive/util";

const SLUG_TO_APP: Record<string, string> = {
  SLACK_RECEIVE_MESSAGE: "slack",
  SLACK_CHANNEL_MESSAGE_RECEIVED: "slack",
  SLACK_DIRECT_MESSAGE_RECEIVED: "slack",
  DISCORD_MESSAGE_RECEIVED: "discord",
};

export const messageTemplate: TriggerTemplate = {
  name: "message",

  normalize(data, meta) {
    const text = str(data.text) || str(data.message) || str(data.content);
    if (!text) return null;

    const channel = str(data.channel) || str(data.channel_id) || str(data.room);
    const isDm = meta.trigger_slug.includes("DIRECT") || channel.startsWith("D");

    return {
      triggerSlug: meta.trigger_slug,
      appSlug: SLUG_TO_APP[meta.trigger_slug] ?? "chat",
      sender: str(data.user) || str(data.user_id) || str(data.sender) || str(data.from),
      subject: isDm ? `DM from ${str(data.user) || "someone"}` : `#${channel}`,
      body: text,
      dedupKey:
        str(data.ts) ||
        str(data.message_id) ||
        str(data.id) ||
        `${meta.trigger_slug}:${Date.now()}`,
      connectedAccountId: meta.connected_account_id,
      raw: data,
    };
  },

  rubric: `You are deciding whether a chat message warrants interrupting the user with a proactive iMessage.

Surface (return important=true) when:
- A direct message asking the user a question or requesting action.
- An @-mention in a channel where the user is expected to respond.
- A message from someone the user works closely with about an active project.
- An urgent/time-sensitive message (deployment issues, production alerts, meeting changes).

Drop (return important=false) when:
- Bot messages, automated notifications, CI/CD status updates.
- General channel chatter not directed at the user.
- Reactions, emoji responses, thread replies the user isn't part of.
- Status updates or announcements that don't require action.
- Messages in high-volume channels unless the user is mentioned.

When important=true, write a summary in 1-2 short sentences. Under ~200 chars.

When important=false, omit the summary.`,

  isSelfSend(event, userIdentities) {
    return userIdentities.some((id) => id.toLowerCase() === event.sender.toLowerCase());
  },
};
