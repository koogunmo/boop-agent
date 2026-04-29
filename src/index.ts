import { ConvexHttpClient } from "convex/browser";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { getServerByName } from "partyserver";
import { chat } from "@/routes/chat";
import { composio } from "@/routes/composio";
import { convex } from "@/routes/convex";
import { sendblue } from "@/routes/sendblue";
import { api } from "../convex/_generated/api";

export { BoopExecutionAgent } from "@/agents/execution";
export { BoopInteractionAgent } from "@/agents/interaction";

type AgentRecord = NonNullable<Awaited<ReturnType<ConvexHttpClient["query"]>>>;

const withAgent = createMiddleware<{
  Bindings: Env;
  Variables: { convex: ConvexHttpClient; agent: AgentRecord; agentId: string };
}>(async (c, next) => {
  const agentId = c.req.param("id");
  if (!agentId) return c.json({ error: "invalid agent id" }, 400);
  const cx = new ConvexHttpClient(c.env.CONVEX_URL);
  const agent = await cx.query(api.agents.get, { agentId });
  if (!agent) return c.json({ error: "agent not found" }, 404);
  c.set("convex", cx);
  c.set("agent", agent);
  c.set("agentId", agentId);
  return next();
});

const app = new Hono<{ Bindings: Env }>()

  .use("/api/*", cors())

  .get("/api/health", (c) => {
    return c.json({ ok: true, service: "boop-agent" });
  })

  .post("/api/agents/:id/cancel", withAgent, async (c) => {
    const agent = c.get("agent");
    const agentId = c.get("agentId");
    if (agent.status !== "running") {
      return c.json({ ok: false, reason: `agent status is ${agent.status}` });
    }
    const execStub = await getServerByName(c.env.EXEC_AGENT, agentId);
    try {
      await execStub.fetch("http://agent/cancel", { method: "POST" });
    } catch {
      // DO may already be gone
    }
    await c.get("convex").mutation(api.agents.update, { agentId, status: "cancelled" });
    return c.json({ ok: true });
  })

  .post("/api/agents/:id/retry", withAgent, async (c) => {
    const agent = c.get("agent");
    const agentId = c.get("agentId");
    const execStub = await getServerByName(c.env.EXEC_AGENT, agentId);
    const res = await execStub.fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: agent.task,
        integrations: agent.mcpServers,
        conversationId: agent.conversationId,
        name: agent.name,
        agentId,
      }),
    });

    const result = await res.json();
    return c.json(result);
  })

  .post("/api/consolidate", async (c) => {
    const stub = await getServerByName(c.env.BOOP_AGENT, "default");
    const res = await stub.fetch("http://agent/consolidate", { method: "POST" });
    const result = await res.json();
    return c.json(result);
  })

  .post("/api/trigger/:method", async (c) => {
    const method = c.req.param("method");
    const stub = await getServerByName(c.env.BOOP_AGENT, "default");
    const body = await c.req.text();
    const res = await stub.fetch(`http://agent/trigger/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body || "{}",
    });
    const result = await res.json();
    return c.json(result);
  })

  .all("/api/agents/boop-interaction-agent/:name{.+}", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    const stub = await getServerByName(c.env.BOOP_AGENT, name);
    return stub.fetch(c.req.raw);
  })

  .route("/api/sendblue", sendblue)
  .route("/api/chat", chat)
  .route("/api/composio", composio)
  .route("/api/convex", convex);

export type AppType = typeof app;

export default app;
