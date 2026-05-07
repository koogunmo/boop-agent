import { env } from "cloudflare:workers";
import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = vi.fn().mockResolvedValue([]);
    mutation = vi.fn().mockResolvedValue(null);
    action = vi.fn().mockResolvedValue([]);
  },
}));

import app from "@/index";
import * as sendblueModule from "@/lib/sendblue";

const client = testClient(app, env);
const SECRET = env.CONVEX_WEBHOOK_SECRET;

describe("POST /api/convex/sendblue/otp", () => {
  it("returns 401 without authorization header", async () => {
    const res = await client.api.convex.sendblue.otp.$post({
      json: { phone: "+15555550199", code: "123456" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const res = await client.api.convex.sendblue.otp.$post(
      { json: { phone: "+15555550199", code: "123456" } },
      { headers: { Authorization: "Bearer wrong-secret" } },
    );
    expect(res.status).toBe(401);
  });

  it("sends OTP via sendImessage and returns ok", async () => {
    const sendSpy = vi.spyOn(sendblueModule, "sendImessage").mockResolvedValue();

    const res = await client.api.convex.sendblue.otp.$post(
      { json: { phone: "+15555550199", code: "654321" } },
      { headers: { Authorization: `Bearer ${SECRET}` } },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy.mock.calls[0]![1]).toBe("+15555550199");
    expect(sendSpy.mock.calls[0]![2]).toContain("654321");

    sendSpy.mockRestore();
  });
});
