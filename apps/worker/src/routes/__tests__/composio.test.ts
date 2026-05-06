import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "@/index";
import * as composioModule from "@/lib/composio";

async function req(path: string, init?: RequestInit): Promise<Response> {
  return app.request(path, init, env);
}

function disableComposio() {
  vi.spyOn(composioModule, "createComposioClient").mockReturnValue(null);
}

function mockComposioClient(overrides: Partial<composioModule.IComposioClient> = {}) {
  vi.spyOn(composioModule, "createComposioClient").mockReturnValue({
    raw: {} as composioModule.IComposioClient["raw"],
    user: "test",
    listConnectedToolkits: vi.fn().mockResolvedValue([]),
    listToolkitMeta: vi.fn().mockResolvedValue(new Map()),
    listToolsForToolkit: vi.fn().mockResolvedValue([]),
    listToolkitSlugsWithAuthConfig: vi.fn().mockResolvedValue(new Set()),
    authorizeToolkit: vi.fn(),
    disconnectToolkit: vi.fn(),
    renameConnection: vi.fn(),
    createTrigger: vi.fn().mockResolvedValue("trigger_id"),
    enableTrigger: vi.fn(),
    disableTrigger: vi.fn(),
    listTriggerTypes: vi.fn().mockResolvedValue([]),
    ...overrides,
  } satisfies composioModule.IComposioClient);
}

describe("GET /api/composio/status", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns enabled:false when no client", async () => {
    disableComposio();
    const res = await req("/api/composio/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });
});

describe("middleware blocks routes when no client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("GET /toolkits returns 500", async () => {
    disableComposio();
    const res = await req("/api/composio/toolkits");
    expect(res.status).toBe(500);
  });

  it("POST /toolkits/:slug/authorize returns 500", async () => {
    disableComposio();
    const res = await req("/api/composio/toolkits/gmail/authorize", { method: "POST" });
    expect(res.status).toBe(500);
  });

  it("POST /refresh returns 500", async () => {
    disableComposio();
    const res = await req("/api/composio/refresh", { method: "POST" });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/composio/toolkits/:slug/disconnect", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when connectionId missing", async () => {
    mockComposioClient();
    const res = await req("/api/composio/toolkits/gmail/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/composio/connections/:id/rename", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 400 when alias missing", async () => {
    mockComposioClient();
    const res = await req("/api/composio/connections/ca_123/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/composio/triggers/types", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns trigger types for connected toolkits", async () => {
    mockComposioClient({
      listConnectedToolkits: vi
        .fn()
        .mockResolvedValue([{ slug: "gmail", connectionId: "conn_1", status: "ACTIVE" }]),
      listTriggerTypes: vi
        .fn()
        .mockResolvedValue([
          { slug: "GMAIL_NEW_GMAIL_MESSAGE", name: "New Email", appSlug: "gmail" },
        ]),
    });
    const res = await req("/api/composio/triggers/types");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triggers: Array<{ slug: string }> };
    expect(body.triggers).toHaveLength(1);
    expect(body.triggers[0]!.slug).toBe("GMAIL_NEW_GMAIL_MESSAGE");
  });

  it("returns empty when no active connections", async () => {
    mockComposioClient({
      listConnectedToolkits: vi.fn().mockResolvedValue([]),
    });
    const res = await req("/api/composio/triggers/types");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triggers: unknown[] };
    expect(body.triggers).toEqual([]);
  });
});

describe("POST /api/composio/triggers/create", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates trigger and returns triggerId", async () => {
    const createFn = vi.fn().mockResolvedValue("trigger_abc");
    mockComposioClient({ createTrigger: createFn });
    const res = await req("/api/composio/triggers/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE",
        connectedAccountId: "conn_1",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triggerId: string };
    expect(body.triggerId).toBe("trigger_abc");
    expect(createFn).toHaveBeenCalledWith("GMAIL_NEW_GMAIL_MESSAGE", "conn_1");
  });
});

describe("POST /api/composio/triggers/:id/enable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("enables trigger and returns 204", async () => {
    const enableFn = vi.fn();
    mockComposioClient({ enableTrigger: enableFn });
    const res = await req("/api/composio/triggers/trigger_abc/enable", { method: "POST" });
    expect(res.status).toBe(204);
    expect(enableFn).toHaveBeenCalledWith("trigger_abc");
  });
});

describe("POST /api/composio/triggers/:id/disable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("disables trigger and returns 204", async () => {
    const disableFn = vi.fn();
    mockComposioClient({ disableTrigger: disableFn });
    const res = await req("/api/composio/triggers/trigger_abc/disable", { method: "POST" });
    expect(res.status).toBe(204);
    expect(disableFn).toHaveBeenCalledWith("trigger_abc");
  });
});
