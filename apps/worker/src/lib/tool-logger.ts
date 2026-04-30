interface ComposioAccountFields {
  account?: string;
  connectedAccountId?: string;
  connected_account_id?: string;
  accounts?: string[];
  tools?: ComposioAccountFields[];
}

type ToolArgs = Record<string, unknown> & Partial<ComposioAccountFields>;

export interface ToolCallLogger {
  onToolCall(toolName: string, args: ToolArgs): Promise<void>;
  onToolResult(toolName: string, result: unknown): Promise<void>;
}

const ACCOUNT_KEYS: ReadonlyArray<keyof Omit<ComposioAccountFields, "accounts" | "tools">> = [
  "account",
  "connectedAccountId",
  "connected_account_id",
];

function isToolArgs(input: unknown): input is ToolArgs {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

export function extractAccounts(input: ToolArgs | unknown): string[] {
  if (!isToolArgs(input)) return [];
  const accounts = new Set<string>();
  const collect = (v: string | undefined) => {
    if (v?.trim()) accounts.add(v.trim());
  };
  for (const key of ACCOUNT_KEYS) collect(input[key]);
  if (Array.isArray(input.accounts)) input.accounts.forEach(collect);
  if (Array.isArray(input.tools)) {
    for (const t of input.tools) {
      for (const key of ACCOUNT_KEYS) collect(t[key]);
    }
  }
  return [...accounts];
}
