import type { TriggerTemplate } from "@/proactive/types";
import { str } from "@/proactive/util";

export const calendarTemplate: TriggerTemplate = {
  name: "calendar",

  normalize(data, meta) {
    const summary = str(data.summary) || str(data.title) || str(data.subject);
    if (!summary) return null;

    const start = str(data.start) || str(data.startTime) || str(data.start_time);
    const organizer = str(data.organizer) || str(data.creator);
    const attendees: string[] = [];
    if (Array.isArray(data.attendees)) {
      for (const a of data.attendees as unknown[]) {
        if (typeof a === "string") {
          attendees.push(a);
        } else if (a && typeof a === "object") {
          const email = str((a as Record<string, unknown>).email);
          if (email) attendees.push(email);
        }
      }
    }
    const status = str(data.status) || str(data.eventStatus);
    const eventId = str(data.id) || str(data.eventId) || str(data.event_id);

    const bodyParts = [
      start ? `Start: ${start}` : null,
      status ? `Status: ${status}` : null,
      attendees.length ? `Attendees: ${attendees.join(", ")}` : null,
    ].filter(Boolean);

    return {
      triggerSlug: meta.trigger_slug,
      appSlug: "calendar",
      sender: organizer,
      subject: summary,
      body: bodyParts.join("\n"),
      dedupKey: eventId || `${meta.trigger_slug}:${summary}:${start}`,
      connectedAccountId: meta.connected_account_id,
      raw: data,
    };
  },

  rubric: `You are deciding whether a calendar event notification warrants interrupting the user with a proactive iMessage.

Surface (return important=true) when:
- A new meeting invite from someone the user works with that requires a response.
- A meeting was cancelled or rescheduled that the user is attending.
- A meeting is starting in the next 15 minutes that the user might not be aware of.
- An important event was added to the user's calendar by someone else.

Drop (return important=false) when:
- Reminder notifications for meetings the user already knows about.
- Calendar invites the user has already accepted.
- All-day events or holidays.
- Recurring meeting reminders (standup, 1:1s).
- Declined or tentative events the user didn't accept.

When important=true, write a summary in 1-2 short sentences. Under ~200 chars.

When important=false, omit the summary.`,
};
