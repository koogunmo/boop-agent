import { api } from "@boop/convex";
import { tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { createComposioClient, FEATURED_SLUGS } from "@/lib/composio";
import { embeddingsAvailable } from "@/lib/embeddings";

const KNOWN_MODELS = new Set<string>([
  "workers-ai/@cf/moonshotai/kimi-k2.6",
  "workers-ai/@cf/moonshotai/kimi-k2.5",
  "workers-ai/@cf/zai-org/glm-4.7-flash",
  "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  "anthropic/claude-opus-4-7",
]);

const MODEL_ALIASES: Record<string, string> = {
  kimi: "workers-ai/@cf/moonshotai/kimi-k2.6",
  "kimi k2.6": "workers-ai/@cf/moonshotai/kimi-k2.6",
  glm: "workers-ai/@cf/zai-org/glm-4.7-flash",
  "glm flash": "workers-ai/@cf/zai-org/glm-4.7-flash",
  sonnet: "anthropic/claude-sonnet-4-6",
  "sonnet 4.6": "anthropic/claude-sonnet-4-6",
  haiku: "anthropic/claude-haiku-4-5",
  "haiku 4.5": "anthropic/claude-haiku-4-5",
  opus: "anthropic/claude-opus-4-7",
  "opus 4.7": "anthropic/claude-opus-4-7",
};

function resolveModelInput(input: string): string | null {
  const lower = input.trim().toLowerCase();
  if (KNOWN_MODELS.has(lower)) return lower;
  return MODEL_ALIASES[lower] ?? null;
}

interface SelfToolDeps {
  convex: ConvexHttpClient;
  env: Env;
}

export function createSelfTools(deps: SelfToolDeps) {
  const { convex, env } = deps;
  const composioClient = createComposioClient(env);

  return {
    get_config: tool({
      description:
        "Return Boop's runtime configuration: which Claude model it's using, which integrations are loaded, and basic env info. Use when the user asks 'what model are you?', 'what version?', or anything about the agent itself.",
      inputSchema: z.object({}),
      execute: async () => {
        const MODEL_KEY = "model";
        let storedModel: string | null = null;
        try {
          storedModel = await convex.query(api.settings.get, {
            key: MODEL_KEY,
          });
        } catch {
          // settings query may fail if table is empty
        }

        const model = storedModel && KNOWN_MODELS.has(storedModel) ? storedModel : env.BOOP_MODEL;

        const config = {
          model,
          envDefault: env.BOOP_MODEL,
          availableModels: [...KNOWN_MODELS],
          composioEnabled: Boolean(env.COMPOSIO_API_KEY),
          embeddingsEnabled: embeddingsAvailable(env),
          sendblueEnabled: Boolean(env.SENDBLUE_API_KEY),
        };

        return JSON.stringify(config, null, 2);
      },
    }),

    set_model: tool({
      description: `Switch the Claude model used for both this dispatcher and any sub-agents. The change applies to the *next* turn (this turn finishes on the current model). Accepts either a canonical ID or a friendly alias.

Aliases: ${Object.keys(MODEL_ALIASES)
        .map((k) => `"${k}"`)
        .join(", ")}
Canonical: ${[...KNOWN_MODELS].map((k) => `"${k}"`).join(", ")}

Use when the user says "use opus", "switch to sonnet", "make it faster (haiku)", etc.

Cost note (approximate, per 1M output tokens): Opus 4.7 ≈ $75, Sonnet 4.6 ≈ $15, Haiku 4.5 ≈ $4. Mention briefly when switching to Opus.`,
      inputSchema: z.object({
        model: z
          .string()
          .describe('Model to use. Canonical ID like "claude-opus-4-7" or alias like "opus".'),
      }),
      execute: async (args) => {
        const resolved = resolveModelInput(args.model);
        if (!resolved) {
          return `Unknown model "${args.model}". Try one of: ${[...KNOWN_MODELS].join(", ")} or aliases ${Object.keys(MODEL_ALIASES).join(", ")}.`;
        }
        await convex.mutation(api.settings.set, {
          key: "model",
          value: resolved,
        });
        return `Model override set to ${resolved}. Next agent run (interaction or sub-agent) will use it. This current turn keeps the previous model.`;
      },
    }),

    list_integrations: tool({
      description:
        "List the user's currently connected integrations (Gmail, Slack, etc.) with the actual account behind each connection. Use when the user asks 'what tools do I have connected?' or 'which Gmail account?' or 'what integrations are set up?'.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!composioClient) return "Composio is not configured (no API key).";

        const [connected, meta] = await Promise.all([
          composioClient.listConnectedToolkits(),
          composioClient.listToolkitMeta(),
        ]);
        const active = connected.filter((c) => c.status === "ACTIVE");
        if (active.length === 0) {
          return "No integrations connected. The user can connect toolkits from the dashboard.";
        }

        const lines = active.map((c) => {
          const name = meta.get(c.slug)?.name ?? c.slug;
          const label = c.accountLabel ?? c.alias ?? "unknown account";
          return `• ${name} — ${label}`;
        });
        return lines.join("\n");
      },
    }),

    search_composio_catalog: tool({
      description:
        "Search Composio's full toolkit catalog (1000+ services) by keyword. Returns matching toolkit slugs and descriptions. Use when the user asks 'is there a tool for X?', 'can you connect to Y?', or 'is Z available?'.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Keyword to match against toolkit slug, name, or description (case-insensitive).",
          ),
        limit: z.number().int().min(1).max(50).optional().default(15),
      }),
      execute: async (args) => {
        if (!composioClient) return "Composio is not configured (no API key).";

        const meta = await composioClient.listToolkitMeta();
        const q = args.query.toLowerCase();
        const matches: Array<{ slug: string; name: string; description?: string | undefined }> = [];

        for (const [, m] of meta) {
          if (
            m.slug.includes(q) ||
            m.name.toLowerCase().includes(q) ||
            m.description?.toLowerCase().includes(q)
          ) {
            matches.push({ slug: m.slug, name: m.name, description: m.description });
          }
          if (matches.length >= args.limit) break;
        }

        if (matches.length === 0) {
          return `No toolkits found matching "${args.query}". Try a broader keyword.`;
        }

        return matches
          .map((m) => `• ${m.slug} — ${m.name}${m.description ? `: ${m.description}` : ""}`)
          .join("\n");
      },
    }),

    inspect_toolkit: tool({
      description:
        "Look up a specific Composio toolkit by exact slug. Returns whether it exists, whether it's currently connected, and (if requested) the list of tools it exposes. Use when the user asks 'what can the Slack tool do?' or 'is Notion connected?'.",
      inputSchema: z.object({
        slug: z
          .string()
          .describe("Exact toolkit slug, e.g. 'gmail', 'slack', 'notion', 'linear'. Lowercase."),
        includeTools: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, also fetch the toolkit's tool list (slower)."),
      }),
      execute: async (args) => {
        if (!composioClient) return "Composio is not configured (no API key).";

        const meta = await composioClient.listToolkitMeta();
        const m = meta.get(args.slug);
        if (!m) return `Toolkit "${args.slug}" not found in catalog.`;

        const connected = await composioClient.listConnectedToolkits();
        const conns = connected.filter((c) => c.slug === args.slug && c.status === "ACTIVE");

        const lines = [
          `**${m.name}** (\`${m.slug}\`)`,
          m.description ? `Description: ${m.description}` : null,
          FEATURED_SLUGS.has(args.slug) ? "Featured: yes" : null,
          `Connected: ${conns.length > 0 ? `yes (${conns.length} account${conns.length > 1 ? "s" : ""})` : "no"}`,
          m.toolsCount ? `Tools available: ${m.toolsCount}` : null,
        ];

        if (conns.length > 0) {
          for (const c of conns) {
            lines.push(`  • ${c.accountLabel ?? c.alias ?? c.connectionId}`);
          }
        }

        if (args.includeTools) {
          const tools = await composioClient.listToolsForToolkit(args.slug);
          if (tools.length > 0) {
            lines.push("", "Tools:");
            for (const t of tools) {
              lines.push(`  • ${t.name}${t.description ? ` — ${t.description}` : ""}`);
            }
          }
        }

        return lines.filter(Boolean).join("\n");
      },
    }),
  };
}
