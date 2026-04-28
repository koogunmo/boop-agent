import { generateText } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { embed } from "../lib/embeddings";
import { createProvider } from "../lib/llm";
import type { MemorySegment } from "./types";
import { makeMemoryId, SEGMENT_DEFAULTS } from "./types";

const EXTRACTION_PROMPT = `You are a memory-extraction subagent.

Given a user message + assistant reply, extract any DURABLE facts worth remembering.
Return STRICT JSON and nothing else:
{"facts":[
  {
    "content":"...",
    "segment":"identity|preference|correction|relationship|project|knowledge|context",
    "importance":0.0-1.0,
    "corrects":"what was wrong, if this is a correction"
  }
]}

Rules:
- Prefer fewer, higher-quality facts over many trivial ones.
- Skip transient state ("I'm tired right now").
- Segment meanings:
  - identity: name, role, location, core traits (highest priority — rarely changes)
  - correction: user explicitly corrected something. Set "corrects" to wrong value/prior belief.
  - preference: how they like things done
  - relationship: people they know + how
  - project: ongoing work or goals
  - knowledge: facts about their world
  - context: current ongoing situation (describe state, not momentary feelings)
- Importance defaults: identity 0.85, correction 0.80, relationship 0.75, preference 0.70,
  project 0.65, knowledge 0.60, context 0.40. Only bump up/down with clear reason.
- "corrects" field ONLY for segment="correction". Omit for everything else.
- Return empty facts array if nothing durable.

Respond with ONLY the JSON object. No explanation, no markdown, no code fences.`;

const extractionSchema = z.object({
  facts: z.array(
    z.object({
      content: z.string(),
      segment: z.enum([
        "identity",
        "preference",
        "correction",
        "relationship",
        "project",
        "knowledge",
        "context",
      ]),
      importance: z.number().min(0).max(1),
      corrects: z.string().nullish(),
    }),
  ),
});

interface ExtractOpts {
  env: Env;
  convex: ConvexHttpClient;
  conversationId: string;
  userMessage: string;
  assistantReply: string;
  turnId: string;
}

export async function extractAndStore(opts: ExtractOpts): Promise<void> {
  const { env, convex, conversationId, userMessage, assistantReply, turnId } = opts;

  try {
    const provider = createProvider(env);
    const payload = `USER: ${userMessage}\n\nASSISTANT: ${assistantReply}`;
    const started = Date.now();

    const result = await generateText({
      model: provider(env.MODEL_EXTRACTION),
      system: EXTRACTION_PROMPT,
      prompt: payload,
      maxOutputTokens: 1024,
    });

    if (result.usage) {
      await convex.mutation(api.usageRecords.record, {
        source: "extract",
        conversationId,
        turnId,
        model: env.MODEL_EXTRACTION,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
      });
    }

    const text = result.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[extract] no JSON in response:", text.slice(0, 200));
      return;
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn("[extract] malformed JSON:", jsonMatch[0].slice(0, 200));
      return;
    }

    const parsed = extractionSchema.safeParse(rawJson);
    if (!parsed.success) {
      console.warn("[extract] schema mismatch:", parsed.error.message.slice(0, 200));
      return;
    }

    for (const fact of parsed.data.facts) {
      const segment = fact.segment satisfies MemorySegment;
      const defaults = SEGMENT_DEFAULTS[segment];
      const importance = Math.max(0, Math.min(1, fact.importance));
      const memoryId = makeMemoryId();
      const embedding = await embed(env, fact.content);
      const metadata =
        segment === "correction" && fact.corrects
          ? JSON.stringify({ corrects: fact.corrects })
          : undefined;

      await convex.mutation(api.memoryRecords.upsert, {
        memoryId,
        content: fact.content,
        tier: defaults.tier,
        segment,
        importance,
        decayRate: defaults.decayRate,
        sourceTurn: turnId,
        ...(embedding ? { embedding } : {}),
        ...(metadata ? { metadata } : {}),
      });
    }

    await convex.mutation(api.memoryEvents.emit, {
      eventType: "memory.extracted",
      conversationId,
      data: JSON.stringify({ turnId, count: parsed.data.facts.length }),
    });
  } catch (err) {
    console.error("[extract] error", err);
  }
}
