import { z } from "zod";
import { generateObject } from "@/lib/ai";
import type { NormalizedEvent } from "@/proactive/types";

const SYSTEM = `You are a notification importance filter for a personal agent.
Given a notification and the importance rubric, decide if it warrants interrupting the user.`;

const classifySchema = z.object({
  important: z.boolean(),
  summary: z.string().optional(),
});

export async function classifyEvent(
  env: Env,
  event: NormalizedEvent,
  rubric: string,
): Promise<{ important: boolean; summary?: string }> {
  const userPrompt = [
    `Sender: ${event.sender || "(unknown)"}`,
    `Subject: ${event.subject || "(none)"}`,
    `Body:\n${(event.body || "(empty)").slice(0, 1500)}`,
  ].join("\n");

  const { object } = await generateObject({
    ai: env.AI,
    model: env.MODEL_CLASSIFIER,
    schema: classifySchema,
    schemaName: "classify",
    system: `${SYSTEM}\n\n${rubric}`,
    prompt: userPrompt,
  });

  if (object.important && object.summary) {
    return { important: true, summary: object.summary };
  }
  return { important: object.important };
}
