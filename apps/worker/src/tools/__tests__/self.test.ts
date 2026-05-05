import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as composioModule from "@/lib/composio";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { createSelfTools } from "@/tools/self";

function mockClient(overrides: {
  connected?: Array<{ slug: string; status: string; accountLabel?: string; alias?: string }>;
  meta?: Map<string, { slug: string; name: string; description?: string; toolsCount?: number }>;
  tools?: Array<{ slug: string; name: string; description?: string }>;
}) {
  return {
    raw: {} as composioModule.IComposioClient["raw"],
    user: "test-user",
    listConnectedToolkits: vi.fn().mockResolvedValue(overrides.connected ?? []),
    listToolkitMeta: vi.fn().mockResolvedValue(overrides.meta ?? new Map()),
    listToolsForToolkit: vi.fn().mockResolvedValue(overrides.tools ?? []),
    listToolkitSlugsWithAuthConfig: vi.fn().mockResolvedValue(new Set()),
    authorizeToolkit: vi.fn(),
    disconnectToolkit: vi.fn(),
    renameConnection: vi.fn(),
  } satisfies composioModule.IComposioClient;
}

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

describe("get_config", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns JSON config with userTimezone when explicitly set", async () => {
    const convex = mockConvex();
    convex.query.mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as { key: string };
      if (a.key === "user_timezone") return "America/Chicago";
      return null;
    });
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z
      .object({
        model: z.string(),
        envDefault: z.string(),
        availableModels: z.array(z.string()),
        userTimezone: z.string().nullable(),
        timezoneFallback: z.string().nullable(),
        currentLocalTime: z.string(),
        composioEnabled: z.boolean(),
        embeddingsEnabled: z.boolean(),
        sendblueEnabled: z.boolean(),
      })
      .parse(JSON.parse(z.string().parse(result)));

    expect(config.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(config.userTimezone).toBe("America/Chicago");
    expect(config.timezoneFallback).toBeNull();
    expect(config.currentLocalTime).toMatch(/\d{4}/);
  });

  it("returns timezoneFallback when no timezone set", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue(null);
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);
    const config = JSON.parse(z.string().parse(result));
    expect(config.userTimezone).toBeNull();
    expect(config.timezoneFallback).toMatch(/\w+\/\w+|UTC/);
    expect(config.currentLocalTime).toMatch(/\d{4}/);
  });

  it("uses stored model from settings when available and known", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("anthropic/claude-sonnet-4-6");
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z.object({ model: z.string() }).parse(JSON.parse(z.string().parse(result)));
    expect(config.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("falls back to env model when stored model is unknown", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("unknown-model");
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z.object({ model: z.string() }).parse(JSON.parse(z.string().parse(result)));
    expect(config.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
  });
});

describe("set_model", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves alias and calls settings.set", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!({ model: "opus" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("anthropic/claude-opus-4-7");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      key: "model",
      value: "anthropic/claude-opus-4-7",
    });
  });

  it("accepts canonical model ID", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!(
      { model: "workers-ai/@cf/moonshotai/kimi-k2.6" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(convex.mutation).toHaveBeenCalledOnce();
  });

  it("returns error for unknown model", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!({ model: "gpt-5-turbo" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Unknown model");
    expect(resultStr).toContain("gpt-5-turbo");
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});

describe("list_integrations", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns not configured message when no API key", async () => {
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(null);
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.list_integrations.execute!({}, toolOpts);
    expect(z.string().parse(result)).toContain("not configured");
  });

  it("returns connected integrations with labels", async () => {
    const meta = new Map([
      ["gmail", { slug: "gmail", name: "Gmail" }],
      ["slack", { slug: "slack", name: "Slack" }],
      ["github", { slug: "github", name: "GitHub" }],
    ]);
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(
      mockClient({
        connected: [
          { slug: "gmail", status: "ACTIVE", accountLabel: "user@gmail.com" },
          { slug: "slack", status: "ACTIVE", alias: "work-slack" },
          { slug: "github", status: "INACTIVE", accountLabel: "old-account" },
        ],
        meta,
      }),
    );
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z.string().parse(await tools.list_integrations.execute!({}, toolOpts));
    expect(result).toContain("Gmail");
    expect(result).toContain("user@gmail.com");
    expect(result).toContain("Slack");
    expect(result).toContain("work-slack");
    expect(result).not.toContain("old-account");
  });

  it("returns no integrations message when none connected", async () => {
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(mockClient({ connected: [] }));
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z.string().parse(await tools.list_integrations.execute!({}, toolOpts));
    expect(result).toContain("No integrations");
  });
});

describe("search_composio_catalog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns not configured when no API key", async () => {
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(null);
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.search_composio_catalog.execute!(
      { query: "email", limit: 10 },
      toolOpts,
    );
    expect(z.string().parse(result)).toContain("not configured");
  });

  it("searches toolkit metadata by keyword", async () => {
    const meta = new Map([
      ["gmail", { slug: "gmail", name: "Gmail", description: "Google email service" }],
      ["outlook", { slug: "outlook", name: "Outlook", description: "Microsoft email" }],
      ["slack", { slug: "slack", name: "Slack", description: "Team messaging" }],
    ]);
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(mockClient({ meta }));
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.search_composio_catalog.execute!({ query: "email", limit: 10 }, toolOpts));
    expect(result).toContain("gmail");
    expect(result).toContain("outlook");
    expect(result).not.toContain("slack");
  });

  it("respects limit parameter", async () => {
    const meta = new Map([
      ["a", { slug: "a", name: "A Tool", description: "test" }],
      ["b", { slug: "b", name: "B Tool", description: "test" }],
      ["c", { slug: "c", name: "C Tool", description: "test" }],
    ]);
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(mockClient({ meta }));
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.search_composio_catalog.execute!({ query: "test", limit: 2 }, toolOpts));
    const lines = result.split("\n").filter((l) => l.startsWith("•"));
    expect(lines).toHaveLength(2);
  });

  it("returns no results message for unmatched query", async () => {
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(
      mockClient({ meta: new Map() }),
    );
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.search_composio_catalog.execute!({ query: "zzzzz", limit: 10 }, toolOpts));
    expect(result).toContain("No toolkits found");
  });
});

describe("inspect_toolkit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns not configured when no API key", async () => {
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(null);
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.inspect_toolkit.execute!(
      { slug: "gmail", includeTools: false },
      toolOpts,
    );
    expect(z.string().parse(result)).toContain("not configured");
  });

  it("returns toolkit info with connection status", async () => {
    const meta = new Map([
      ["gmail", { slug: "gmail", name: "Gmail", description: "Email", toolsCount: 42 }],
    ]);
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(
      mockClient({
        meta,
        connected: [{ slug: "gmail", status: "ACTIVE", accountLabel: "me@gmail.com" }],
      }),
    );
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(
        await tools.inspect_toolkit.execute!({ slug: "gmail", includeTools: false }, toolOpts),
      );
    expect(result).toContain("Gmail");
    expect(result).toContain("Email");
    expect(result).toContain("yes (1 account)");
    expect(result).toContain("me@gmail.com");
    expect(result).toContain("42");
  });

  it("returns not found for unknown toolkit", async () => {
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(
      mockClient({ meta: new Map() }),
    );
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(
        await tools.inspect_toolkit.execute!(
          { slug: "nonexistent", includeTools: false },
          toolOpts,
        ),
      );
    expect(result).toContain("not found");
  });

  it("includes tool list when includeTools is true", async () => {
    const meta = new Map([["slack", { slug: "slack", name: "Slack", description: "Messaging" }]]);
    const client = mockClient({
      meta,
      connected: [],
      tools: [
        { slug: "SLACK_SEND", name: "Send Message", description: "Post to a channel" },
        { slug: "SLACK_LIST", name: "List Channels" },
      ],
    });
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue(client);
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.inspect_toolkit.execute!({ slug: "slack", includeTools: true }, toolOpts));
    expect(result).toContain("Send Message");
    expect(result).toContain("Post to a channel");
    expect(result).toContain("List Channels");
    expect(client.listToolsForToolkit).toHaveBeenCalledWith("slack");
  });
});

describe("set_timezone", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stores IANA timezone in settings", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.set_timezone.execute!({ timezone: "America/New_York" }, toolOpts));

    expect(result).toContain("America/New_York");
    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      key: "user_timezone",
      value: "America/New_York",
    });
  });

  it("rejects invalid timezone", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.set_timezone.execute!({ timezone: "Mars/Olympus_Mons" }, toolOpts));

    expect(result).toContain("not a valid");
    expect(convex.mutation).not.toHaveBeenCalled();
  });

  it("accepts common aliases like 'Eastern' or 'Pacific'", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = z
      .string()
      .parse(await tools.set_timezone.execute!({ timezone: "Eastern" }, toolOpts));

    expect(result).toContain("America/New_York");
    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      key: "user_timezone",
      value: "America/New_York",
    });
  });
});
