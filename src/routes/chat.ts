import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { dispatchToAgent } from "../lib/agent-dispatch";

const chatBody = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
});

const chat = new Hono<{ Bindings: Env }>();

chat.post(
  "/",
  zValidator("json", chatBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "conversationId and content required" }, 400);
    }
  }),
  async (c) => {
    const { conversationId, content } = c.req.valid("json");
    const result = await dispatchToAgent(c.env.BOOP_AGENT, conversationId, content);

    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ reply: result.reply });
  },
);

export { chat };
