import { Hono } from "hono";
import { cors } from "hono/cors";

export { BoopInteractionAgent } from "./agents/interaction";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/health", (c) => {
  return c.json({ ok: true, service: "boop-agent" });
});

export default app;
