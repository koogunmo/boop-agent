import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";

const gatewayLogEntrySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  provider: z.string(),
  model: z.string(),
  duration: z.number(),
  success: z.boolean(),
  cached: z.boolean(),
  tokens_in: z.number().nullable(),
  tokens_out: z.number().nullable(),
  cost: z.number().optional(),
  metadata: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

const gatewayLogResponseSchema = z.object({
  success: z.literal(true),
  result: z.array(gatewayLogEntrySchema),
  result_info: z.object({
    total_count: z.number(),
    page: z.number(),
    per_page: z.number(),
  }),
});

type GatewayLogResponse = z.infer<typeof gatewayLogResponseSchema>;

const metadataSchema = z.object({
  source: z.string(),
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
  turnId: z.string().optional(),
  runId: z.string().optional(),
});
type ParsedMetadata = z.infer<typeof metadataSchema>;

export interface BackfillDeps {
  env: Env;
  convex: ConvexHttpClient;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
  };
}

const LAST_BACKFILL_KEY = "lastBackfillAt";
const PER_PAGE = 50;

async function fetchLogPage(
  env: Env,
  page: number,
  since: Date,
): Promise<GatewayLogResponse | null> {
  const filters = JSON.stringify([
    { key: "created_at", operator: "gt", value: [since.toISOString()] },
  ]);
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(PER_PAGE),
    order_by: "created_at",
    order_by_direction: "asc",
    filters,
  });
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai-gateway/gateways/${env.CF_GATEWAY_ID}/logs?${params}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  });

  if (!res.ok) {
    console.error(`[cost-backfill] gateway API error: ${res.status}`);
    return null;
  }

  const raw: unknown = await res.json();
  const data = gatewayLogResponseSchema.safeParse(raw);
  return data.success ? data.data : null;
}

function parseMetadata(raw: string | Record<string, unknown>): ParsedMetadata | null {
  const obj =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!obj) return null;
  const parsed = metadataSchema.safeParse(obj);
  return parsed.success ? parsed.data : null;
}

async function updateConvexRecords(
  convex: ConvexHttpClient,
  meta: ParsedMetadata,
  cost: number,
): Promise<number> {
  let matched = 0;

  if (meta.agentId) {
    await convex.mutation(api.agents.update, {
      agentId: meta.agentId,
      costUsd: cost,
    });
    matched++;
  }

  if (meta.turnId || meta.runId) {
    try {
      await convex.mutation(api.usageRecords.updateCost, {
        source: meta.source,
        ...(meta.turnId ? { turnId: meta.turnId } : {}),
        ...(meta.runId ? { runId: meta.runId } : {}),
        ...(meta.agentId ? { agentId: meta.agentId } : {}),
        costUsd: cost,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
      matched++;
    } catch {
      // record may not exist
    }
  }

  return matched;
}

export async function backfillCosts(deps: BackfillDeps): Promise<{
  processed: number;
  matched: number;
}> {
  const { env, convex, storage } = deps;
  const lastBackfillAt =
    (await storage.get<number>(LAST_BACKFILL_KEY)) ?? Date.now() - 10 * 60 * 1000;
  const now = Date.now();

  let processed = 0;
  let matched = 0;
  let page = 1;
  const since = new Date(lastBackfillAt);

  for (;;) {
    const data = await fetchLogPage(env, page, since);
    if (!data || data.result.length === 0) break;

    for (const entry of data.result) {
      const entryTime = new Date(entry.created_at).getTime();
      if (entryTime > now) continue;

      processed++;

      if (!entry.metadata || entry.cost === undefined) continue;

      const meta = parseMetadata(entry.metadata);
      if (!meta) continue;

      matched += await updateConvexRecords(convex, meta, entry.cost);
    }

    if (data.result.length < PER_PAGE) break;
    page++;
  }

  await storage.put(LAST_BACKFILL_KEY, now);
  console.log(`[cost-backfill] processed=${processed} matched=${matched}`);
  return { processed, matched };
}
