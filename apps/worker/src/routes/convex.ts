import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { z } from "zod";
import { sendImessage } from "@/lib/sendblue";

const otpBody = z.object({
  phone: z.string().min(1),
  code: z.string().min(1),
});

const convex = new Hono<{ Bindings: Env }>()

  .use("*", async (c, next) => {
    const middleware = bearerAuth({ token: c.env.CONVEX_WEBHOOK_SECRET });
    return middleware(c, next);
  })

  .post("/sendblue/otp", zValidator("json", otpBody), async (c) => {
    const { phone, code } = c.req.valid("json");
    await sendImessage(c.env, phone, `Your Boop dashboard code: ${code}`);
    return c.json({ ok: true });
  });

export { convex };
