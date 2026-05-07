import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { dispatchToAgent } from "@/lib/agent-dispatch";
import { MESSAGE_KINDS } from "@/proactive/types";

const chatBody = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
  kind: z.enum(MESSAGE_KINDS).default("user"),
});

const chat = new Hono<{ Bindings: Env }>().post(
  "/",
  zValidator("json", chatBody, (result, c) => {
    if (!result.success) {
      return c.json({ error: "conversationId and content required" }, 400);
    }
  }),
  async (c) => {
    const { conversationId, content, kind } = c.req.valid("json");
    const result = await dispatchToAgent(c.env.BOOP_AGENT, conversationId, content, kind);

    if (!result.ok) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ reply: result.reply });
  },
);

export { chat };
