import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex, testEnv } from "../lib/test-helpers";
import { createAckTools } from "./ack";
import { createAutomationTools } from "./automations";
import { createDraftDecisionTools, createDraftStagingTools } from "./drafts";
import { createMemoryTools } from "./memory";
import { createSelfTools } from "./self";
import { createSpawnTools } from "./spawn";

const CONV_ID = "test:conv";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

/* ---------- write_memory ---------- */

describe("write_memory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses segment default tier for identity (permanent) and calls upsert + emit", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.write_memory.execute!(
      { content: "User is an engineer", segment: "identity", importance: 0.85 },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("tier=permanent");
    expect(resultStr).toContain("segment=identity");

    expect(convex.mutation).toHaveBeenCalledTimes(2);

    // First call: memoryRecords.upsert
    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs).toMatchObject({
      content: "User is an engineer",
      tier: "permanent",
      segment: "identity",
      importance: 0.85,
      decayRate: 0,
    });

    // Second call: memoryEvents.emit
    const emitArgs = convex.mutation.mock.calls[1]![1];
    expect(emitArgs).toMatchObject({
      eventType: "memory.written",
      conversationId: CONV_ID,
    });
    const emitData = z
      .object({ tier: z.string(), segment: z.string(), importance: z.number() })
      .parse(JSON.parse(emitArgs.data));
    expect(emitData.tier).toBe("permanent");
  });

  it("uses segment default tier for context (short)", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.write_memory.execute!(
      { content: "Currently at a coffee shop", segment: "context", importance: 0.4 },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("tier=short");

    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs.tier).toBe("short");
    // write_memory uses DEFAULT_DECAY[tier], not SEGMENT_DEFAULTS[segment].decayRate
    expect(upsertArgs.decayRate).toBe(0.05);
  });

  it("passes supersedes array when provided", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    await tools.write_memory.execute!(
      {
        content: "Name is actually Alex",
        segment: "correction",
        importance: 0.8,
        supersedes: ["mem_old1", "mem_old2"],
      },
      toolOpts,
    );

    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs.supersedes).toEqual(["mem_old1", "mem_old2"]);
  });

  it("allows explicit tier override", async () => {
    const convex = mockConvex();
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.write_memory.execute!(
      { content: "Temporary note", segment: "knowledge", importance: 0.5, tier: "short" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("tier=short");

    const upsertArgs = convex.mutation.mock.calls[0]![1];
    expect(upsertArgs.tier).toBe("short");
  });
});

/* ---------- recall ---------- */

describe("recall", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 'No memories matched.' when search returns empty", async () => {
    const convex = mockConvex([]);
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.recall.execute!({ query: "nonexistent topic", limit: 10 }, toolOpts);

    expect(z.string().parse(result)).toBe("No memories matched.");
  });

  it("formats results with tier/segment/importance and calls markAccessed", async () => {
    const memories = [
      {
        memoryId: "mem_abc",
        tier: "permanent",
        segment: "identity",
        importance: 0.85,
        content: "User is an engineer",
      },
      {
        memoryId: "mem_def",
        tier: "long",
        segment: "preference",
        importance: 0.7,
        content: "Prefers dark mode",
      },
    ];
    const convex = mockConvex(memories);
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    const result = await tools.recall.execute!({ query: "user info", limit: 10 }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("permanent/identity");
    expect(resultStr).toContain("importance=0.85");
    expect(resultStr).toContain("mem_abc");
    expect(resultStr).toContain("User is an engineer");
    expect(resultStr).toContain("long/preference");
    expect(resultStr).toContain("Prefers dark mode");

    // markAccessed called once per result
    const markAccessedCalls = convex.mutation.mock.calls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown>;
      return "memoryId" in args && !("eventType" in args);
    });
    expect(markAccessedCalls).toHaveLength(2);
    expect(markAccessedCalls[0]![1]).toMatchObject({ memoryId: "mem_abc" });
    expect(markAccessedCalls[1]![1]).toMatchObject({ memoryId: "mem_def" });
  });

  it("emits memory.recalled event", async () => {
    const convex = mockConvex([]);
    const tools = createMemoryTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
    });

    await tools.recall.execute!({ query: "anything", limit: 5 }, toolOpts);

    // The last mutation call should be the emit
    const lastCall = convex.mutation.mock.calls[convex.mutation.mock.calls.length - 1]!;
    expect(lastCall[1]).toMatchObject({
      eventType: "memory.recalled",
      conversationId: CONV_ID,
    });
    const data = z
      .object({ query: z.string(), hits: z.number(), mode: z.string() })
      .parse(JSON.parse(lastCall[1].data));
    expect(data.query).toBe("anything");
    expect(data.hits).toBe(0);
    expect(data.mode).toBe("substring");
  });
});

/* ---------- send_ack ---------- */

describe("send_ack", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends message and returns confirmation", async () => {
    const convex = mockConvex();
    const broadcast = vi.fn();
    const tools = createAckTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
      turnId: "turn_test",
      broadcast,
    });

    const result = await tools.send_ack.execute!({ message: "On it!" }, toolOpts);

    expect(z.string().parse(result)).toBe("Ack sent to user.");
    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      conversationId: CONV_ID,
      role: "assistant",
      content: "On it!",
    });
    expect(broadcast).toHaveBeenCalledWith("assistant_ack", {
      conversationId: CONV_ID,
      content: "On it!",
    });
  });

  it("returns 'Empty ack skipped.' for whitespace-only message", async () => {
    const convex = mockConvex();
    const broadcast = vi.fn();
    const tools = createAckTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: CONV_ID,
      turnId: "turn_test",
      broadcast,
    });

    const result = await tools.send_ack.execute!({ message: "   " }, toolOpts);

    expect(z.string().parse(result)).toBe("Empty ack skipped.");
    expect(convex.mutation).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("sends iMessage for sms: conversationId", async () => {
    const convex = mockConvex();
    const broadcast = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "QUEUED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const tools = createAckTools({
      convex: cvx(convex),
      env: testEnv(),
      conversationId: "sms:+14155551234",
      turnId: "turn_test",
      broadcast,
    });

    await tools.send_ack.execute!({ message: "Got it" }, toolOpts);

    expect(fetchSpy).toHaveBeenCalled();
    expect(convex.mutation).toHaveBeenCalledOnce();
  });
});

/* ---------- create_automation ---------- */

describe("create_automation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates automation with valid cron and returns confirmation", async () => {
    const convex = mockConvex();
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.create_automation.execute!(
      {
        name: "morning digest",
        schedule: "0 8 * * *",
        task: "Summarize unread emails",
        integrations: ["gmail"],
        notify: true,
      },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Created automation");
    expect(resultStr).toContain("morning digest");
    expect(resultStr).toContain("0 8 * * *");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      name: "morning digest",
      task: "Summarize unread emails",
      schedule: "0 8 * * *",
      conversationId: CONV_ID,
      notifyConversationId: CONV_ID,
    });
  });

  it("rejects invalid cron expression", async () => {
    const convex = mockConvex();
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.create_automation.execute!(
      {
        name: "bad cron",
        schedule: "not a cron",
        task: "whatever",
        integrations: [],
        notify: true,
      },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Invalid cron expression");
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});

/* ---------- list_automations ---------- */

describe("list_automations", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 'No automations.' when none exist", async () => {
    const convex = mockConvex([]);
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.list_automations.execute!({ enabledOnly: false }, toolOpts);

    expect(z.string().parse(result)).toBe("No automations.");
  });

  it("lists automations belonging to current conversation", async () => {
    const convex = mockConvex([
      {
        automationId: "auto_1",
        enabled: true,
        name: "daily digest",
        schedule: "0 8 * * *",
        task: "summarize",
        conversationId: CONV_ID,
      },
      {
        automationId: "auto_2",
        enabled: false,
        name: "other",
        schedule: "0 9 * * *",
        task: "other task",
        conversationId: "other:conv",
      },
    ]);
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.list_automations.execute!({ enabledOnly: false }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("auto_1");
    expect(resultStr).toContain("daily digest");
    expect(resultStr).not.toContain("auto_2");
  });
});

/* ---------- toggle_automation ---------- */

describe("toggle_automation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls setEnabled and returns confirmation", async () => {
    const convex = mockConvex();
    convex.mutation.mockResolvedValue("auto_1");
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.toggle_automation.execute!(
      { automationId: "auto_1", enabled: false },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("auto_1");
    expect(resultStr).toContain("enabled=false");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      automationId: "auto_1",
      enabled: false,
    });
  });

  it("returns 'Not found.' when mutation returns null", async () => {
    const convex = mockConvex();
    convex.mutation.mockResolvedValue(null);
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.toggle_automation.execute!(
      { automationId: "auto_missing", enabled: true },
      toolOpts,
    );

    expect(z.string().parse(result)).toBe("Not found.");
  });
});

/* ---------- delete_automation ---------- */

describe("delete_automation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls remove and returns confirmation", async () => {
    const convex = mockConvex();
    convex.mutation.mockResolvedValue("auto_1");
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.delete_automation.execute!({ automationId: "auto_1" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Deleted auto_1");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({ automationId: "auto_1" });
  });

  it("returns 'Not found.' when mutation returns null", async () => {
    const convex = mockConvex();
    convex.mutation.mockResolvedValue(null);
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.delete_automation.execute!(
      { automationId: "auto_missing" },
      toolOpts,
    );

    expect(z.string().parse(result)).toBe("Not found.");
  });
});

/* ---------- save_draft ---------- */

describe("save_draft", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates draft and returns confirmation with draftId", async () => {
    const convex = mockConvex();
    const tools = createDraftStagingTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.save_draft.execute!(
      {
        kind: "gmail.reply",
        summary: "Reply to Bob about meeting",
        payload: JSON.stringify({ to: "bob@example.com", body: "Sounds good" }),
      },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Draft saved as");
    expect(resultStr).toContain("draft_");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      conversationId: CONV_ID,
      kind: "gmail.reply",
      summary: "Reply to Bob about meeting",
    });
  });
});

/* ---------- list_drafts ---------- */

describe("list_drafts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 'No pending drafts.' when none exist", async () => {
    const convex = mockConvex([]);
    const tools = createDraftDecisionTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.list_drafts.execute!({}, toolOpts);

    expect(z.string().parse(result)).toBe("No pending drafts.");
  });

  it("lists drafts with draftId, kind, and summary", async () => {
    const convex = mockConvex([
      { draftId: "draft_1", kind: "gmail.reply", summary: "Reply to Bob" },
      { draftId: "draft_2", kind: "gcal.event", summary: "Create meeting" },
    ]);
    const tools = createDraftDecisionTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.list_drafts.execute!({}, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("draft_1");
    expect(resultStr).toContain("gmail.reply");
    expect(resultStr).toContain("Reply to Bob");
    expect(resultStr).toContain("draft_2");
  });
});

/* ---------- reject_draft ---------- */

describe("reject_draft", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls setStatus with rejected and returns confirmation", async () => {
    const convex = mockConvex();
    const tools = createDraftDecisionTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.reject_draft.execute!({ draftId: "draft_1" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("draft_1");
    expect(resultStr).toContain("rejected");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      draftId: "draft_1",
      status: "rejected",
    });
  });
});

/* ---------- spawn_agent ---------- */

describe("spawn_agent", () => {
  it("returns Phase 3 stub message", async () => {
    const tools = createSpawnTools();

    const result = await tools.spawn_agent.execute!(
      { task: "Check email", integrations: ["gmail"], name: "email-check" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Phase 3");
  });
});

/* ---------- get_config ---------- */

describe("get_config", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns JSON config with model field from env", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue(null);
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z
      .object({
        model: z.string(),
        envDefault: z.string(),
        availableModels: z.array(z.string()),
        composioEnabled: z.boolean(),
        embeddingsEnabled: z.boolean(),
        sendblueEnabled: z.boolean(),
      })
      .parse(JSON.parse(z.string().parse(result)));

    expect(config.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(config.composioEnabled).toBe(true);
    expect(config.sendblueEnabled).toBe(true);
  });

  it("uses stored model from settings when available and known", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("anthropic/claude-sonnet-4-6");
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z.object({ model: z.string() }).parse(JSON.parse(z.string().parse(result)));
    expect(config.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("falls back to env model when stored model is unknown", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("unknown-model");
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.get_config.execute!({}, toolOpts);

    const config = z.object({ model: z.string() }).parse(JSON.parse(z.string().parse(result)));
    expect(config.model).toBe("workers-ai/@cf/moonshotai/kimi-k2.6");
  });
});

/* ---------- set_model ---------- */

describe("set_model", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves alias and calls settings.set", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!({ model: "opus" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("anthropic/claude-opus-4-7");

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      key: "model",
      value: "anthropic/claude-opus-4-7",
    });
  });

  it("accepts canonical model ID", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!(
      { model: "workers-ai/@cf/moonshotai/kimi-k2.6" },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("workers-ai/@cf/moonshotai/kimi-k2.6");
    expect(convex.mutation).toHaveBeenCalledOnce();
  });

  it("returns error for unknown model", async () => {
    const convex = mockConvex();
    const tools = createSelfTools({ convex: cvx(convex), env: testEnv() });

    const result = await tools.set_model.execute!({ model: "gpt-5-turbo" }, toolOpts);

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("Unknown model");
    expect(resultStr).toContain("gpt-5-turbo");
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});
