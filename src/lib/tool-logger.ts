interface ComposioAccountFields {
  account?: string;
  connectedAccountId?: string;
  connected_account_id?: string;
  accounts?: string[];
  tools?: ComposioAccountFields[];
}

export type ToolArgs = Record<string, unknown> & Partial<ComposioAccountFields>;

export interface ToolCallLogger {
  onToolCall(toolName: string, args: ToolArgs): Promise<void>;
  onToolResult(toolName: string, result: unknown): Promise<void>;
}

const ACCOUNT_KEYS: ReadonlyArray<keyof Omit<ComposioAccountFields, "accounts" | "tools">> = [
  "account",
  "connectedAccountId",
  "connected_account_id",
];

export function extractAccounts(args: ToolArgs): string[] {
  const accounts = new Set<string>();
  const collect = (v: string | undefined) => {
    if (v?.trim()) accounts.add(v.trim());
  };
  for (const key of ACCOUNT_KEYS) collect(args[key]);
  if (Array.isArray(args.accounts)) args.accounts.forEach(collect);
  if (Array.isArray(args.tools)) {
    for (const t of args.tools) {
      for (const key of ACCOUNT_KEYS) collect(t[key]);
    }
  }
  return [...accounts];
}
