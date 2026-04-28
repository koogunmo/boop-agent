// Secrets not in wrangler.toml — set via `wrangler secret put` or .dev.vars
declare namespace Cloudflare {
  interface Env {
    CF_ACCOUNT_ID: string;
    CF_GATEWAY_ID: string;
    CF_API_TOKEN: string;
    SENDBLUE_API_KEY: string;
    SENDBLUE_API_SECRET: string;
    COMPOSIO_API_KEY: string;
    CONVEX_URL: string;
  }
}
