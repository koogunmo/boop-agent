import { describe, expect, it } from "vitest";
import { calendarTemplate } from "@/proactive/templates/calendar";
import { emailTemplate } from "@/proactive/templates/email";
import { genericTemplate } from "@/proactive/templates/generic";
import { defaultTemplateForSlug } from "@/proactive/templates/index";
import { issueTemplate } from "@/proactive/templates/issue";
import { messageTemplate } from "@/proactive/templates/message";
import type { WebhookMeta } from "@/proactive/types";

const meta: WebhookMeta = {
  trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
  connected_account_id: "conn_123",
};

describe("emailTemplate", () => {
  it("normalizes a standard Gmail payload", () => {
    const data = {
      messageId: "msg_abc",
      sender: "Alice <alice@example.com>",
      subject: "Meeting tomorrow",
      messageText: "Hey, can we meet at 3pm?",
      snippet: "Hey, can we meet",
    };
    const event = emailTemplate.normalize(data, meta);
    expect(event).not.toBeNull();
    expect(event!.sender).toBe("alice@example.com");
    expect(event!.subject).toBe("Meeting tomorrow");
    expect(event!.body).toBe("Hey, can we meet at 3pm?");
    expect(event!.dedupKey).toBe("msg_abc");
    expect(event!.appSlug).toBe("gmail");
    expect(event!.connectedAccountId).toBe("conn_123");
  });

  it("falls back to 'from' and 'body' fields", () => {
    const data = {
      messageId: "msg_def",
      from: "bob@example.com",
      subject: "Test",
      body: "Body text",
    };
    const event = emailTemplate.normalize(data, meta);
    expect(event!.sender).toBe("bob@example.com");
    expect(event!.body).toBe("Body text");
  });

  it("returns null when no messageId", () => {
    const data = { sender: "alice@example.com", subject: "No ID" };
    expect(emailTemplate.normalize(data, meta)).toBeNull();
  });

  it("detects self-send", () => {
    const event = emailTemplate.normalize(
      { messageId: "1", sender: "me@gmail.com", subject: "Test", body: "hi" },
      meta,
    );
    expect(emailTemplate.isSelfSend!(event!, ["me@gmail.com"])).toBe(true);
    expect(emailTemplate.isSelfSend!(event!, ["other@gmail.com"])).toBe(false);
  });
});

describe("messageTemplate", () => {
  it("normalizes a Slack DM payload", () => {
    const data = {
      user: "U12345",
      text: "Hey, quick question about the deploy",
      ts: "1234567890.123456",
      channel: "D98765",
    };
    const slackMeta: WebhookMeta = {
      trigger_slug: "SLACK_DIRECT_MESSAGE_RECEIVED",
      connected_account_id: "conn_456",
    };
    const event = messageTemplate.normalize(data, slackMeta);
    expect(event).not.toBeNull();
    expect(event!.sender).toBe("U12345");
    expect(event!.body).toBe("Hey, quick question about the deploy");
    expect(event!.dedupKey).toBe("1234567890.123456");
    expect(event!.appSlug).toBe("slack");
  });

  it("normalizes a channel message", () => {
    const data = {
      user: "U12345",
      text: "Heads up: deploy failed",
      ts: "111.222",
      channel: "C_general",
    };
    const slackMeta: WebhookMeta = {
      trigger_slug: "SLACK_CHANNEL_MESSAGE_RECEIVED",
      connected_account_id: "conn_456",
    };
    const event = messageTemplate.normalize(data, slackMeta);
    expect(event!.subject).toContain("C_general");
  });

  it("returns null when no text", () => {
    const data = { user: "U12345", ts: "111.222" };
    expect(messageTemplate.normalize(data, meta)).toBeNull();
  });
});

describe("issueTemplate", () => {
  it("normalizes a GitHub PR event", () => {
    const data = {
      action: "review_requested",
      pull_request: {
        title: "Fix auth bug",
        number: 42,
        user: { login: "alice" },
      },
      sender: { login: "bob" },
    };
    const ghMeta: WebhookMeta = {
      trigger_slug: "GITHUB_PULL_REQUEST_EVENT",
      connected_account_id: "conn_789",
    };
    const event = issueTemplate.normalize(data, ghMeta);
    expect(event).not.toBeNull();
    expect(event!.sender).toBe("bob");
    expect(event!.subject).toContain("Fix auth bug");
    expect(event!.dedupKey).toContain("review_requested");
    expect(event!.appSlug).toBe("github");
  });

  it("normalizes a Linear-style issue event", () => {
    const data = {
      action: "created",
      title: "Bug: login broken",
      assignee: "kinsley",
      creator: "alice",
      id: "LIN-123",
    };
    const linearMeta: WebhookMeta = {
      trigger_slug: "LINEAR_ISSUE_CREATED",
      connected_account_id: "conn_lin",
    };
    const event = issueTemplate.normalize(data, linearMeta);
    expect(event).not.toBeNull();
    expect(event!.subject).toContain("Bug: login broken");
    expect(event!.dedupKey).toContain("LIN-123");
  });
});

describe("calendarTemplate", () => {
  it("normalizes a calendar event", () => {
    const data = {
      summary: "Team standup",
      start: "2026-05-05T10:00:00",
      organizer: "boss@company.com",
      attendees: ["me@company.com", "boss@company.com"],
      status: "confirmed",
    };
    const calMeta: WebhookMeta = {
      trigger_slug: "GOOGLE_CALENDAR_EVENT_CHANGED",
      connected_account_id: "conn_cal",
    };
    const event = calendarTemplate.normalize(data, calMeta);
    expect(event).not.toBeNull();
    expect(event!.subject).toBe("Team standup");
    expect(event!.sender).toBe("boss@company.com");
    expect(event!.body).toContain("2026-05-05");
  });
});

describe("genericTemplate", () => {
  it("stringifies any payload", () => {
    const data = { foo: "bar", nested: { a: 1 } };
    const unknownMeta: WebhookMeta = {
      trigger_slug: "CUSTOM_APP_EVENT",
      connected_account_id: "conn_x",
    };
    const event = genericTemplate.normalize(data, unknownMeta);
    expect(event).not.toBeNull();
    expect(event!.body).toContain("foo");
    expect(event!.body).toContain("bar");
    expect(event!.appSlug).toBe("custom");
  });

  it("uses trigger_slug as dedupKey fallback", () => {
    const data = { some: "data" };
    const event = genericTemplate.normalize(data, {
      trigger_slug: "CUSTOM_TRIGGER",
      connected_account_id: "conn_x",
    });
    expect(event!.dedupKey).toContain("CUSTOM_TRIGGER");
  });
});

describe("defaultTemplateForSlug", () => {
  it("maps Gmail to email", () => {
    expect(defaultTemplateForSlug("GMAIL_NEW_GMAIL_MESSAGE")).toBe("email");
  });

  it("maps Slack to message", () => {
    expect(defaultTemplateForSlug("SLACK_RECEIVE_MESSAGE")).toBe("message");
    expect(defaultTemplateForSlug("SLACK_DIRECT_MESSAGE_RECEIVED")).toBe("message");
  });

  it("maps GitHub issues to issue", () => {
    expect(defaultTemplateForSlug("GITHUB_PULL_REQUEST_EVENT")).toBe("issue");
  });

  it("falls back to generic for unknown slugs", () => {
    expect(defaultTemplateForSlug("TOTALLY_UNKNOWN_TRIGGER")).toBe("generic");
  });
});
