import { hc } from "hono/client";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import type { AppType } from "@boop/worker";

export const sendOTP = internalAction({
  args: {
    phone: v.string(),
    code: v.string(),
  },
  handler: async (_ctx, { phone, code }) => {
    const siteUrl = process.env.SITE_URL;
    const secret = process.env.CONVEX_WEBHOOK_SECRET;
    if (!siteUrl) throw new Error("SITE_URL required");
    if (!secret) throw new Error("CONVEX_WEBHOOK_SECRET required");

    const client = hc<AppType>(siteUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });

    const res = await client.api.convex.sendblue.otp.$post({
      json: { phone, code },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OTP send failed: ${res.status} ${text}`);
    }
  },
});
