import { api } from "@boop/convex";
import type { BroadcastFn } from "@boop/shared/events";
import { generateText } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { type createProvider, gatewayMetadataHeader } from "@/lib/llm";
import { randomId } from "@/memory/types";

const PROPOSER_PROMPT = `You are a memory-consolidation proposer.

Given a list of the user's active memories (each tagged with its segment — identity, correction, preference, relationship, project, knowledge, or context), find cases where memories should be:
- merged: multiple entries say the same durable fact in different words
- superseded: a newer memory replaces an older one with a conflicting value
- pruned: an entry is redundant given stronger ones, or obviously wrong

Return STRICT JSON only:
{"proposals":[
  {"type":"merge","keep":"mem_...","absorb":["mem_...","mem_..."],"rewriteContent":"..."},
  {"type":"supersede","newer":"mem_...","older":["mem_..."]},
  {"type":"prune","memoryId":"mem_...","reason":"..."}
]}

Hard rules:
- NEVER propose a merge with an empty "absorb" list. If there's nothing to
  absorb, there's nothing to merge — skip it entirely.
- "absorb" MUST NOT contain the same id as "keep".
- "rewriteContent" must be a single clear sentence combining both sources.
- Be conservative on DISTINCT facts — similar but distinct facts stay separate.

Segment-aware rules:
- A memory tagged "correction" is the user FIXING something they previously said or something in your memory. When a correction contradicts an older fact about the same subject, propose a "supersede" with the correction as "newer" and the contradicted fact(s) as "older". Correction almost always wins.
- Never merge a correction into a non-correction. If you keep just one, keep the correction.
- Identity memories (name, role, location) are high-priority. Only supersede an identity with another identity or a correction that clearly updates it.
- Context memories are low-priority and short-lived — prefer prune over merge for context clutter.

If no changes needed, return {"proposals":[]}. Respond with ONLY the JSON.`;

const ADVERSARY_PROMPT = `You are a memory-consolidation adversary. A proposer has suggested changes to the user's memory (each tagged with segment: identity, correction, preference, relationship, project, knowledge, or context). Your job is to find reasons each proposal could be WRONG or harmful before a judge rules on them.

For each proposal, look for:
- merges that would blur genuinely distinct facts
- supersedes where the "newer" memory doesn't actually cover everything the "older" one said
- prunes that would remove a fact that's rare or harder to rediscover than it looks
- any loss of context, specificity, source info, or nuance

Segment-aware skepticism:
- If a correction is being superseded by a non-correction, flag it — that's almost always wrong. Corrections are durable.
- If an identity memory is being merged or pruned, verify it's clearly redundant — identity facts are expensive to recover.
- If a correction supersede looks aggressive (removing useful context along with the wrong part), flag the context loss.

Be sharp but fair. If a proposal looks clean, say so — don't manufacture objections. Your objections inform the judge; you don't decide.

Return STRICT JSON only. Each challenge MUST include an entry for every proposal index. Shape:
{"challenges":[
  {"proposalIndex":0,"objection":"merging these loses the distinction between X and Y","severity":"high"},
  {"proposalIndex":1,"objection":null,"severity":"low"}
]}

Rules for the fields:
- "severity" MUST be exactly one of the strings: "low", "medium", "high".
- "objection" is either a plain string describing the concern, or the JSON literal null (not the string "null") when you have no objection.
- Use "low" for nitpicks, "medium" for real concerns, "high" for real information loss.

Respond with ONLY the JSON object.`;

const JUDGE_PROMPT = `You are a memory-consolidation judge. You see a proposer's suggested changes AND an adversary's objections to each. Weigh both sides and rule.

Return STRICT JSON only:
{"decisions":[
  {"proposalIndex":0,"approve":true,"rationale":"..."},
  {"proposalIndex":1,"approve":false,"rationale":"..."}
]}

Rules:
- A "high" severity adversary objection should usually result in rejection unless the proposal's benefit clearly outweighs the loss.
- "medium" objections: weigh case-by-case; often approve with the note that the judge acknowledged the concern.
- "low" objections and clean proposals: approve.
- Your rationale should cite the adversary's objection when relevant ("approved despite adversary concern about X because...").
- Respond with ONLY the JSON.`;

const proposalSchema = z.object({
  type: z.enum(["merge", "supersede", "prune"]),
  keep: z.string().optional(),
  absorb: z.array(z.string()).optional(),
  rewriteContent: z.string().optional(),
  newer: z.string().optional(),
  older: z.array(z.string()).optional(),
  memoryId: z.string().optional(),
  reason: z.string().optional(),
});

const challengeSchema = z.object({
  proposalIndex: z.number(),
  objection: z.string().nullable(),
  severity: z.enum(["low", "medium", "high"]),
});

const decisionSchema = z.object({
  proposalIndex: z.number(),
  approve: z.boolean(),
  rationale: z.string(),
});

const proposerResponseSchema = z.object({ proposals: z.array(proposalSchema) });
const adversaryResponseSchema = z.object({ challenges: z.array(challengeSchema) });
const judgeResponseSchema = z.object({ decisions: z.array(decisionSchema) });

interface Applied {
  proposalIndex: number;
  type: "merge" | "supersede" | "prune";
  summary: string;
}

function extractJson(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

interface ConsolidationDeps {
  env: Env;
  convex: ConvexHttpClient;
  provider: ReturnType<typeof createProvider>;
  broadcast: BroadcastFn;
  trigger: string;
}

type ConsolidationSource =
  | "consolidation-proposer"
  | "consolidation-adversary"
  | "consolidation-judge";

async function runLlm(
  provider: ReturnType<typeof createProvider>,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  source: ConsolidationSource,
  runId: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number; durationMs: number }> {
  const started = Date.now();
  const result = await generateText({
    model: provider(model),
    system: systemPrompt,
    prompt: userPrompt,
    headers: gatewayMetadataHeader({
      source,
      conversationId: runId,
      runId,
    }),
  });
  return {
    text: result.text,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
    durationMs: Date.now() - started,
  };
}

export async function runConsolidation(deps: ConsolidationDeps): Promise<{
  runId: string;
  proposals: number;
  merged: number;
  pruned: number;
}> {
  const { env, convex, provider, broadcast, trigger } = deps;
  const runId = randomId("cons");
  await convex.mutation(api.consolidation.createRun, { runId, trigger });
  broadcast("consolidation_started", { runId, trigger });

  let merged = 0;
  let pruned = 0;

  try {
    const memories = await convex.query(api.memoryRecords.list, {
      lifecycle: "active",
      limit: 150,
    });
    broadcast("consolidation_phase", { runId, phase: "loaded", memoriesCount: memories.length });
    if (memories.length < 6) {
      await convex.mutation(api.consolidation.updateRun, {
        runId,
        status: "completed",
        notes: "not enough memories to consolidate",
      });
      return { runId, proposals: 0, merged: 0, pruned: 0 };
    }

    const payload = memories
      .map(
        (m: {
          memoryId: string;
          tier: string;
          segment: string;
          importance: number;
          content: string;
          createdAt: number;
          metadata?: string;
        }) => {
          const ageDays = Math.round((Date.now() - m.createdAt) / 86400000);
          const prefix = `- [${m.memoryId}] (${m.tier}/${m.segment} i=${m.importance.toFixed(2)} age=${ageDays}d)`;
          let suffix = "";
          if (m.segment === "correction" && m.metadata) {
            try {
              const meta = JSON.parse(m.metadata) as { corrects?: string };
              if (meta.corrects) {
                const safe = meta.corrects
                  .replace(/[\r\n]+/g, " ")
                  .replace(/\]/g, "")
                  .trim()
                  .slice(0, 300);
                if (safe) suffix = ` [corrects: ${safe}]`;
              }
            } catch {
              /* metadata not JSON — ignore */
            }
          }
          return `${prefix} ${m.content}${suffix}`;
        },
      )
      .join("\n");

    broadcast("consolidation_phase", { runId, phase: "proposing" });
    const proposerCall = await runLlm(
      provider,
      PROPOSER_PROMPT,
      payload,
      env.MODEL_PROPOSER,
      "consolidation-proposer",
      runId,
    );
    await convex.mutation(api.usageRecords.record, {
      source: "consolidation-proposer",
      runId,
      model: env.MODEL_PROPOSER,
      inputTokens: proposerCall.inputTokens,
      outputTokens: proposerCall.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      durationMs: proposerCall.durationMs,
    });
    const proposerRaw = extractJson(proposerCall.text);
    const proposerParsed = proposerResponseSchema.safeParse(proposerRaw);
    const proposals = proposerParsed.success ? proposerParsed.data.proposals : [];
    broadcast("consolidation_phase", {
      runId,
      phase: "proposed",
      proposalsCount: proposals.length,
      proposals,
    });

    await convex.mutation(api.consolidation.updateRun, {
      runId,
      proposalsCount: proposals.length,
    });

    if (proposals.length === 0) {
      await convex.mutation(api.consolidation.updateRun, {
        runId,
        status: "completed",
        notes: "no proposals",
      });
      return { runId, proposals: 0, merged: 0, pruned: 0 };
    }

    const proposalsList = proposals.map((p, i) => `#${i}: ${JSON.stringify(p)}`).join("\n");

    broadcast("consolidation_phase", { runId, phase: "challenging" });
    const adversaryPayload = `Proposals:\n${proposalsList}\n\nOriginal memories:\n${payload}`;
    const adversaryCall = await runLlm(
      provider,
      ADVERSARY_PROMPT,
      adversaryPayload,
      env.MODEL_ADVERSARY,
      "consolidation-adversary",
      runId,
    );
    await convex.mutation(api.usageRecords.record, {
      source: "consolidation-adversary",
      runId,
      model: env.MODEL_ADVERSARY,
      inputTokens: adversaryCall.inputTokens,
      outputTokens: adversaryCall.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      durationMs: adversaryCall.durationMs,
    });
    const adversaryRaw = extractJson(adversaryCall.text);
    const adversaryParsed = adversaryResponseSchema.safeParse(adversaryRaw);
    const challenges = adversaryParsed.success ? adversaryParsed.data.challenges : [];
    broadcast("consolidation_phase", {
      runId,
      phase: "challenged",
      challengesCount: challenges.length,
      challenges,
    });

    const challengesByIndex = new Map(challenges.map((c) => [c.proposalIndex, c]));
    const challengesBlock = proposals
      .map((_p, i) => {
        const c = challengesByIndex.get(i);
        if (!c?.objection) return `#${i}: adversary raised no objection`;
        return `#${i}: [${c.severity}] ${c.objection}`;
      })
      .join("\n");

    const judgePayload = `Proposals:\n${proposalsList}\n\nAdversary challenges:\n${challengesBlock}\n\nOriginal memories:\n${payload}`;

    broadcast("consolidation_phase", { runId, phase: "judging" });
    const judgeCall = await runLlm(
      provider,
      JUDGE_PROMPT,
      judgePayload,
      env.MODEL_JUDGE,
      "consolidation-judge",
      runId,
    );
    await convex.mutation(api.usageRecords.record, {
      source: "consolidation-judge",
      runId,
      model: env.MODEL_JUDGE,
      inputTokens: judgeCall.inputTokens,
      outputTokens: judgeCall.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      durationMs: judgeCall.durationMs,
    });
    const judgeRaw = extractJson(judgeCall.text);
    const judgeParsed = judgeResponseSchema.safeParse(judgeRaw);
    const decisions = judgeParsed.success ? judgeParsed.data.decisions : [];
    const approved = new Set(decisions.filter((d) => d.approve).map((d) => d.proposalIndex));
    broadcast("consolidation_phase", {
      runId,
      phase: "judged",
      approvedCount: approved.size,
      rejectedCount: decisions.length - approved.size,
      decisions,
    });

    const applied: Applied[] = [];
    broadcast("consolidation_phase", { runId, phase: "applying" });
    for (let i = 0; i < proposals.length; i++) {
      if (!approved.has(i)) continue;
      const p = proposals[i];
      if (!p) continue;
      try {
        if (p.type === "merge" && p.keep && p.absorb?.length && p.rewriteContent) {
          const keep = memories.find((m: { memoryId: string }) => m.memoryId === p.keep);
          if (!keep) continue;
          await convex.mutation(api.memoryRecords.upsert, {
            memoryId: keep.memoryId,
            content: p.rewriteContent,
            tier: keep.tier,
            segment: keep.segment,
            importance: keep.importance,
            decayRate: keep.decayRate,
            supersedes: p.absorb,
          });
          merged++;
          applied.push({
            proposalIndex: i,
            type: "merge",
            summary: `merged ${p.absorb.length} into ${p.keep}`,
          });
        } else if (p.type === "supersede" && p.newer && p.older?.length) {
          const newer = memories.find((m: { memoryId: string }) => m.memoryId === p.newer);
          if (!newer) continue;
          await convex.mutation(api.memoryRecords.upsert, {
            memoryId: newer.memoryId,
            content: newer.content,
            tier: newer.tier,
            segment: newer.segment,
            importance: newer.importance,
            decayRate: newer.decayRate,
            supersedes: p.older,
          });
          merged++;
          applied.push({
            proposalIndex: i,
            type: "supersede",
            summary: `${p.newer} supersedes ${p.older.length} older`,
          });
        } else if (p.type === "prune" && p.memoryId) {
          await convex.mutation(api.memoryRecords.setLifecycle, {
            memoryId: p.memoryId,
            lifecycle: "pruned",
          });
          pruned++;
          applied.push({
            proposalIndex: i,
            type: "prune",
            summary: `pruned ${p.memoryId}`,
          });
        }
      } catch (err) {
        console.warn("[consolidation] apply failed", err);
      }
    }

    await convex.mutation(api.consolidation.updateRun, {
      runId,
      status: "completed",
      mergedCount: merged,
      prunedCount: pruned,
      details: JSON.stringify({
        memoriesScanned: memories.length,
        proposals,
        challenges,
        decisions,
        applied,
      }),
    });
    await convex.mutation(api.memoryEvents.emit, {
      eventType: "memory.consolidated",
      data: JSON.stringify({ runId, proposals: proposals.length, merged, pruned }),
    });
    broadcast("consolidation_completed", { runId, merged, pruned });
    return { runId, proposals: proposals.length, merged, pruned };
  } catch (err) {
    await convex.mutation(api.consolidation.updateRun, {
      runId,
      status: "failed",
      notes: String(err),
    });
    broadcast("consolidation_failed", { runId, error: String(err) });
    throw err;
  }
}
