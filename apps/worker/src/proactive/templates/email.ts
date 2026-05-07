import type { TriggerTemplate } from "@/proactive/types";
import { str } from "@/proactive/util";

function extractEmail(raw: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  return (m?.[1] ?? raw).trim().toLowerCase();
}

export const emailTemplate: TriggerTemplate = {
  name: "email",

  normalize(data, meta) {
    const messageId = str(data.messageId) || str(data.message_id);
    if (!messageId) return null;

    const preview =
      data.preview && typeof data.preview === "object"
        ? (data.preview as Record<string, unknown>)
        : {};

    return {
      triggerSlug: meta.trigger_slug,
      appSlug: "gmail",
      sender: extractEmail(str(data.sender) || str(data.from)),
      subject: str(data.subject) || str(preview.subject),
      body: str(data.messageText) || str(data.body) || str(preview.body) || str(data.snippet),
      dedupKey: messageId,
      connectedAccountId: meta.connected_account_id,
      raw: data,
    };
  },

  rubric: `You are deciding whether an email warrants interrupting the user with a proactive iMessage.

Surface (return important=true) when the email is one of:
- A security-sensitive code or login alert (OTPs, "new sign-in from", password reset).
- A time-bound action with a deadline the user has committed to (rent/bill due, contract signature, RSVP).
- A meeting/scheduling change for a calendar event the user knows about.
- A real personal/work message from someone in the user's orbit, where the sender is asking a question or expecting a reply AND there's concrete shared context.
- A reply on a thread the user is participating in, where the sender's message ends with a question.

Drop (return important=false) when the email is:
- Marketing, newsletters, promotional offers, drip campaigns.
- Social-platform digests, notification roll-ups.
- Order confirmations, shipping updates, receipts that don't require a response.
- Automated alerts from no-reply addresses unless security-related.
- Calendar invites already accepted; meeting reminders for known events.
- Self-sent emails (sender matches user's own email addresses).
- Cold outreach disguised as personal: offers a service, no shared context, prospecting domain.
- Product form submissions, feedback, feature requests.
- User-initiated auth flows (magic links, "click to verify sign-in").
- Expired deadlines.
- Low-severity automated alerts (scanner noise, generic "unusual activity" without confirmed compromise).

When important=true, write a summary in 1-2 short sentences for an iMessage. Lead with what matters. Under ~200 chars.

When important=false, omit the summary.`,

  isSelfSend(event, userIdentities) {
    if (!event.sender) return false;
    return userIdentities.some((id) => id.toLowerCase() === event.sender.toLowerCase());
  },
};
