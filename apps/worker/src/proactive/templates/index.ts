import type { TemplateName, TriggerTemplate } from "@/proactive/types";
import { calendarTemplate } from "./calendar";
import { emailTemplate } from "./email";
import { genericTemplate } from "./generic";
import { issueTemplate } from "./issue";
import { messageTemplate } from "./message";

export { calendarTemplate } from "./calendar";
export { emailTemplate } from "./email";
export { genericTemplate } from "./generic";
export { issueTemplate } from "./issue";
export { messageTemplate } from "./message";

const TEMPLATES: Record<TemplateName, TriggerTemplate> = {
  email: emailTemplate,
  message: messageTemplate,
  issue: issueTemplate,
  calendar: calendarTemplate,
  generic: genericTemplate,
};

const SLUG_DEFAULTS: Record<string, TemplateName> = {
  GMAIL_NEW_GMAIL_MESSAGE: "email",
  SLACK_RECEIVE_MESSAGE: "message",
  SLACK_CHANNEL_MESSAGE_RECEIVED: "message",
  SLACK_DIRECT_MESSAGE_RECEIVED: "message",
  DISCORD_MESSAGE_RECEIVED: "message",
  GITHUB_PULL_REQUEST_EVENT: "issue",
  GITHUB_ISSUES_EVENT: "issue",
  GITHUB_COMMIT_EVENT: "generic",
  LINEAR_ISSUE_CREATED: "issue",
  LINEAR_ISSUE_UPDATED: "issue",
  GOOGLE_CALENDAR_EVENT_CHANGED: "calendar",
  JIRA_ISSUE_CREATED: "issue",
  JIRA_ISSUE_UPDATED: "issue",
  ASANA_TASK_CREATED: "issue",
  ASANA_TASK_UPDATED: "issue",
};

export function defaultTemplateForSlug(slug: string): TemplateName {
  return SLUG_DEFAULTS[slug] ?? "generic";
}

export function getTemplate(name: TemplateName): TriggerTemplate {
  return TEMPLATES[name] ?? genericTemplate;
}
