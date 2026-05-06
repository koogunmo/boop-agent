import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/composio", () => ({
  createComposioClient: vi.fn().mockReturnValue({
    enableTrigger: vi.fn().mockResolvedValue(undefined),
    disableTrigger: vi.fn().mockResolvedValue(undefined),
    createTrigger: vi.fn().mockResolvedValue("trigger_abc"),
    raw: { triggers: { verifyWebhook: vi.fn() } },
  }),
  FEATURED_SLUGS: new Set(),
  ComposioNeedsAuthConfigError: class extends Error {},
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = vi.fn().mockResolvedValue(null);
    mutation = vi.fn().mockResolvedValue(null);
  },
}));

import app from "@/index";
import { createComposioClient } from "@/lib/composio";

function getClient() {
  return createComposioClient({} as Env) as ReturnType<typeof createComposioClient> & {
    enableTrigger: ReturnType<typeof vi.fn>;
    disableTrigger: ReturnType<typeof vi.fn>;
    createTrigger: ReturnType<typeof vi.fn>;
  };
}

describe("composio trigger routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("POST /api/composio/triggers/create returns triggerId", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/composio/triggers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE",
          connectedAccountId: "conn_123",
        }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { triggerId: string };
    expect(body.triggerId).toBe("trigger_abc");
    expect(getClient().createTrigger).toHaveBeenCalledWith("GMAIL_NEW_GMAIL_MESSAGE", "conn_123");
  });

  it("POST /api/composio/triggers/:id/enable returns 204", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/composio/triggers/trigger_abc/enable", { method: "POST" }),
      env,
    );

    expect(res.status).toBe(204);
    expect(getClient().enableTrigger).toHaveBeenCalledWith("trigger_abc");
  });

  it("POST /api/composio/triggers/:id/disable returns 204", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/composio/triggers/trigger_abc/disable", { method: "POST" }),
      env,
    );

    expect(res.status).toBe(204);
    expect(getClient().disableTrigger).toHaveBeenCalledWith("trigger_abc");
  });
});
