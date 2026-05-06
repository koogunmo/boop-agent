import { describe, expect, it, vi } from "vitest";
import { testEnv } from "@/lib/test-helpers";
import { runProactivePipeline } from "@/proactive/pipeline";
import type { NormalizedEvent, TriggerTemplate, WebhookMeta } from "@/proactive/types";

const mockTemplate: TriggerTemplate = {
  name: "email",
  normalize: vi.fn().mockReturnValue({
    triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE",
    appSlug: "gmail",
    sender: "alice@example.com",
    subject: "Test email",
    body: "Hello",
    dedupKey: "msg_1",
    connectedAccountId: "conn_1",
    raw: {},
  } satisfies NormalizedEvent),
  rubric: "Surface if important",
};

function mockDeps(
  overrides: {
    dedupExists?: boolean;
    warmupDone?: boolean;
    triggerConfig?: { enabled: boolean; template: string } | null;
    classifyResult?: { important: boolean; summary?: string };
  } = {},
) {
  const warmupDone = overrides.warmupDone ?? true;
  const dedupExists = overrides.dedupExists ?? false;
  const convex = {
    query: vi.fn().mockImplementation((_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (a.triggerSlug) return overrides.triggerConfig ?? { enabled: true, template: "email" };
      if (a.key === "proactive_phone") return "+15555550000";
      return null;
    }),
    mutation: vi.fn().mockResolvedValue(null),
  };
  const kv = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key.startsWith("dedup:")) return dedupExists ? "1" : null;
      if (key.startsWith("warmup:")) return warmupDone ? "1" : null;
      return null;
    }),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const broadcast = vi.fn();
  const classify = vi
    .fn()
    .mockResolvedValue(
      overrides.classifyResult ?? { important: true, summary: "Important email from Alice" },
    );
  const dispatch = vi.fn().mockResolvedValue("Got it, checking now.");

  const env = testEnv({
    PROACTIVE_KV: kv as unknown as Env["PROACTIVE_KV"],
  });

  return { convex, kv, broadcast, classify, dispatch, env };
}

const meta: WebhookMeta = {
  trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
  connected_account_id: "conn_1",
};

describe("runProactivePipeline", () => {
  it("processes an important event end to end", async () => {
    const deps = mockDeps();
    const result = await runProactivePipeline({
      env: deps.env,
      data: { messageId: "msg_1", sender: "alice@example.com", subject: "Test" },
      meta,
      template: mockTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(result.action).toBe("dispatched");
    expect(deps.kv.put).toHaveBeenCalledWith("dedup:msg_1", "1", { expirationTtl: 86400 });
    expect(deps.classify).toHaveBeenCalledOnce();
    expect(deps.dispatch).toHaveBeenCalledOnce();
    expect(deps.broadcast).toHaveBeenCalledWith(
      "proactive_dispatched",
      expect.objectContaining({ triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE" }),
    );
  });

  it("skips duplicate events", async () => {
    const deps = mockDeps({ dedupExists: true });
    const result = await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: mockTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(result.action).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("duplicate");
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it("skips when trigger is disabled", async () => {
    const deps = mockDeps({ triggerConfig: { enabled: false, template: "email" } });
    const result = await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: mockTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(result.action).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("disabled");
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it("skips when classifier returns not important", async () => {
    const deps = mockDeps({ classifyResult: { important: false } });
    const result = await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: mockTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(result.action).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("not_important");
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("skips when normalizer returns null", async () => {
    const nullTemplate: TriggerTemplate = {
      ...mockTemplate,
      normalize: vi.fn().mockReturnValue(null),
    };
    const deps = mockDeps();
    const result = await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: nullTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(result.action).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("normalize_failed");
  });

  it("skips first event per connection as warmup", async () => {
    const deps = mockDeps({ warmupDone: false });
    const result = await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: mockTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(result.action).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("warmup");
    expect(deps.classify).not.toHaveBeenCalled();
    expect(deps.kv.put).toHaveBeenCalledWith(
      expect.stringContaining("warmup:"),
      "1",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("skips self-send when template detects it", async () => {
    const selfSendTemplate: TriggerTemplate = {
      ...mockTemplate,
      isSelfSend: (_event, identities) => identities.includes("alice@example.com"),
    };
    const deps = mockDeps();
    const result = await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: selfSendTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
      userIdentities: ["alice@example.com"],
    });

    expect(result.action).toBe("skipped");
    expect((result as { reason: string }).reason).toBe("self_send");
    expect(deps.classify).not.toHaveBeenCalled();
  });

  it("broadcasts proactive_skipped with reason on skip", async () => {
    const deps = mockDeps({ classifyResult: { important: false } });
    await runProactivePipeline({
      env: deps.env,
      data: {},
      meta,
      template: mockTemplate,
      convex: deps.convex as never,
      broadcast: deps.broadcast,
      classify: deps.classify,
      dispatch: deps.dispatch,
    });

    expect(deps.broadcast).toHaveBeenCalledWith(
      "proactive_skipped",
      expect.objectContaining({ reason: "not_important" }),
    );
  });
});
