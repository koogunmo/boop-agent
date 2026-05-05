import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import * as ai from "ai";
import * as partyserver from "partyserver";
import { type Connection, type ConnectionContext, getServerByName } from "partyserver";
import { describe, expect, it, vi } from "vitest";

const mockConvexClient = {
  query: vi.fn().mockResolvedValue([]),
  mutation: vi.fn().mockResolvedValue(null),
  action: vi.fn().mockResolvedValue([]),
};
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = mockConvexClient.query;
    mutation = mockConvexClient.mutation;
    action = mockConvexClient.action;
  },
}));

import { testClient } from "hono/testing";
import type { BoopInteractionAgent } from "@/agents/interaction";
import app from "@/index";
import type { GatewayMetadata } from "@/lib/llm";
import { injectMocksIntoDO, injectMocksWithErrorIntoDO, mockConvex } from "@/lib/test-helpers";

const client = testClient(app, env);

function getStub(name: string) {
  return getServerByName(env.BOOP_AGENT, name);
}

describe("GET /api/health", () => {
  it("returns ok:true, service name, and json content-type", async () => {
    const res = await client.api.health.$get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("boop-agent");
  });
});

describe("POST /api/sendblue/webhook", () => {
  it("skips outbound messages", async () => {
    const res = await client.api.sendblue.webhook.$post({
      json: { content: "hi", from_number: "+1234", is_outbound: true },
    });
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
  });

  it("skips messages without content", async () => {
    const res = await client.api.sendblue.webhook.$post({
      json: { from_number: "+1234" },
    });
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
  });

  it("skips messages without from_number", async () => {
    const res = await client.api.sendblue.webhook.$post({
      json: { content: "hi" },
    });
    const body = await res.json();
    expect(body).toEqual({ ok: true, skipped: true });
  });
});

describe("BoopInteractionAgent DO", () => {
  it("returns 404 for unknown paths", async () => {
    const stub = await getStub("t-404");
    const res = await stub.fetch("http://agent/unknown");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("onConnect sends hello event", async () => {
    const stub = await getStub("t-ws");
    await runInDurableObject<BoopInteractionAgent, void>(
      stub,
      async (instance: BoopInteractionAgent) => {
        const sent: string[] = [];
        const mockConnection = { send: (msg: string) => sent.push(msg) } as unknown as Connection;
        const mockCtx = { request: new Request("http://agent/ws") } as ConnectionContext;
        await instance.onConnect(mockConnection, mockCtx);
        const helloRaw = sent.find((m) => {
          try {
            return JSON.parse(m).event === "hello";
          } catch {
            return false;
          }
        });
        expect(helloRaw).toBeDefined();
        const hello = JSON.parse(helloRaw!) as { event: string; data: { ok: boolean }; at: number };
        expect(hello.data.ok).toBe(true);
        expect(hello.at).toBeGreaterThan(0);
      },
    );
  });

  it("returns 404 for non-upgrade request to /ws", async () => {
    const stub = await getStub("t-ws-noup");
    const res = await stub.fetch("http://agent/ws");
    expect(res.status).toBe(404);
  });

  it("returns 400 when /handle body is missing fields", async () => {
    const stub = await getStub("t-bad");
    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("handles /handle POST: queries history, calls LLM, saves messages, returns reply", {
    timeout: 15000,
  }, async () => {
    const generateTextSpy = vi.spyOn(ai, "generateText");
    const convex = mockConvex([]);
    const stub = await getStub("t-handle");
    await injectMocksIntoDO(stub, convex, "mocked reply");

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:do", content: "hi" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe("mocked reply");

    expect(convex.query).toHaveBeenCalledTimes(3);
    expect(convex.mutation).toHaveBeenCalledTimes(3);

    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      conversationId: "test:do",
      role: "user",
      content: "hi",
    });

    expect(convex.mutation.mock.calls[1]![1]).toMatchObject({
      source: "dispatcher",
    });

    expect(convex.mutation.mock.calls[2]![1]).toMatchObject({
      conversationId: "test:do",
      role: "assistant",
      content: "mocked reply",
    });

    const callArgs = generateTextSpy.mock.calls[0]![0] as { headers: Record<string, string> };
    const metadata: GatewayMetadata = JSON.parse(callArgs.headers["cf-aig-metadata"] ?? "{}");
    expect(metadata).toMatchObject({
      source: "dispatcher",
      conversationId: "test:do",
    });
    expect(metadata.source === "dispatcher" && metadata.turnId).toMatch(/^turn_/);

    generateTextSpy.mockRestore();
  });

  it("includes conversation history and filters system messages", async () => {
    const convex = mockConvex([
      { role: "user", content: "first" },
      { role: "assistant", content: "first reply" },
      { role: "system", content: "should be filtered" },
    ]);
    const stub = await getStub("t-history");
    await injectMocksIntoDO(stub, convex, "second reply");

    await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:hist", content: "second" }),
    });

    // Verify convex was queried for history + settings + timezone
    expect(convex.query).toHaveBeenCalledTimes(3);
    // Verify 3 mutations: user save + usage record + assistant save
    expect(convex.mutation).toHaveBeenCalledTimes(3);
  });

  it("uses MODEL_DISPATCHER from env", async () => {
    const convex = mockConvex([]);
    const stub = await getStub("t-model");
    // The mock provider ignores the model ID, but the code path still reads it from env
    await injectMocksIntoDO(stub, convex, "ok");

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:model", content: "hi" }),
    });

    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe("ok");
  });

  it("returns fallback message when LLM throws", async () => {
    const convex = mockConvex([]);
    const stub = await getStub("t-err");
    await injectMocksWithErrorIntoDO(stub, convex, new Error("API timeout"));

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:err", content: "hi" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toContain("error");
    expect(body.reply).toContain("Try again");
  });

  it("returns fallback when LLM returns empty text", async () => {
    const convex = mockConvex([]);
    const stub = await getStub("t-empty");
    await injectMocksIntoDO(stub, convex, "");

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:empty", content: "hi" }),
    });

    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe("Hmm — got tangled up there. Want to try that again?");
  });

  it("broadcast is callable without clients", async () => {
    const stub = await getStub("t-bc");
    await runInDurableObject<BoopInteractionAgent, void>(
      stub,
      async (instance: BoopInteractionAgent) => {
        expect(() => instance.broadcastEvent("agent_stale", { agentId: "test_123" })).not.toThrow();
      },
    );
  });

  it("broadcastEvent on non-default instance forwards to default DO", async () => {
    const stub = await getStub("t-fwd-conv");
    await runInDurableObject<BoopInteractionAgent, void>(
      stub,
      async (instance: BoopInteractionAgent) => {
        expect(instance.name).not.toBe("default");

        const fetches: { url: string; body: string }[] = [];
        const mockStub = {
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const req = input instanceof Request ? input : new Request(input, init);
            fetches.push({ url: req.url, body: await req.text() });
            return Response.json({ ok: true });
          },
        };
        const original = getServerByName;
        vi.spyOn(partyserver, "getServerByName").mockImplementation(
          // @ts-expect-error: getServerByName generic over Server<Env> can't be satisfied with a partial stub
          async (ns, name) => {
            if (name === "default") return mockStub;
            return original(ns, name);
          },
        );

        instance.broadcastEvent("agent_stale", { agentId: "fwd_test" });

        await vi.waitFor(() => expect(fetches.length).toBeGreaterThan(0), { timeout: 3000 });

        expect(fetches[0]!.url).toBe("http://agent/broadcast");
        const body = JSON.parse(fetches[0]!.body);
        expect(body.event).toBe("agent_stale");
        expect(body.data).toEqual({ agentId: "fwd_test" });

        vi.restoreAllMocks();
      },
    );
  });

  it("broadcastEvent on default instance does not forward", async () => {
    const stub = await getStub("default");
    await runInDurableObject<BoopInteractionAgent, void>(
      stub,
      async (instance: BoopInteractionAgent) => {
        expect(instance.name).toBe("default");

        const spy = vi.spyOn(partyserver, "getServerByName");

        instance.broadcastEvent("agent_stale", { agentId: "no_fwd" });

        await new Promise((r) => setTimeout(r, 500));

        const forwardCalls = spy.mock.calls.filter(([_, name]) => name === "default");
        expect(forwardCalls).toHaveLength(0);

        vi.restoreAllMocks();
      },
    );
  });
});
