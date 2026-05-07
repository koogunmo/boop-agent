import type { Tool } from "ai";
import { jsonSchema } from "ai";
import type { IComposioClient } from "@/lib/composio";
import type { ToolCallLogger } from "@/lib/tool-logger";

interface RawComposioTool {
  slug: string;
  name: string;
  description?: string;
  inputParameters?: Record<string, unknown>;
}

const MAX_TOOLS = 15;

interface AccountInfo {
  connectionId: string;
  label: string;
}

async function getAccountsByToolkit(
  client: IComposioClient,
  toolkitSlugs: string[],
): Promise<Map<string, AccountInfo[]>> {
  const connected = await client.listConnectedToolkits();
  const byToolkit = new Map<string, AccountInfo[]>();
  for (const c of connected) {
    if (c.status !== "ACTIVE" || !toolkitSlugs.includes(c.slug)) continue;
    const arr = byToolkit.get(c.slug) ?? [];
    arr.push({ connectionId: c.connectionId, label: c.accountLabel ?? c.alias ?? c.connectionId });
    byToolkit.set(c.slug, arr);
  }
  return byToolkit;
}

export async function buildComposioTools(
  client: IComposioClient,
  toolkitSlugs: string[],
  logger?: ToolCallLogger,
  toolHint?: string,
): Promise<Record<string, Tool>> {
  if (toolkitSlugs.length === 0) return {};

  const [rawTools, accountsByToolkit] = await Promise.all([
    client.raw.tools.getRawComposioTools({
      toolkits: toolkitSlugs,
      ...(toolHint ? { search: toolHint } : { important: true }),
      limit: MAX_TOOLS,
    }),
    getAccountsByToolkit(client, toolkitSlugs),
  ]);

  const tools: Record<string, Tool> = {};

  for (const raw of rawTools as RawComposioTool[]) {
    const params = raw.inputParameters ?? { type: "object", properties: {} };
    const slug = raw.slug;
    const toolkitSlug = slug.split("_")[0]?.toLowerCase() ?? "";
    const accounts = accountsByToolkit.get(toolkitSlug) ?? [];
    const multiAccount = accounts.length >= 2;

    const description = raw.description ?? raw.name;
    const schema = { ...params } as Record<string, unknown>;

    if (multiAccount) {
      const accountList = accounts.map((a) => `"${a.connectionId}" (${a.label})`).join(", ");
      const properties = (schema.properties ?? {}) as Record<string, unknown>;
      schema.properties = {
        ...properties,
        connectedAccountId: {
          type: "string",
          description: `Required — select which account. Options: ${accountList}`,
          enum: accounts.map((a) => a.connectionId),
        },
      };
      const required = Array.isArray(schema.required) ? [...schema.required] : [];
      required.push("connectedAccountId");
      schema.required = required;
    }

    tools[slug] = {
      description,
      inputSchema: jsonSchema(schema),
      execute: async (args: Record<string, unknown>) => {
        await logger?.onToolCall(slug, args);
        const connectedAccountId =
          typeof args.connectedAccountId === "string" ? args.connectedAccountId : undefined;
        const toolArgs = { ...args };
        delete toolArgs.connectedAccountId;
        const result = await client.raw.tools.execute(slug, {
          userId: client.user,
          ...(connectedAccountId ? { connectedAccountId } : {}),
          arguments: toolArgs,
          dangerouslySkipVersionCheck: true,
        });
        if (!result.successful) {
          const errMsg = `Tool execution failed: ${result.error ?? "unknown error"}`;
          await logger?.onToolResult(slug, errMsg);
          return errMsg;
        }
        const data = JSON.stringify(result.data);
        await logger?.onToolResult(slug, data);
        return data;
      },
    };
  }

  return tools;
}
