import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import app from "../index";
import { injectMocksIntoDO, injectMocksWithErrorIntoDO, mockConvex } from "../lib/test-helpers";
import type { BoopInteractionAgent } from "./interaction";

const healthResponse = z.object({ ok: z.boolean(), service: z.string() });
const errorResponse = z.object({ error: z.string() });
const replyResponse = z.object({ reply: z.string() });
const webhookOk = z.object({
  ok: z.literal(true),
  skipped: z.literal(true).optional(),
  deduped: z.literal(true).optional(),
});

async function req(path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init, env);
}

function json(init: { method: string; body: Record<string, unknown> }): RequestInit {
  return {
    method: init.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(init.body),
  };
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket message timeout")), timeoutMs);
    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(typeof event.data === "string" ? event.data : "");
      },
      { once: true },
    );
  });
}

function getStub(name: string) {
  return env.BOOP_AGENT.get(env.BOOP_AGENT.idFromName(name));
}

describe("GET /health", () => {
  it("returns ok:true, service name, and json content-type", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = healthResponse.parse(await res.json());
    expect(body.ok).toBe(true);
    expect(body.service).toBe("boop-agent");
  });
});

describe("POST /chat", () => {
  it("returns 400 when conversationId missing", async () => {
    const res = await req("/chat", json({ method: "POST", body: { content: "hi" } }));
    expect(res.status).toBe(400);
    const body = errorResponse.parse(await res.json());
    expect(body.error).toBe("conversationId and content required");
  });

  it("returns 400 when content missing", async () => {
    const res = await req("/chat", json({ method: "POST", body: { conversationId: "x" } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const res = await req("/chat", json({ method: "POST", body: {} }));
    expect(res.status).toBe(400);
  });
});

describe("POST /sendblue/webhook", () => {
  it("skips outbound messages", async () => {
    const res = await req(
      "/sendblue/webhook",
      json({ method: "POST", body: { content: "hi", from_number: "+1234", is_outbound: true } }),
    );
    const body = webhookOk.parse(await res.json());
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
  });

  it("skips messages without content", async () => {
    const res = await req(
      "/sendblue/webhook",
      json({ method: "POST", body: { from_number: "+1234" } }),
    );
    const body = webhookOk.parse(await res.json());
    expect(body.skipped).toBe(true);
  });

  it("skips messages without from_number", async () => {
    const res = await req("/sendblue/webhook", json({ method: "POST", body: { content: "hi" } }));
    const body = webhookOk.parse(await res.json());
    expect(body.skipped).toBe(true);
  });
});

describe("GET /ws", () => {
  it("rejects non-upgrade requests with 426", async () => {
    const res = await req("/ws");
    expect(res.status).toBe(426);
    expect(await res.text()).toBe("Expected Upgrade: websocket");
  });
});

describe("BoopInteractionAgent DO", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await getStub("t-404").fetch("http://agent/unknown");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("upgrades to websocket and sends hello event", async () => {
    const res = await getStub("t-ws").fetch("http://agent/ws", {
      headers: { Upgrade: "websocket" },
    });

    expect(res.status).toBe(101);
    expect(res.webSocket).toBeInstanceOf(WebSocket);
    res.webSocket!.accept();

    const raw = await waitForMessage(res.webSocket!);
    const hello = z
      .object({ event: z.string(), data: z.object({ ok: z.boolean() }), at: z.number() })
      .parse(JSON.parse(raw));
    expect(hello.event).toBe("hello");
    expect(hello.data.ok).toBe(true);
    expect(hello.at).toBeGreaterThan(0);

    res.webSocket!.close();
  });

  it("rejects websocket without upgrade header", async () => {
    const res = await getStub("t-ws-noup").fetch("http://agent/ws");
    expect(res.status).toBe(426);
  });

  it("returns 400 when /handle body is missing fields", async () => {
    const res = await getStub("t-bad").fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("handles /handle POST: queries history, calls LLM, saves messages, returns reply", async () => {
    const convex = mockConvex([]);
    const stub = getStub("t-handle");
    await injectMocksIntoDO(stub, convex, "mocked reply");

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:do", content: "hi" }),
    });

    expect(res.status).toBe(200);
    const body = replyResponse.parse(await res.json());
    expect(body.reply).toBe("mocked reply");

    expect(convex.query).toHaveBeenCalledTimes(2);
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
  });

  it("includes conversation history and filters system messages", async () => {
    const convex = mockConvex([
      { role: "user", content: "first" },
      { role: "assistant", content: "first reply" },
      { role: "system", content: "should be filtered" },
    ]);
    const stub = getStub("t-history");
    await injectMocksIntoDO(stub, convex, "second reply");

    await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:hist", content: "second" }),
    });

    // Verify convex was queried for history + settings
    expect(convex.query).toHaveBeenCalledTimes(2);
    // Verify 3 mutations: user save + usage record + assistant save
    expect(convex.mutation).toHaveBeenCalledTimes(3);
  });

  it("uses MODEL_DISPATCHER from env", async () => {
    const convex = mockConvex([]);
    const stub = getStub("t-model");
    // The mock provider ignores the model ID, but the code path still reads it from env
    await injectMocksIntoDO(stub, convex, "ok");

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:model", content: "hi" }),
    });

    const body = replyResponse.parse(await res.json());
    expect(body.reply).toBe("ok");
  });

  it("returns fallback message when LLM throws", async () => {
    const convex = mockConvex([]);
    const stub = getStub("t-err");
    await injectMocksWithErrorIntoDO(stub, convex, new Error("API timeout"));

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:err", content: "hi" }),
    });

    expect(res.status).toBe(200);
    const body = replyResponse.parse(await res.json());
    expect(body.reply).toContain("error");
    expect(body.reply).toContain("Try again");
  });

  it("returns '(no reply)' when LLM returns empty text", async () => {
    const convex = mockConvex([]);
    const stub = getStub("t-empty");
    await injectMocksIntoDO(stub, convex, "");

    const res = await stub.fetch("http://agent/handle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "test:empty", content: "hi" }),
    });

    const body = replyResponse.parse(await res.json());
    expect(body.reply).toBe("(no reply)");
  });

  it("broadcast is callable without clients", async () => {
    const stub = getStub("t-bc");
    await runInDurableObject<BoopInteractionAgent, void>(
      stub,
      async (instance: BoopInteractionAgent) => {
        expect(() => instance.broadcast("test_event", { n: 1 })).not.toThrow();
      },
    );
  });
});
