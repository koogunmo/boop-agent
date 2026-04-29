import { ConvexHttpClient } from "convex/browser";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { api } from "../convex/_generated/api";
import { chat } from "./routes/chat";
import { sendblue } from "./routes/sendblue";

export { BoopExecutionAgent } from "./agents/execution";
export { BoopInteractionAgent } from "./agents/interaction";

const agentIdSchema = z.object({ id: z.string().min(1) });

const app = new Hono<{ Bindings: Env }>()

  .use("*", cors())

  .get("/health", (c) => {
    return c.json({ ok: true, service: "boop-agent" });
  })

  .get("/ws", async (c) => {
    if (c.req.header("upgrade") !== "websocket") {
      return c.text("Expected Upgrade: websocket", 426);
    }
    const id = c.env.BOOP_AGENT.idFromName("default");
    const stub = c.env.BOOP_AGENT.get(id);
    return stub.fetch(c.req.raw);
  })

  .post("/agents/:id/cancel", async (c) => {
    const parsed = agentIdSchema.safeParse({ id: c.req.param("id") });
    if (!parsed.success) {
      return c.json({ error: "invalid agent id" }, 400);
    }
    const agentId = parsed.data.id;
    const convex = new ConvexHttpClient(c.env.CONVEX_URL);
    const agent = await convex.query(api.agents.get, { agentId });
    if (!agent) {
      return c.json({ error: "agent not found" }, 404);
    }
    if (agent.status !== "running") {
      return c.json({ ok: false, reason: `agent status is ${agent.status}` });
    }
    const execId = c.env.EXEC_AGENT.idFromName(agentId);
    const execStub = c.env.EXEC_AGENT.get(execId);
    try {
      await execStub.fetch("http://agent/cancel", { method: "POST" });
    } catch {
      // DO may already be gone
    }
    await convex.mutation(api.agents.update, { agentId, status: "cancelled" });
    return c.json({ ok: true });
  })

  .post("/agents/:id/retry", async (c) => {
    const parsed = agentIdSchema.safeParse({ id: c.req.param("id") });
    if (!parsed.success) {
      return c.json({ error: "invalid agent id" }, 400);
    }
    const agentId = parsed.data.id;
    const convex = new ConvexHttpClient(c.env.CONVEX_URL);
    const agent = await convex.query(api.agents.get, { agentId });
    if (!agent) {
      return c.json({ error: "agent not found" }, 404);
    }

    const stub = c.env.EXEC_AGENT.get(c.env.EXEC_AGENT.idFromName(agentId));
    const res = await stub.fetch("http://agent/run", {
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

  .route("/sendblue", sendblue)
  .route("/chat", chat);

export default app;
