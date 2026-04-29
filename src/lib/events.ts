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
]);

type BroadcastEvent = z.infer<typeof broadcastEventSchema>;
export type EventName = BroadcastEvent["event"];
export type EventData<E extends EventName> = Extract<BroadcastEvent, { event: E }>["data"];

export type BroadcastFn = <E extends EventName>(event: E, data: EventData<E>) => void;
