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

describe("GET /composio/status", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns enabled:false when no client", async () => {
    disableComposio();
    const res = await req("/composio/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });
});

describe("GET /composio/toolkits", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns empty toolkits when no client", async () => {
    disableComposio();
    const res = await req("/composio/toolkits");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; toolkits: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.toolkits).toEqual([]);
  });
});

describe("GET /composio/toolkits/:slug/tools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns empty tools when no client", async () => {
    disableComposio();
    const res = await req("/composio/toolkits/gmail/tools");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: unknown[] };
    expect(body.tools).toEqual([]);
  });
});

describe("POST /composio/toolkits/:slug/authorize", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 500 when no client", async () => {
    disableComposio();
    const res = await req("/composio/toolkits/gmail/authorize", { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("COMPOSIO_API_KEY not set");
  });
});

describe("POST /composio/toolkits/:slug/disconnect", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 500 when no client", async () => {
    disableComposio();
    const res = await req("/composio/toolkits/gmail/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: "ca_123" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("COMPOSIO_API_KEY not set");
  });

  it("returns 400 when connectionId missing", async () => {
    disableComposio();
    vi.spyOn(composioModule, "createComposioClient").mockReturnValue({
      disconnectToolkit: vi.fn(),
    } as unknown as composioModule.IComposioClient);
    const res = await req("/composio/toolkits/gmail/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("connectionId required in body");
  });
});

describe("POST /composio/refresh", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 500 when no client", async () => {
    disableComposio();
    const res = await req("/composio/refresh", { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("COMPOSIO_API_KEY not set");
  });
});
