import { afterEach, describe, expect, it, vi } from "vitest";
import type { IComposioClient } from "@/lib/composio";
import { buildComposioTools } from "@/lib/composio-tools";

function mockComposioClient(
  rawTools: Array<{
    slug: string;
    name: string;
    description?: string;
    inputParameters?: Record<string, unknown>;
  }>,
  executeResult: { data: Record<string, unknown>; successful: boolean; error: string | null } = {
    data: { result: "ok" },
    successful: true,
    error: null,
  },
): IComposioClient {
  return {
    raw: {
      tools: {
        getRawComposioTools: vi.fn().mockResolvedValue(rawTools),
        execute: vi.fn().mockResolvedValue(executeResult),
      },
    },
    user: "test-user",
    listConnectedToolkits: vi.fn().mockResolvedValue([]),
  } as unknown as IComposioClient;
}

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

describe("buildComposioTools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns empty object when no toolkit slugs provided", async () => {
    const client = mockComposioClient([]);
    const tools = await buildComposioTools(client, []);
    expect(tools).toEqual({});
  });

  it("converts raw Composio tools to AI SDK tools", async () => {
    const client = mockComposioClient([
      {
        slug: "GMAIL_SEND_EMAIL",
        name: "Send Email",
        description: "Send an email via Gmail",
        inputParameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email" },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["to", "subject", "body"],
        },
      },
    ]);

    const tools = await buildComposioTools(client, ["gmail"]);

    expect(Object.keys(tools)).toEqual(["GMAIL_SEND_EMAIL"]);
    const tool = tools.GMAIL_SEND_EMAIL;
    expect(tool).toBeDefined();
    expect(tool?.description).toBe("Send an email via Gmail");
  });

  it("uses tool name as description when description is missing", async () => {
    const client = mockComposioClient([
      { slug: "TEST_TOOL", name: "Test Tool", inputParameters: { type: "object", properties: {} } },
    ]);

    const tools = await buildComposioTools(client, ["test"]);
    expect(tools.TEST_TOOL?.description).toBe("Test Tool");
  });

  it("executes tool via composio client and returns JSON data", async () => {
    const executeResult = { data: { messageId: "abc123" }, successful: true, error: null };
    const client = mockComposioClient(
      [
        {
          slug: "GMAIL_SEND_EMAIL",
          name: "Send",
          inputParameters: { type: "object", properties: { to: { type: "string" } } },
        },
      ],
      executeResult,
    );

    const tools = await buildComposioTools(client, ["gmail"]);
    const result = await tools.GMAIL_SEND_EMAIL?.execute?.({ to: "user@test.com" }, toolOpts);

    expect(result).toBe(JSON.stringify({ messageId: "abc123" }));
    expect(client.raw.tools.execute).toHaveBeenCalledWith("GMAIL_SEND_EMAIL", {
      userId: "test-user",
      arguments: { to: "user@test.com" },
      dangerouslySkipVersionCheck: true,
    });
  });

  it("returns error string when tool execution fails", async () => {
    const client = mockComposioClient(
      [
        {
          slug: "SLACK_SEND",
          name: "Send",
          inputParameters: { type: "object", properties: {} },
        },
      ],
      { data: {}, successful: false, error: "Channel not found" },
    );

    const tools = await buildComposioTools(client, ["slack"]);
    const result = await tools.SLACK_SEND?.execute?.({}, toolOpts);

    expect(result).toBe("Tool execution failed: Channel not found");
  });

  it("handles multiple tools from one toolkit", async () => {
    const client = mockComposioClient([
      {
        slug: "GITHUB_LIST_REPOS",
        name: "List Repos",
        inputParameters: { type: "object", properties: {} },
      },
      {
        slug: "GITHUB_CREATE_ISSUE",
        name: "Create Issue",
        inputParameters: { type: "object", properties: {} },
      },
      {
        slug: "GITHUB_GET_PR",
        name: "Get PR",
        inputParameters: { type: "object", properties: {} },
      },
    ]);

    const tools = await buildComposioTools(client, ["github"]);
    expect(Object.keys(tools)).toHaveLength(3);
    expect(Object.keys(tools)).toEqual([
      "GITHUB_LIST_REPOS",
      "GITHUB_CREATE_ISSUE",
      "GITHUB_GET_PR",
    ]);
  });

  it("defaults to empty object schema when inputParameters is missing", async () => {
    const client = mockComposioClient([{ slug: "SIMPLE_TOOL", name: "Simple" }]);

    const tools = await buildComposioTools(client, ["simple"]);
    expect(tools.SIMPLE_TOOL).toBeDefined();
    expect(tools.SIMPLE_TOOL?.description).toBe("Simple");
  });

  it("passes toolkit slugs and task hint to getRawComposioTools", async () => {
    const client = mockComposioClient([]);
    await buildComposioTools(client, ["gmail", "slack", "github"], undefined, "check my emails");

    expect(client.raw.tools.getRawComposioTools).toHaveBeenCalledWith({
      toolkits: ["gmail", "slack", "github"],
      search: "check my emails",
      limit: 15,
    });
  });

  it("uses important filter when no tool hint", async () => {
    const client = mockComposioClient([]);
    await buildComposioTools(client, ["gmail"]);

    expect(client.raw.tools.getRawComposioTools).toHaveBeenCalledWith({
      toolkits: ["gmail"],
      important: true,
      limit: 15,
    });
  });
});

describe("multi-account support", () => {
  afterEach(() => vi.restoreAllMocks());

  it("injects connectedAccountId into schema when 2+ accounts", async () => {
    const client = mockComposioClient([
      {
        slug: "GMAIL_SEND_EMAIL",
        name: "Send Email",
        description: "Send an email",
        inputParameters: {
          type: "object",
          properties: { to: { type: "string" } },
          required: ["to"],
        },
      },
    ]);
    (client.listConnectedToolkits as ReturnType<typeof vi.fn>).mockResolvedValue([
      { slug: "gmail", connectionId: "ca_work", status: "ACTIVE", accountLabel: "work@co.com" },
      {
        slug: "gmail",
        connectionId: "ca_personal",
        status: "ACTIVE",
        accountLabel: "me@gmail.com",
      },
    ]);

    const tools = await buildComposioTools(client, ["gmail"]);
    const tool = tools.GMAIL_SEND_EMAIL;

    expect(tool?.description).toBe("Send an email");
  });

  it("passes connectedAccountId to execute and strips from args", async () => {
    const executeResult = { data: { sent: true }, successful: true, error: null };
    const client = mockComposioClient(
      [
        {
          slug: "GMAIL_SEND_EMAIL",
          name: "Send",
          inputParameters: { type: "object", properties: { to: { type: "string" } } },
        },
      ],
      executeResult,
    );
    (client.listConnectedToolkits as ReturnType<typeof vi.fn>).mockResolvedValue([
      { slug: "gmail", connectionId: "ca_work", status: "ACTIVE", accountLabel: "work@co.com" },
      {
        slug: "gmail",
        connectionId: "ca_personal",
        status: "ACTIVE",
        accountLabel: "me@gmail.com",
      },
    ]);

    const tools = await buildComposioTools(client, ["gmail"]);
    await tools.GMAIL_SEND_EMAIL?.execute?.(
      { to: "user@test.com", connectedAccountId: "ca_work" },
      toolOpts,
    );

    expect(client.raw.tools.execute).toHaveBeenCalledWith("GMAIL_SEND_EMAIL", {
      userId: "test-user",
      connectedAccountId: "ca_work",
      arguments: { to: "user@test.com" },
      dangerouslySkipVersionCheck: true,
    });
  });

  it("ignores inactive accounts for multi-account check", async () => {
    const client = mockComposioClient([
      {
        slug: "GMAIL_SEND_EMAIL",
        name: "Send",
        description: "Send an email",
        inputParameters: { type: "object", properties: {} },
      },
    ]);
    (client.listConnectedToolkits as ReturnType<typeof vi.fn>).mockResolvedValue([
      { slug: "gmail", connectionId: "ca_active", status: "ACTIVE", accountLabel: "a@test.com" },
      { slug: "gmail", connectionId: "ca_expired", status: "EXPIRED", accountLabel: "b@test.com" },
    ]);

    const tools = await buildComposioTools(client, ["gmail"]);
    expect(tools.GMAIL_SEND_EMAIL?.description).toBe("Send an email");
  });
});
