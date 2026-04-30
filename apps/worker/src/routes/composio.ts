import { Hono } from "hono";
import { ComposioNeedsAuthConfigError, createComposioClient, FEATURED_SLUGS } from "@/lib/composio";

const composio = new Hono<{ Bindings: Env }>()

  .get("/status", (c) => {
    const client = createComposioClient(c.env);
    return c.json({ enabled: client !== null });
  })

  .get("/toolkits", async (c) => {
    const client = createComposioClient(c.env);
    if (!client) return c.json({ enabled: false as const, toolkits: [] as const });

    try {
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
    } catch (err) {
      console.error("[composio-routes] list failed", err);
      return c.json({ error: String(err) }, 500);
    }
  })

  .get("/toolkits/:slug/tools", async (c) => {
    const client = createComposioClient(c.env);
    if (!client) return c.json({ tools: [] as const });

    try {
      const tools = await client.listToolsForToolkit(c.req.param("slug"));
      return c.json({ tools });
    } catch (err) {
      console.error(`[composio-routes] list tools for ${c.req.param("slug")} failed`, err);
      return c.json({ error: String(err) }, 500);
    }
  })

  .post("/toolkits/:slug/authorize", async (c) => {
    const client = createComposioClient(c.env);
    if (!client) return c.json({ error: "COMPOSIO_API_KEY not set" }, 500);

    const slug = c.req.param("slug");
    let alias: string | undefined;
    try {
      const body = await c.req.json<{ alias?: string }>();
      alias = typeof body.alias === "string" ? body.alias : undefined;
    } catch {
      // no body or invalid JSON — fine, alias is optional
    }

    try {
      const result = await client.authorizeToolkit(slug, alias ? { alias } : undefined);
      return c.json(result);
    } catch (err) {
      if (err instanceof ComposioNeedsAuthConfigError) {
        console.warn(`[composio-routes] ${slug} needs an auth config`);
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
      console.error(`[composio-routes] authorize ${slug} failed`, err);
      return c.json({ error: String(err) }, 500);
    }
  })

  .post("/toolkits/:slug/disconnect", async (c) => {
    const client = createComposioClient(c.env);
    if (!client) return c.json({ error: "COMPOSIO_API_KEY not set" }, 500);

    let connectionId: string | undefined;
    try {
      const body = await c.req.json<{ connectionId?: string }>();
      connectionId = typeof body.connectionId === "string" ? body.connectionId : undefined;
    } catch {
      // invalid body
    }
    if (!connectionId) {
      return c.json({ error: "connectionId required in body" }, 400);
    }

    try {
      await client.disconnectToolkit(connectionId);
      return c.json({ ok: true });
    } catch (err) {
      console.error(`[composio-routes] disconnect ${c.req.param("slug")} failed`, err);
      return c.json({ error: String(err) }, 500);
    }
  })

  .post("/connections/:id/rename", async (c) => {
    const client = createComposioClient(c.env);
    if (!client) return c.json({ error: "COMPOSIO_API_KEY not set" }, 500);

    let alias: string | undefined;
    try {
      const body = await c.req.json<{ alias?: string }>();
      alias = typeof body.alias === "string" ? body.alias.trim() : undefined;
    } catch {
      // invalid body
    }
    if (!alias) {
      return c.json({ error: "alias required in body" }, 400);
    }

    try {
      await client.renameConnection(c.req.param("id"), alias);
      return c.json({ ok: true });
    } catch (err) {
      console.error(`[composio-routes] rename ${c.req.param("id")} failed`, err);
      return c.json({ error: String(err) }, 500);
    }
  })

  .post("/refresh", async (c) => {
    const client = createComposioClient(c.env);
    if (!client) return c.json({ error: "COMPOSIO_API_KEY not set" }, 500);

    try {
      const connected = await client.listConnectedToolkits();
      const active = connected.filter((conn) => conn.status === "ACTIVE");
      const slugs = [...new Set(active.map((conn) => conn.slug))];
      return c.json({ ok: true, toolkits: slugs });
    } catch (err) {
      console.error("[composio-routes] refresh failed", err);
      return c.json({ error: String(err) }, 500);
    }
  });

export { composio };
