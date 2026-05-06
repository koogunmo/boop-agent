export interface WebhookMeta {
  trigger_slug: string;
  connected_account_id: string;
}

export interface NormalizedEvent {
  triggerSlug: string;
  appSlug: string;
  sender: string;
  subject: string;
  body: string;
  dedupKey: string;
  connectedAccountId: string;
  raw: Record<string, unknown>;
}

export type TemplateName = "email" | "message" | "issue" | "calendar" | "generic";

export interface TriggerTemplate {
  name: TemplateName;
  normalize(data: Record<string, unknown>, meta: WebhookMeta): NormalizedEvent | null;
  rubric: string;
  isSelfSend?(event: NormalizedEvent, userIdentities: string[]): boolean;
}

export const MESSAGE_KINDS = ["user", "proactive"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export type PipelineResult =
  | { action: "dispatched"; summary: string }
  | { action: "skipped"; reason: string };
