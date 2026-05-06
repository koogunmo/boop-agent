import { env } from "cloudflare:workers";
import { testClient } from "hono/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = vi.fn().mockResolvedValue(null);
    mutation = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock("@/lib/composio", () => ({
  createComposioClient: vi.fn().mockReturnValue({
    raw: {
      triggers: {
        verifyWebhook: vi.fn().mockRejectedValue(new Error("invalid signature")),
      },
    },
  }),
}));

vi.mock("@/proactive/pipeline", () => ({
  runProactivePipeline: vi.fn().mockResolvedValue({ action: "dispatched", summary: "test" }),
}));

import app from "@/index";

const client = testClient(app, env);

describe("POST /api/webhooks/composio", () => {
  it("returns 400 when webhook headers are missing", async () => {
    const res = await client.api.webhooks.composio.$post({
      header: {},
    } as never);
    expect(res.status).toBe(400);
  });

  it("returns 401 when signature verification fails", async () => {
    await fetch(
      new Request("http://localhost/api/webhooks/composio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "webhook-id": "wh_123",
          "webhook-signature": "bad_sig",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        body: JSON.stringify({ metadata: { trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE" }, data: {} }),
      }),
    );

    const handler = app.fetch;
    const response = await handler(
      new Request("http://localhost/api/webhooks/composio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "webhook-id": "wh_123",
          "webhook-signature": "bad_sig",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        body: JSON.stringify({ metadata: { trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE" }, data: {} }),
      }),
      env,
    );

    expect(response.status).toBe(401);
  });
});
