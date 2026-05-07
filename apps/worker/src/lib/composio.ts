import { Composio } from "@composio/core";

export const FEATURED_SLUGS = new Set([
  "gmail",
  "googlecalendar",
  "googledrive",
  "googlesheets",
  "googledocs",
  "slack",
  "github",
  "linear",
  "notion",
  "hubspot",
  "discord",
  "trello",
  "asana",
  "jira",
  "airtable",
  "figma",
  "dropbox",
  "stripe",
  "supabase",
  "granola_mcp",
  "salesforce",
  "twitter",
  "linkedin",
]);

function boopUserId(env: Env): string {
  if (!env.COMPOSIO_USER_ID) throw new Error("COMPOSIO_USER_ID not set");
  return env.COMPOSIO_USER_ID;
}

type ConnectionStatus = "INITIALIZING" | "INITIATED" | "ACTIVE" | "FAILED" | "EXPIRED" | "INACTIVE";

interface ConnectedToolkit {
  slug: string;
  connectionId: string;
  status: ConnectionStatus;
  alias?: string | undefined;
  accountLabel?: string | undefined;
  accountEmail?: string | undefined;
  accountName?: string | undefined;
  accountAvatarUrl?: string | undefined;
  createdAt?: string | undefined;
}

interface ToolkitMeta {
  slug: string;
  name: string;
  logo?: string | undefined;
  description?: string | undefined;
  toolsCount?: number | undefined;
}

interface ToolSummary {
  slug: string;
  name: string;
  description?: string | undefined;
}

interface AccountIdentity {
  email?: string | undefined;
  name?: string | undefined;
  avatarUrl?: string | undefined;
  label?: string | undefined;
}

interface WhoAmITool {
  tool: string;
  arguments: Record<string, unknown>;
  parse: (data: Record<string, unknown>) => AccountIdentity;
}

function genericProfileParse(d: Record<string, unknown>): AccountIdentity {
  const first = (...candidates: unknown[]): string | undefined => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return undefined;
  };
  const nested = (key: string): Record<string, unknown> =>
    d[key] && typeof d[key] === "object" ? (d[key] as Record<string, unknown>) : {};
  const viewer = nested("viewer");
  const user = nested("user");
  const team = nested("team");
  const profile = nested("profile");

  const email = first(d.email, user.email, viewer.email, profile.email);
  const name = first(
    d.name,
    d.login,
    d.display_name,
    d.displayName,
    user.name,
    viewer.name,
    profile.name,
    team.name,
    d.companyName,
  );
  const avatar = first(
    d.avatar_url,
    d.avatarUrl,
    d.picture,
    user.avatar_url,
    viewer.avatarUrl,
    profile.image,
  );
  return { email, name, avatarUrl: avatar, label: email ?? name };
}

const WHOAMI_BY_TOOLKIT: Record<string, WhoAmITool> = {
  gmail: {
    tool: "GMAIL_GET_PROFILE",
    arguments: { user_id: "me" },
    parse: (d): AccountIdentity => {
      const email = typeof d.emailAddress === "string" ? d.emailAddress : undefined;
      return { email, label: email };
    },
  },
  github: {
    tool: "GITHUB_GET_THE_AUTHENTICATED_USER",
    arguments: {},
    parse: genericProfileParse,
  },
  linear: { tool: "LINEAR_GET_CURRENT_USER", arguments: {}, parse: genericProfileParse },
  notion: { tool: "NOTION_GET_ABOUT_ME", arguments: {}, parse: genericProfileParse },
  hubspot: { tool: "HUBSPOT_GET_ACCOUNT_INFO", arguments: {}, parse: genericProfileParse },
  stripe: { tool: "STRIPE_GET_ACCOUNT", arguments: {}, parse: genericProfileParse },
  slack: { tool: "SLACK_FETCH_TEAM_INFO", arguments: {}, parse: genericProfileParse },
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split(".");
    const payload = parts[1];
    if (!payload) return null;
    const padded = payload + "===".slice((payload.length + 3) % 4);
    const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractAccountIdentity(state: unknown, data: unknown): AccountIdentity {
  const s = (state && typeof state === "object" ? (state as Record<string, unknown>) : {}) ?? {};
  const d = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) ?? {};
  const out: AccountIdentity = {};

  const idToken = str(s.id_token) ?? str(d.id_token);
  if (idToken) {
    const payload = decodeJwtPayload(idToken);
    if (payload) {
      out.email = str(payload.email);
      out.name = str(payload.name) ?? str(payload.given_name);
      out.avatarUrl = str(payload.picture);
    }
  }

  for (const src of [d, s]) {
    const profile =
      (src.user_info && typeof src.user_info === "object"
        ? (src.user_info as Record<string, unknown>)
        : null) ??
      (src.profile && typeof src.profile === "object"
        ? (src.profile as Record<string, unknown>)
        : null);
    if (profile) {
      out.email = out.email ?? str(profile.email);
      out.name = out.name ?? str(profile.name) ?? str(profile.display_name);
      out.avatarUrl = out.avatarUrl ?? str(profile.picture) ?? str(profile.avatar_url);
    }
    out.email = out.email ?? str(src.email);
    out.name = out.name ?? str(src.name) ?? str(src.display_name);
    out.avatarUrl = out.avatarUrl ?? str(src.avatar_url) ?? str(src.picture);
  }

  const fallback =
    str(s.shop) ??
    str(s.subdomain) ??
    str(s.domain) ??
    str(s.account_url) ??
    str(s.account_id) ??
    str(s.site_name) ??
    str(s.instanceName) ??
    str(d.shop) ??
    str(d.subdomain);

  out.label = out.email ?? out.name ?? fallback;
  return out;
}

export interface IComposioClient {
  readonly raw: Composio;
  readonly user: string;
  listToolkitMeta(): Promise<Map<string, ToolkitMeta>>;
  listToolsForToolkit(slug: string): Promise<ToolSummary[]>;
  listToolkitSlugsWithAuthConfig(): Promise<Set<string>>;
  listConnectedToolkits(): Promise<ConnectedToolkit[]>;
  authorizeToolkit(
    slug: string,
    opts?: { callbackUrl?: string; alias?: string },
  ): Promise<{ redirectUrl: string | null; connectionId: string }>;
  disconnectToolkit(connectionId: string): Promise<void>;
  renameConnection(connectionId: string, alias: string): Promise<void>;
  createTrigger(triggerSlug: string, connectedAccountId: string): Promise<string>;
  enableTrigger(triggerId: string): Promise<void>;
  disableTrigger(triggerId: string): Promise<void>;
  listTriggerTypes(
    appSlugs: string[],
  ): Promise<Array<{ slug: string; name: string; appSlug: string }>>;
}

class ComposioClient implements IComposioClient {
  private readonly client: Composio;
  private readonly userId: string;
  private readonly apiKey: string;

  constructor(client: Composio, userId: string, apiKey: string) {
    this.client = client;
    this.userId = userId;
    this.apiKey = apiKey;
  }

  get raw(): Composio {
    return this.client;
  }

  get user(): string {
    return this.userId;
  }

  async listToolkitMeta(): Promise<Map<string, ToolkitMeta>> {
    try {
      const out = new Map<string, ToolkitMeta>();
      const resp = await this.client.toolkits.get({ limit: 500 });
      const items = Array.isArray(resp) ? resp : ((resp as { items?: unknown[] }).items ?? []);
      for (const it of items as Array<{
        slug: string;
        name: string;
        meta?: { logo?: string; description?: string; toolsCount?: number };
      }>) {
        out.set(it.slug, {
          slug: it.slug,
          name: it.name,
          logo: it.meta?.logo,
          description: it.meta?.description,
          toolsCount: it.meta?.toolsCount,
        });
      }
      return out;
    } catch (err) {
      console.error("[composio] listToolkitMeta failed", err);
      return new Map<string, ToolkitMeta>();
    }
  }

  async listToolsForToolkit(slug: string): Promise<ToolSummary[]> {
    try {
      const list = await this.client.tools.getRawComposioTools({ toolkits: [slug], limit: 500 });
      return list.map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
      }));
    } catch (err) {
      console.error(`[composio] listToolsForToolkit(${slug}) failed`, err);
      return [];
    }
  }

  async listToolkitSlugsWithAuthConfig(): Promise<Set<string>> {
    try {
      const resp = await this.client.authConfigs.list({ limit: 200 });
      return new Set(resp.items.map((it) => it.toolkit.slug));
    } catch (err) {
      console.error("[composio] listToolkitSlugsWithAuthConfig failed", err);
      return new Set();
    }
  }

  async listConnectedToolkits(): Promise<ConnectedToolkit[]> {
    try {
      const resp = await this.client.connectedAccounts.list({ userIds: [this.userId] });
      const enriched = await Promise.all(
        resp.items.map(async (it) => {
          const seed = extractAccountIdentity(
            (it as { state?: unknown }).state,
            (it as { data?: unknown }).data,
          );
          const identity =
            it.status === "ACTIVE" ? await this.getIdentityFor(it.id, it.toolkit.slug, seed) : seed;
          return {
            slug: it.toolkit.slug,
            connectionId: it.id,
            status: it.status,
            alias: it.alias ?? undefined,
            accountLabel: identity.label,
            accountEmail: identity.email,
            accountName: identity.name,
            accountAvatarUrl: identity.avatarUrl,
            createdAt: it.createdAt,
          };
        }),
      );
      return enriched;
    } catch (err) {
      console.error("[composio] listConnectedToolkits failed", err);
      return [];
    }
  }

  private async getIdentityFor(
    id: string,
    slug: string,
    seed: AccountIdentity,
  ): Promise<AccountIdentity> {
    if (seed.label) return seed;
    let identity: AccountIdentity = {};
    try {
      const full = await this.client.connectedAccounts.get(id);
      identity = extractAccountIdentity(
        (full as { state?: unknown }).state,
        (full as { data?: unknown }).data,
      );
    } catch (err) {
      console.warn(`[composio] failed to fetch identity for ${id}`, err);
    }
    if (!identity.label) {
      const whoami = await this.fetchToolkitIdentity(slug, id);
      if (whoami.label) identity = { ...identity, ...whoami };
    }
    return identity;
  }

  private async fetchToolkitIdentity(
    slug: string,
    connectedAccountId?: string,
  ): Promise<AccountIdentity> {
    const spec = WHOAMI_BY_TOOLKIT[slug];
    if (!spec) return {};
    try {
      const result = await this.client.tools.execute(spec.tool, {
        userId: this.userId,
        ...(connectedAccountId ? { connectedAccountId } : {}),
        arguments: spec.arguments,
        dangerouslySkipVersionCheck: true,
      });
      if (!result.successful || !result.data) return {};
      return spec.parse(result.data as Record<string, unknown>);
    } catch (err) {
      console.warn(`[composio] whoami fetch failed for ${slug}`, err);
      return {};
    }
  }

  async authorizeToolkit(
    slug: string,
    opts?: { callbackUrl?: string; alias?: string },
  ): Promise<{ redirectUrl: string | null; connectionId: string }> {
    let authConfigId: string;
    const existingConfig = (await this.client.authConfigs.list({ toolkit: slug })).items[0];
    if (existingConfig) {
      authConfigId = existingConfig.id;
    } else {
      try {
        const created = await this.client.authConfigs.create(slug, {
          type: "use_composio_managed_auth",
          name: `${slug} Auth Config`,
        });
        authConfigId = created.id;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 400) {
          throw new ComposioNeedsAuthConfigError(slug, String(err));
        }
        throw err;
      }
    }

    const existing = (await this.listConnectedToolkits()).filter(
      (c) => c.slug === slug && c.status === "ACTIVE",
    );
    const conn = await this.client.connectedAccounts.initiate(this.userId, authConfigId, {
      ...(existing.length > 0 ? { allowMultiple: true } : {}),
      ...(opts?.callbackUrl ? { callbackUrl: opts.callbackUrl } : {}),
      ...(opts?.alias ? { alias: opts.alias } : {}),
    });
    return { redirectUrl: conn.redirectUrl ?? null, connectionId: conn.id };
  }

  async disconnectToolkit(connectionId: string): Promise<void> {
    await this.client.connectedAccounts.delete(connectionId);
  }

  async renameConnection(connectionId: string, alias: string): Promise<void> {
    const res = await fetch(
      `https://backend.composio.dev/api/v1/connectedAccounts/${encodeURIComponent(connectionId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({ alias }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Composio rename failed: ${res.status} ${text}`);
    }
  }

  async listTriggerTypes(
    appSlugs: string[],
  ): Promise<Array<{ slug: string; name: string; appSlug: string }>> {
    const result = await this.client.triggers.listTypes({ toolkits: appSlugs });
    const items =
      (result as { items?: Array<{ slug: string; name: string; toolkit: { slug: string } }> })
        .items ?? [];
    return items
      .filter((t) => appSlugs.includes(t.toolkit.slug))
      .map((t) => ({ slug: t.slug, name: t.name, appSlug: t.toolkit.slug }));
  }

  async createTrigger(triggerSlug: string, connectedAccountId: string): Promise<string> {
    const result = await this.client.triggers.create(this.userId, triggerSlug, {
      connectedAccountId,
      triggerConfig: {},
    });
    const id = (result as { triggerId?: string }).triggerId;
    if (!id) throw new Error(`Composio create trigger returned no triggerId for ${triggerSlug}`);
    return id;
  }

  async enableTrigger(triggerId: string): Promise<void> {
    await this.client.triggers.enable(triggerId);
  }

  async disableTrigger(triggerId: string): Promise<void> {
    await this.client.triggers.disable(triggerId);
  }
}

export class ComposioNeedsAuthConfigError extends Error {
  constructor(
    public readonly slug: string,
    public readonly underlying: string,
  ) {
    super(
      `Toolkit "${slug}" needs an auth config — Composio doesn't host a managed OAuth app for it. ` +
        `Add it via the Composio Dashboard: Toolkits → search ${slug} → Add to project → paste your OAuth credentials. ` +
        `https://dashboard.composio.dev`,
    );
    this.name = "ComposioNeedsAuthConfigError";
  }
}

export function createComposioClient(env: Env): IComposioClient | null {
  if (!env.COMPOSIO_API_KEY) return null;
  const composio = new Composio({ apiKey: env.COMPOSIO_API_KEY });
  return new ComposioClient(composio, boopUserId(env), env.COMPOSIO_API_KEY);
}
