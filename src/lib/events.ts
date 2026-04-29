import { z } from "zod";

export const broadcastEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("user_message"),
    data: z.object({ conversationId: z.string(), content: z.string() }),
  }),
  z.object({
    event: z.literal("assistant_message"),
    data: z.object({ conversationId: z.string(), content: z.string() }),
  }),
  z.object({
    event: z.literal("assistant_ack"),
    data: z.object({ conversationId: z.string(), content: z.string() }),
  }),
  z.object({
    event: z.literal("agent_spawned"),
    data: z.object({ agentId: z.string(), name: z.string(), task: z.string() }),
  }),
  z.object({
    event: z.literal("agent_tool"),
    data: z.object({ agentId: z.string(), toolName: z.string() }),
  }),
  z.object({
    event: z.literal("agent_done"),
    data: z.object({ agentId: z.string(), status: z.string(), result: z.string() }),
  }),
  z.object({ event: z.literal("agent_stale"), data: z.object({ agentId: z.string() }) }),
  z.object({
    event: z.literal("consolidation_started"),
    data: z.object({ runId: z.string(), trigger: z.string() }),
  }),
  z.object({
    event: z.literal("consolidation_phase"),
    data: z.object({ runId: z.string(), phase: z.string() }).passthrough(),
  }),
  z.object({
    event: z.literal("consolidation_completed"),
    data: z.object({ runId: z.string(), merged: z.number(), pruned: z.number() }),
  }),
  z.object({
    event: z.literal("consolidation_failed"),
    data: z.object({ runId: z.string(), error: z.string() }),
  }),
  z.object({
    event: z.literal("automation_started"),
    data: z.object({ automationId: z.string(), runId: z.string(), name: z.string() }),
  }),
  z.object({
    event: z.literal("automation_completed"),
    data: z.object({ automationId: z.string(), runId: z.string() }),
  }),
  z.object({
    event: z.literal("automation_failed"),
    data: z.object({ automationId: z.string(), runId: z.string(), error: z.string() }),
  }),
]);

type BroadcastEvent = z.infer<typeof broadcastEventSchema>;
export type EventName = BroadcastEvent["event"];
export type EventData<E extends EventName> = Extract<BroadcastEvent, { event: E }>["data"];

export type BroadcastFn = <E extends EventName>(event: E, data: EventData<E>) => void;
