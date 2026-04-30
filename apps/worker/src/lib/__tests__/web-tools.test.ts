import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { testEnv } from "@/lib/test-helpers";
import { createWebTools } from "@/lib/web-tools";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

describe("web_search", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns Serper response with organic results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          organic: [{ title: "Example", link: "https://example.com", snippet: "A snippet" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const tools = createWebTools(testEnv());
    const result = await tools.web_search.execute!({ q: "test", type: "search" }, toolOpts);
    expect(result).toHaveProperty("organic");
  });

  it("accepts pagination params without error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ organic: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const tools = createWebTools(testEnv());
    const result = await tools.web_search.execute!(
      { q: "paginated", type: "search", page: 2, num: 20 },
      toolOpts,
    );
    expect(result).toHaveProperty("organic");
  });

  it("returns error string on failure without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network timeout"));

    const tools = createWebTools(testEnv());
    const result = await tools.web_search.execute!({ q: "fail", type: "search" }, toolOpts);
    expect(typeof result).toBe("string");
    expect(result).toContain("Search failed:");
  });
});

describe("web_fetch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches URL and converts HTML to markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body><h1>Title</h1><p>Content here.</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const tools = createWebTools(testEnv());
    const result = await tools.web_fetch.execute!(
      { url: "https://example.com", render: false },
      toolOpts,
    );
    const text = z.string().parse(result);
    expect(text).toContain("Title");
    expect(text).toContain("Content here.");
  });

  it("returns error on HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error", { status: 500, statusText: "Internal Server Error" }),
    );

    const tools = createWebTools(testEnv());
    const result = await tools.web_fetch.execute!(
      { url: "https://broken.com", render: false },
      toolOpts,
    );
    expect(z.string().parse(result)).toContain("500");
  });

  it("returns error when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("DNS failed"));

    const tools = createWebTools(testEnv());
    const result = await tools.web_fetch.execute!(
      { url: "https://bad.com", render: false },
      toolOpts,
    );
    expect(z.string().parse(result)).toContain("DNS failed");
  });
});
