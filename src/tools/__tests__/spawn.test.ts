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
    const mockStub = { fetch: mockStubFetch };
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
});
