import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { createSpawnTools } from "@/tools/spawn";

const CONV_ID = "test:conv";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

describe("spawn_agent", () => {
  it("spawns an execution agent via DO stub and returns result", async () => {
    const convex = mockConvex();
    const broadcast = vi.fn();

    const mockStubFetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ agentId: "agent_test", result: "Found 3 emails", status: "completed" }),
      );
    const mockStub = { fetch: mockStubFetch, setName: vi.fn() };
    const mockExecAgent = {
      idFromName: vi.fn().mockReturnValue("do-id-123"),
      get: vi.fn().mockReturnValue(mockStub),
    };
    const env = testEnv();
    (env as unknown as Record<string, unknown>).EXEC_AGENT = mockExecAgent;

    const tools = createSpawnTools({
      convex: cvx(convex),
      env,
      conversationId: CONV_ID,
      broadcast,
    });

    const result = await tools.spawn_agent.execute!(
      { task: "Check email", integrations: ["gmail"], name: "email-check" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toBe("Found 3 emails");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith(
      "agent_spawned",
      expect.objectContaining({ name: "email-check" }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      "agent_done",
      expect.objectContaining({ status: "completed" }),
    );
    expect(mockExecAgent.idFromName).toHaveBeenCalledOnce();
    expect(mockStubFetch).toHaveBeenCalledOnce();
  });

  it("integrations parameter accepts only available integrations when provided", () => {
    const tools = createSpawnTools({
      convex: cvx(mockConvex()),
      env: testEnv(),
      conversationId: CONV_ID,
      broadcast: vi.fn(),
      availableIntegrations: ["gmail", "slack", "github"],
    });

    const schema = tools.spawn_agent.inputSchema as unknown as {
      parse: (v: unknown) => {
        task: string;
        integrations: string[];
        name?: string;
        toolHint?: string;
      };
    };
    const valid = schema.parse({ task: "test", integrations: ["gmail", "slack"] });
    expect(valid.integrations).toEqual(["gmail", "slack"]);

    expect(() => schema.parse({ task: "test", integrations: ["brave_search"] })).toThrow();
    expect(() => schema.parse({ task: "test", integrations: ["notion"] })).toThrow();
  });

  it("integrations defaults to empty array when omitted", () => {
    const tools = createSpawnTools({
      convex: cvx(mockConvex()),
      env: testEnv(),
      conversationId: CONV_ID,
      broadcast: vi.fn(),
      availableIntegrations: ["gmail"],
    });

    const schema = tools.spawn_agent.inputSchema as unknown as {
      parse: (v: unknown) => {
        task: string;
        integrations: string[];
        name?: string;
        toolHint?: string;
      };
    };
    const parsed = schema.parse({ task: "test" });
    expect(parsed.integrations).toEqual([]);
  });

  it("rejects non-empty integrations when none are available", () => {
    const tools = createSpawnTools({
      convex: cvx(mockConvex()),
      env: testEnv(),
      conversationId: CONV_ID,
      broadcast: vi.fn(),
      availableIntegrations: [],
    });

    const schema = tools.spawn_agent.inputSchema as unknown as {
      parse: (v: unknown) => {
        task: string;
        integrations: string[];
        name?: string;
        toolHint?: string;
      };
    };
    expect(() => schema.parse({ task: "test", integrations: ["gmail"] })).toThrow();
    const parsed = schema.parse({ task: "test", integrations: [] });
    expect(parsed.integrations).toEqual([]);
  });
});
