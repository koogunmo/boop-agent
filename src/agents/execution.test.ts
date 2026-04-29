import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

function getStub(name: string) {
  return env.EXEC_AGENT.get(env.EXEC_AGENT.idFromName(name));
}

describe("BoopExecutionAgent DO", () => {
  it("returns 404 for unknown paths", { timeout: 15000 }, async () => {
    const res = await getStub("t-exec-404").fetch("http://agent/unknown");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("returns 404 for GET requests to /run", async () => {
    const res = await getStub("t-exec-get").fetch("http://agent/run");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid /run body — empty object", async () => {
    const res = await getStub("t-exec-bad1").fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("bad request");
  });

  it("returns 400 for /run body missing required fields", async () => {
    const res = await getStub("t-exec-bad2").fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "do something" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when task is empty string", async () => {
    const res = await getStub("t-exec-bad3").fetch("http://agent/run", {
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
    const res = await getStub("t-exec-bad4").fetch("http://agent/run", {
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
    const res = await getStub("t-exec-bad5").fetch("http://agent/run", {
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

  it("cancel endpoint returns cancelled:false when no task running", async () => {
    const res = await getStub("t-exec-cancel").fetch("http://agent/cancel", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelled: boolean };
    expect(body.cancelled).toBe(false);
  });
});
