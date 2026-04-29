import { env } from "cloudflare:workers";
import * as ai from "ai";
import { getServerByName } from "partyserver";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = vi.fn().mockResolvedValue([]);
    mutation = vi.fn().mockResolvedValue(null);
    action = vi.fn().mockResolvedValue([]);
  },
}));

import type { GatewayMetadata } from "@/lib/llm";

function getStub(name: string) {
  return getServerByName(env.EXEC_AGENT, name);
}

describe("BoopExecutionAgent DO", () => {
  it("returns 404 for unknown paths", { timeout: 15000 }, async () => {
    const res = await (await getStub("t-exec-404")).fetch("http://agent/unknown");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("returns 404 for GET requests to /run", async () => {
    const res = await (await getStub("t-exec-get")).fetch("http://agent/run");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid /run body — empty object", async () => {
    const res = await (await getStub("t-exec-bad1")).fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("bad request");
  });

  it("returns 400 for /run body missing required fields", async () => {
    const res = await (await getStub("t-exec-bad2")).fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "do something" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when task is empty string", async () => {
    const res = await (await getStub("t-exec-bad3")).fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "",
        integrations: [],
        conversationId: "conv_1",
        agentId: "agent_1",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when agentId is empty string", async () => {
    const res = await (await getStub("t-exec-bad4")).fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "do something",
        integrations: [],
        conversationId: "conv_1",
        agentId: "",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when conversationId is empty string", async () => {
    const res = await (await getStub("t-exec-bad5")).fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "do something",
        integrations: [],
        conversationId: "",
        agentId: "agent_1",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("passes gateway metadata header to streamText", { timeout: 15000 }, async () => {
    const streamTextSpy = vi.spyOn(ai, "streamText").mockReturnValue({
      consumeStream: () => Promise.resolve(),
      text: Promise.resolve("mocked result"),
    } as unknown as ReturnType<typeof ai.streamText>);

    const res = await (await getStub("t-exec-meta")).fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "test task",
        integrations: [],
        conversationId: "conv_meta",
        agentId: "agent_meta",
      }),
    });

    expect(res.status).toBe(200);
    expect(streamTextSpy).toHaveBeenCalledOnce();
    const callArgs = streamTextSpy.mock.calls[0]![0] as { headers: Record<string, string> };
    const metadata: GatewayMetadata = JSON.parse(callArgs.headers["cf-aig-metadata"] ?? "{}");
    expect(metadata).toEqual({
      source: "execution",
      conversationId: "conv_meta",
      agentId: "agent_meta",
    } satisfies GatewayMetadata);

    streamTextSpy.mockRestore();
  });

  it("cancel endpoint returns cancelled:false when no task running", async () => {
    const res = await (await getStub("t-exec-cancel")).fetch("http://agent/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelled: boolean };
    expect(body.cancelled).toBe(false);
  });
});
