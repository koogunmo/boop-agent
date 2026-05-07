import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-dispatch", () => ({
  dispatchToAgent: vi.fn().mockResolvedValue({ ok: true, reply: "mocked reply" }),
}));

import app from "@/index";
import { dispatchToAgent } from "@/lib/agent-dispatch";

const mockDispatch = vi.mocked(dispatchToAgent);

describe("POST /api/chat", () => {
  it("returns 400 for missing fields", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("defaults kind to 'user' when not provided", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: "test:chat", content: "hi" }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe("mocked reply");
    expect(mockDispatch).toHaveBeenCalledWith(expect.anything(), "test:chat", "hi", "user");
  });

  it("passes kind: 'proactive' through to dispatch", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "test:proactive",
          content: "[proactive notice] test",
          kind: "proactive",
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.anything(),
      "test:proactive",
      "[proactive notice] test",
      "proactive",
    );
  });
});
