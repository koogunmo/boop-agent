import type { TriggerTemplate } from "@/proactive/types";
import { str } from "@/proactive/util";

function nested(obj: unknown, ...keys: string[]): string {
  let cur = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[k];
    else return "";
  }
  if (typeof cur === "string") return cur;
  if (typeof cur === "number") return String(cur);
  return "";
}

export const issueTemplate: TriggerTemplate = {
  name: "issue",

  normalize(data, meta) {
    const action = str(data.action);

    const title =
      str(data.title) || nested(data, "pull_request", "title") || nested(data, "issue", "title");
    if (!title && !action) return null;

    const sender =
      nested(data, "sender", "login") || str(data.creator) || nested(data, "user", "login");

    const number =
      nested(data, "pull_request", "number") ||
      nested(data, "issue", "number") ||
      str(data.number) ||
      str(data.id);

    const id = str(data.id) || number;
    const dedupKey = id ? `${action}:${id}` : `${meta.trigger_slug}:${Date.now()}`;

    const slug = meta.trigger_slug.toLowerCase();
    let appSlug = "unknown";
    if (slug.includes("github")) appSlug = "github";
    else if (slug.includes("linear")) appSlug = "linear";
    else if (slug.includes("jira")) appSlug = "jira";
    else if (slug.includes("asana")) appSlug = "asana";

    const body =
      str(data.description) ||
      nested(data, "pull_request", "body") ||
      nested(data, "issue", "body") ||
      "";

    return {
      triggerSlug: meta.trigger_slug,
      appSlug,
      sender,
      subject: `[${action}] ${title}${number ? ` #${number}` : ""}`,
      body: body.slice(0, 1500),
      dedupKey,
      connectedAccountId: meta.connected_account_id,
      raw: data,
    };
  },

  rubric: `You are deciding whether an issue/PR notification warrants interrupting the user with a proactive iMessage.

Surface (return important=true) when:
- A PR review is requested from the user.
- An issue is assigned to the user.
- A CI/CD check failed on the user's PR.
- A blocking issue is raised on the user's active project.
- A priority change to P0/P1 on something the user owns.
- A direct comment asking the user a question.

Drop (return important=false) when:
- Automated dependency update PRs (Dependabot, Renovate).
- CI passing notifications.
- Issue label changes, milestone updates, project board moves.
- Comments on issues the user isn't involved in.
- PR merges for branches the user didn't author or review.
- Bot-generated issues or automated triage.

When important=true, write a summary in 1-2 short sentences. Under ~200 chars.

When important=false, omit the summary.`,
};
