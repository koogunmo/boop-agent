import { SerperClient } from "@agentic/serper";
import { tool } from "ai";
import { NodeHtmlMarkdown } from "node-html-markdown-cloudflare";
import { z } from "zod";

function getSerper(env: Env): SerperClient {
  return new SerperClient({ apiKey: env.SERPER_API_KEY });
}

async function fetchWithBrowserRendering(url: string, env: Env): Promise<string> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_BROWSER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2" } }),
    },
  );

  if (!response.ok) {
    throw new Error(`Browser Rendering failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    result?: string;
    errors?: Array<{ message: string }>;
  };

  if (!data.success || !data.result) {
    throw new Error(data.errors?.[0]?.message ?? "Browser Rendering returned no content");
  }

  return data.result;
}

async function fetchWithHtmlParser(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BoopAgent/1.0)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return NodeHtmlMarkdown.translate(html);
}

export function createWebTools(env: Env) {
  return {
    web_search: tool({
      description:
        "Search the web via Google. Supports different search types and pagination. Returns the full search response as structured data.",
      inputSchema: z.object({
        q: z.string().describe("The search query."),
        type: z
          .enum(["search", "images", "videos", "news", "places", "shopping"])
          .optional()
          .default("search")
          .describe("Type of search."),
        page: z.number().int().min(1).optional().describe("Page number for pagination (1-based)."),
        num: z.number().int().min(1).max(100).optional().describe("Number of results per page."),
      }),
      execute: async (params) => {
        try {
          return await getSerper(env).search(params);
        } catch (err) {
          return `Search failed: ${String(err)}`;
        }
      },
    }),

    web_fetch: tool({
      description:
        "Fetch a URL and return its content as clean markdown text. Use when you need the content of a specific known URL. Set render=true for JS-heavy pages that need a real browser.",
      inputSchema: z.object({
        url: z.string().url().describe("The URL to fetch."),
        render: z
          .boolean()
          .optional()
          .default(false)
          .describe("Use headless browser rendering for JS-heavy pages. Slower but handles SPAs."),
      }),
      execute: async ({ url, render }) => {
        try {
          if (render && env.CF_BROWSER_TOKEN) {
            return await fetchWithBrowserRendering(url, env);
          }
          return await fetchWithHtmlParser(url);
        } catch (err) {
          return `Failed to fetch ${url}: ${String(err)}`;
        }
      },
    }),
  };
}
