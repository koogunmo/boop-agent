#!/usr/bin/env bun
import prompts from "prompts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const DEV_VARS_PATH = resolve(ROOT, ".dev.vars");

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}

function writeDevVars(vars: Record<string, string>): void {
  const lines = Object.entries(vars)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(DEV_VARS_PATH, lines.join("\n") + "\n");
}

function banner(s: string) {
  console.log("\n" + "━".repeat(60));
  console.log("  " + s);
  console.log("━".repeat(60));
}

function hasBinary(name: string): Promise<boolean> {
  return new Promise((ok) => {
    const child = spawn("which", [name], { stdio: "ignore" });
    child.on("exit", (code) => ok(code === 0));
    child.on("error", () => ok(false));
  });
}

function runInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT });
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d: Buffer) => process.stderr.write(d));
    child.on("exit", (code) =>
      code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore */
  }
}

async function sendblueInvoker(): Promise<{ cmd: string; leading: string[] }> {
  if (await hasBinary("sendblue")) return { cmd: "sendblue", leading: [] };
  return { cmd: "bunx", leading: ["@sendblue/cli"] };
}

function parseSendblueKeys(output: string): {
  apiKey?: string;
  apiSecret?: string;
  fromNumber?: string;
} {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const keys: { apiKey?: string; apiSecret?: string; fromNumber?: string } = {};

  try {
    const json = JSON.parse(clean);
    if (json.api_key_id || json.apiKeyId) keys.apiKey = json.api_key_id ?? json.apiKeyId;
    if (json.api_secret_key || json.apiSecretKey)
      keys.apiSecret = json.api_secret_key ?? json.apiSecretKey;
    if (json.phone_number || json.phoneNumber)
      keys.fromNumber = json.phone_number ?? json.phoneNumber;
    if (keys.apiKey && keys.apiSecret) return keys;
  } catch {
    /* not json */
  }

  const idMatch = clean.match(
    /(?:API[- ]?Key[- ]?ID|sb[- ]?api[- ]?key[- ]?id|api_key_id|Key Id|API[- ]?Key)[:\s]+"?([A-Za-z0-9_-]{16,})/i,
  );
  const secretMatch = clean.match(
    /(?:Secret[- ]?Key|API[- ]?Secret|sb[- ]?api[- ]?secret[- ]?key|api_secret|Secret)[:\s]+"?([A-Za-z0-9_-]{16,})/i,
  );
  const numMatch = clean.match(
    /(?:Phone[- ]?Number|From[- ]?Number|number)[:\s]+"?(\+?\d{10,15})/i,
  );

  if (idMatch) keys.apiKey = idMatch[1];
  if (secretMatch) keys.apiSecret = secretMatch[1];
  if (numMatch) keys.fromNumber = numMatch[1];
  return keys;
}

function parseSendbluePhones(output: string): string[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const seen = new Set<string>();
  const numbers: string[] = [];

  try {
    const json = JSON.parse(clean);
    const lines = Array.isArray(json) ? json : (json.lines ?? json.numbers ?? []);
    for (const entry of lines) {
      const n = entry?.phone_number ?? entry?.phoneNumber ?? entry?.number ?? entry;
      if (typeof n === "string" && /^\+?\d{10,15}$/.test(n.replace(/[^\d+]/g, ""))) {
        const norm = n.startsWith("+") ? n : `+${n}`;
        if (!seen.has(norm)) {
          seen.add(norm);
          numbers.push(norm);
        }
      }
    }
    if (numbers.length) return numbers;
  } catch {
    /* not JSON */
  }

  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("+")) continue;
    const match = line.match(/^\+[\d ()\-.]{9,25}/);
    if (!match) continue;
    const e164 = "+" + match[0].replace(/\D/g, "");
    if (/^\+\d{10,15}$/.test(e164) && !seen.has(e164)) {
      seen.add(e164);
      numbers.push(e164);
    }
  }
  return numbers;
}

async function importSendblueFromCli(): Promise<{
  apiKey?: string;
  apiSecret?: string;
  fromNumber?: string;
} | null> {
  const { method } = await prompts(
    {
      type: "select",
      name: "method",
      message: "How do you want to configure Sendblue?",
      choices: [
        { title: "Use the Sendblue CLI (fastest)", value: "cli" },
        { title: "Paste my API keys manually", value: "manual" },
        { title: "Skip for now", value: "skip" },
      ],
      initial: 0,
    },
    { onCancel: () => process.exit(1) },
  );

  if (method === "manual") return null;
  if (method === "skip") return { apiKey: "", apiSecret: "", fromNumber: "" };

  const { account } = await prompts({
    type: "select",
    name: "account",
    message: "Do you already have a Sendblue account?",
    choices: [
      { title: "Yes — log in", value: "login" },
      { title: "No — create one with sendblue setup", value: "setup" },
    ],
    initial: 0,
  });

  const { cmd, leading } = await sendblueInvoker();

  banner("Sendblue CLI");
  try {
    await runInherit(cmd, [...leading, account === "setup" ? "setup" : "login"]);
    console.log("\nFetching your Sendblue keys…\n");
    const output = await runCapture(cmd, [...leading, "show-keys"]);
    const parsed = parseSendblueKeys(output);
    if (!parsed.apiKey || !parsed.apiSecret) {
      console.log(
        "\nCouldn't auto-parse keys from CLI output. I'll ask for them below.",
      );
      return null;
    }
    console.log("\n✓ Pulled your Sendblue keys from the CLI.");

    if (!parsed.fromNumber) {
      try {
        console.log("\nFetching your provisioned number…\n");
        const linesOutput = await runCapture(cmd, [...leading, "lines"]);
        const phones = parseSendbluePhones(linesOutput);
        if (phones.length === 1) {
          parsed.fromNumber = phones[0];
          console.log(`\n✓ Using ${phones[0]} as SENDBLUE_FROM_NUMBER.`);
        } else if (phones.length > 1) {
          const { pickedNumber } = await prompts({
            type: "select",
            name: "pickedNumber",
            message: "Multiple Sendblue numbers found — which one should Boop reply from?",
            choices: phones.map((p) => ({ title: p, value: p })),
            initial: 0,
          });
          if (pickedNumber) parsed.fromNumber = pickedNumber;
        }
      } catch {
        console.log("\n⚠ Couldn't fetch provisioned numbers. I'll ask below.");
      }
    }
    return parsed;
  } catch (err) {
    console.log(`\n⚠ Sendblue CLI failed: ${err}`);
    console.log("Falling back to manual prompts.");
    return null;
  }
}

async function ensureWranglerAuth(): Promise<void> {
  try {
    await runCapture("wrangler", ["whoami"]);
  } catch {
    console.log("\nNot logged into Cloudflare. Opening browser…\n");
    await runInherit("wrangler", ["login"]);
  }
}

async function pushSecret(key: string, value: string): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn("wrangler", ["secret", "put", key], {
      stdio: ["pipe", "inherit", "inherit"],
      cwd: ROOT,
    });
    child.stdin.write(value);
    child.stdin.end();
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`wrangler secret put ${key} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

async function main() {
  banner("boop-agent setup (Cloudflare Workers)");

  console.log(`
What this does:
  1. Ensures you're logged into Cloudflare (wrangler login)
  2. Collects your Sendblue keys (via CLI or manual)
  3. Collects your Composio API key
  4. Runs Convex dev to configure your database
  5. Writes .dev.vars for local dev
  6. Optionally pushes secrets to Cloudflare for production

Before you start:
  • Cloudflare account (free):    https://dash.cloudflare.com
  • Convex account (free tier):   https://convex.dev
  • Sendblue (free on agent plan): https://sendblue.com
`);

  await ensureWranglerAuth();

  const existing = readEnv(DEV_VARS_PATH);
  const cli = await importSendblueFromCli();

  const sendblueDefaults = {
    SENDBLUE_API_KEY: cli?.apiKey ?? existing["SENDBLUE_API_KEY"] ?? "",
    SENDBLUE_API_SECRET: cli?.apiSecret ?? existing["SENDBLUE_API_SECRET"] ?? "",
    SENDBLUE_FROM_NUMBER: cli?.fromNumber ?? existing["SENDBLUE_FROM_NUMBER"] ?? "",
  };

  const sendbluePrompts: prompts.PromptObject[] = [];
  if (!sendblueDefaults.SENDBLUE_API_KEY) {
    sendbluePrompts.push({
      type: "text",
      name: "SENDBLUE_API_KEY",
      message: "Sendblue API key id (sb-api-key-id value)",
    });
  }
  if (!sendblueDefaults.SENDBLUE_API_SECRET) {
    sendbluePrompts.push({
      type: "password",
      name: "SENDBLUE_API_SECRET",
      message: "Sendblue API secret",
    });
  }
  if (!sendblueDefaults.SENDBLUE_FROM_NUMBER) {
    sendbluePrompts.push({
      type: "text",
      name: "SENDBLUE_FROM_NUMBER",
      message: "Sendblue-provisioned number (the one people text TO, e.g. +14695551234)",
    });
  }

  const answers = await prompts(
    [
      ...sendbluePrompts,
      {
        type: "select",
        name: "BOOP_MODEL",
        message: "Default model for the dispatcher and executor?",
        choices: [
          { title: "kimi-k2.6 (recommended — SOTA tool calling, Workers AI)", value: "kimi-k2.6" },
          { title: "claude-sonnet-4-6 (Anthropic, higher cost)", value: "claude-sonnet-4-6" },
          { title: "glm-4.7-flash (cheapest, Workers AI)", value: "glm-4.7-flash" },
        ],
        initial: 0,
      },
    ],
    { onCancel: () => process.exit(1) },
  );

  Object.assign(answers, {
    SENDBLUE_API_KEY: answers["SENDBLUE_API_KEY"] ?? sendblueDefaults.SENDBLUE_API_KEY,
    SENDBLUE_API_SECRET: answers["SENDBLUE_API_SECRET"] ?? sendblueDefaults.SENDBLUE_API_SECRET,
    SENDBLUE_FROM_NUMBER: answers["SENDBLUE_FROM_NUMBER"] ?? sendblueDefaults.SENDBLUE_FROM_NUMBER,
  });

  banner("Composio — integrations (Gmail, Slack, GitHub, Linear, 1000+ more)");
  const composioSettingsUrl = "https://platform.composio.dev/settings";
  const existingComposio = existing["COMPOSIO_API_KEY"] ?? "";
  const { composioMode } = await prompts(
    {
      type: "select",
      name: "composioMode",
      message: existingComposio
        ? "Composio API key detected. Keep it or replace?"
        : "Configure Composio now? (needed to connect any integration)",
      choices: existingComposio
        ? [
            { title: "Keep existing key", value: "keep" },
            { title: "Replace (opens the Composio dashboard)", value: "replace" },
            { title: "Skip", value: "skip" },
          ]
        : [
            { title: "Yes — open the Composio dashboard and paste my key", value: "replace" },
            { title: "Skip for now", value: "skip" },
          ],
      initial: 0,
    },
    { onCancel: () => process.exit(1) },
  );

  let composioKey = existingComposio;
  if (composioMode === "replace") {
    console.log(`\nOpening ${composioSettingsUrl} — grab your API key there.`);
    openInBrowser(composioSettingsUrl);
    const { COMPOSIO_API_KEY } = await prompts(
      {
        type: "password",
        name: "COMPOSIO_API_KEY",
        message: "Paste your Composio API key (leave blank to skip):",
      },
      { onCancel: () => process.exit(1) },
    );
    composioKey = COMPOSIO_API_KEY || existingComposio;
  }

  banner("Convex — real-time database");
  const { runConvex } = await prompts(
    {
      type: "confirm",
      name: "runConvex",
      message: "Run `convex dev` now to configure your Convex deployment?",
      initial: true,
    },
    { onCancel: () => process.exit(1) },
  );

  let convexUrl = existing["CONVEX_URL"] ?? "";
  if (runConvex) {
    const existingDeployment = existing["CONVEX_DEPLOYMENT"];
    const args = existingDeployment
      ? ["convex", "dev", "--once"]
      : ["convex", "dev", "--once", "--configure", "new"];

    if (existingDeployment) {
      console.log(`Reusing existing deployment: ${existingDeployment}`);
    }
    await runInherit("bunx", args);

    const after = readEnv(resolve(ROOT, ".env.local"));
    convexUrl = after["CONVEX_URL"] || after["VITE_CONVEX_URL"] || convexUrl;

    if (!convexUrl && after["CONVEX_DEPLOYMENT"]) {
      const match = after["CONVEX_DEPLOYMENT"].match(/^[a-z]+:([\w-]+)/);
      if (match) convexUrl = `https://${match[1]}.convex.cloud`;
    }
  }

  const devVars: Record<string, string> = {
    SENDBLUE_API_KEY: answers["SENDBLUE_API_KEY"] ?? "",
    SENDBLUE_API_SECRET: answers["SENDBLUE_API_SECRET"] ?? "",
    SENDBLUE_FROM_NUMBER: answers["SENDBLUE_FROM_NUMBER"] ?? "",
    COMPOSIO_API_KEY: composioKey,
    CONVEX_URL: convexUrl,
    CONVEX_DEPLOYMENT: existing["CONVEX_DEPLOYMENT"] ?? "",
    VITE_CONVEX_URL: convexUrl,
  };

  const voyageKey = existing["VOYAGE_API_KEY"];
  if (voyageKey) devVars["VOYAGE_API_KEY"] = voyageKey;

  writeDevVars(devVars);
  console.log("\n✓ Wrote .dev.vars for local development.");

  banner("CF AI Gateway setup (one-time)");
  console.log(`
To use external LLM providers (Anthropic for consolidation), configure
AI Gateway in the Cloudflare dashboard:

  1. Go to https://dash.cloudflare.com → AI → AI Gateway
  2. Create a gateway (e.g. "boop-gateway")
  3. Add providers: Anthropic (paste your API key)
  4. Note the gateway ID for your wrangler.toml if needed

Workers AI models (Kimi K2.6, GLM 4.7 Flash) work without any
additional API keys — they run on Cloudflare's infrastructure.
`);

  banner("Push secrets to Cloudflare? (for production deploys)");
  const { pushSecrets } = await prompts(
    {
      type: "confirm",
      name: "pushSecrets",
      message: "Push secrets to Cloudflare now via `wrangler secret put`?",
      initial: false,
    },
    { onCancel: () => process.exit(1) },
  );

  if (pushSecrets) {
    const secrets: Record<string, string> = {
      SENDBLUE_API_KEY: devVars["SENDBLUE_API_KEY"] ?? "",
      SENDBLUE_API_SECRET: devVars["SENDBLUE_API_SECRET"] ?? "",
      COMPOSIO_API_KEY: devVars["COMPOSIO_API_KEY"] ?? "",
      CONVEX_URL: devVars["CONVEX_URL"] ?? "",
    };
    if (devVars["VOYAGE_API_KEY"]) secrets["VOYAGE_API_KEY"] = devVars["VOYAGE_API_KEY"];

    for (const [key, value] of Object.entries(secrets)) {
      if (!value) {
        console.log(`  ⏭ Skipping ${key} (empty)`);
        continue;
      }
      try {
        await pushSecret(key, value);
        console.log(`  ✓ ${key}`);
      } catch (err) {
        console.log(`  ✗ ${key}: ${err}`);
      }
    }
  }

  banner("You're set up.");
  console.log(`
Run locally:
  bun run dev          # starts wrangler dev (Worker + Durable Objects)
  bun run dev:convex   # starts Convex dev server (separate terminal)

Deploy:
  bun run deploy       # deploys to Cloudflare Workers
  bun run deploy:convex # deploys Convex to production

Your webhook URL (once deployed):
  https://boop-agent.<your-account>.workers.dev/sendblue/webhook

Wire up Sendblue (one-time):
  1. Go to Sendblue dashboard → API Settings → Webhook Configuration
  2. Add the URL above as an INBOUND MESSAGE webhook
  3. Save

Debug dashboard:
  bun run build:debug  # build the dashboard
  Then visit your Worker URL — static assets served from the same Worker.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
