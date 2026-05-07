import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { IComposioClient } from "@/lib/composio";
import { ComposioNeedsAuthConfigError, createComposioClient, FEATURED_SLUGS } from "@/lib/composio";

type ComposioEnv = { Bindings: Env; Variables: { composio: IComposioClient } };

const requireComposio = createMiddleware<ComposioEnv>(async (c, next) => {
  const client = createComposioClient(c.env);
  if (!client) return c.json({ error: "COMPOSIO_API_KEY not set" }, 500);
  c.set("composio", client);
  return next();
});

const status = new Hono<{ Bindings: Env }>().get("/status", (c) => {
  const client = createComposioClient(c.env);
  return c.json({ enabled: client !== null });
});

const authed = new Hono<ComposioEnv>()
  .use(requireComposio)

  .get("/toolkits", async (c) => {
    const client = c.get("composio");
    const [connected, configured, meta] = await Promise.all([
      client.listConnectedToolkits(),
      client.listToolkitSlugsWithAuthConfig(),
      client.listToolkitMeta(),
    ]);

    const connectionsBySlug = new Map<string, typeof connected>();
    for (const conn of connected) {
      const arr = connectionsBySlug.get(conn.slug) ?? [];
      arr.push(conn);
      connectionsBySlug.set(conn.slug, arr);
    }
    for (const arr of connectionsBySlug.values()) {
      arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    }

    const toConnectionView = (conn: (typeof connected)[number]) => ({
      id: conn.connectionId,
      connectionId: conn.connectionId,
      status: conn.status,
      alias: conn.alias ?? null,
      accountLabel: conn.accountLabel ?? null,
      accountEmail: conn.accountEmail ?? null,
      accountName: conn.accountName ?? null,
      accountAvatarUrl: conn.accountAvatarUrl ?? null,
      createdAt: conn.createdAt ?? null,
    });

    const allSlugs = new Set([...meta.keys(), ...connectionsBySlug.keys()]);

    const toolkits = [...allSlugs].map((slug) => {
      const m = meta.get(slug);
      const conns = connectionsBySlug.get(slug) ?? [];
      const isManagedAuth = !configured.has(slug) || conns.length > 0;
      return {
        slug,
        displayName: m?.name ?? slug,
        featured: FEATURED_SLUGS.has(slug),
        authMode: isManagedAuth ? ("managed" as const) : ("byo" as const),
        hasAuthConfig: configured.has(slug),
        logoUrl: m?.logo ?? null,
        description: m?.description ?? null,
        toolCount: m?.toolsCount ?? null,
        connections: conns.map(toConnectionView),
      };
    });

    toolkits.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return c.json({ enabled: true as const, toolkits });
  })

  .get("/toolkits/:slug/tools", async (c) => {
    const tools = await c.get("composio").listToolsForToolkit(c.req.param("slug"));
    return c.json({ tools });
  })

  .post("/toolkits/:slug/authorize", async (c) => {
    const slug = c.req.param("slug");
    let alias: string | undefined;
    try {
      const body = await c.req.json<{ alias?: string }>();
      alias = typeof body.alias === "string" ? body.alias : undefined;
    } catch {
      // no body — alias is optional
    }

    try {
      const result = await c.get("composio").authorizeToolkit(slug, alias ? { alias } : undefined);
      return c.json(result);
    } catch (err) {
      if (err instanceof ComposioNeedsAuthConfigError) {
        return c.json(
          {
            error: err.message,
            needsAuthConfig: true,
            toolkit: slug,
            setupUrl: "https://dashboard.composio.dev",
          },
          409,
        );
      }
      throw err;
    }
  })

  .post("/toolkits/:slug/disconnect", async (c) => {
    const body = await c.req.json<{ connectionId?: string }>();
    if (!body.connectionId) return c.json({ error: "connectionId required" }, 400);
    await c.get("composio").disconnectToolkit(body.connectionId);
    return c.json({ ok: true });
  })

  .post("/connections/:id/rename", async (c) => {
    const body = await c.req.json<{ alias?: string }>();
    const alias = typeof body.alias === "string" ? body.alias.trim() : "";
    if (!alias) return c.json({ error: "alias required" }, 400);
    await c.get("composio").renameConnection(c.req.param("id"), alias);
    return c.json({ ok: true });
  })

  .post("/refresh", async (c) => {
    const connected = await c.get("composio").listConnectedToolkits();
    const active = connected.filter((conn) => conn.status === "ACTIVE");
    const slugs = [...new Set(active.map((conn) => conn.slug))];
    return c.json({ toolkits: slugs });
  })

  .get("/triggers/types", async (c) => {
    const client = c.get("composio");
    const connected = await client.listConnectedToolkits();
    const activeSlugs = [
      ...new Set(connected.filter((conn) => conn.status === "ACTIVE").map((conn) => conn.slug)),
    ];
    if (activeSlugs.length === 0) return c.json({ triggers: [] });
    const triggers = await client.listTriggerTypes(activeSlugs);
    return c.json({ triggers });
  })

  .post("/triggers/:triggerId/enable", async (c) => {
    await c.get("composio").enableTrigger(c.req.param("triggerId"));
    return c.body(null, 204);
  })

  .post("/triggers/:triggerId/disable", async (c) => {
    await c.get("composio").disableTrigger(c.req.param("triggerId"));
    return c.body(null, 204);
  })

  .post("/triggers/create", async (c) => {
    const body = await c.req.json<{ triggerSlug: string; connectedAccountId: string }>();
    const triggerId = await c
      .get("composio")
      .createTrigger(body.triggerSlug, body.connectedAccountId);
    return c.json({ triggerId });
  });

const composio = new Hono<{ Bindings: Env }>().route("/", status).route("/", authed);

export { composio };
