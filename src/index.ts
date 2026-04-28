import { Hono } from "hono";
import { cors } from "hono/cors";
import { chat } from "./routes/chat";
import { sendblue } from "./routes/sendblue";

export { BoopInteractionAgent } from "./agents/interaction";

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

  .route("/sendblue", sendblue)
  .route("/chat", chat);

export default app;
