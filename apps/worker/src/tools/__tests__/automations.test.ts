import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex } from "@/lib/test-helpers";
import { createAutomationTools, nextRunFor, validateSchedule } from "@/tools/automations";

const CONV_ID = "test:conv";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

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

  it("stores timezone on the automation when provided", async () => {
    const convex = mockConvex();
    const tools = createAutomationTools({
      convex: cvx(convex),
      conversationId: CONV_ID,
      userTimezone: "America/Chicago",
    });

    await tools.create_automation.execute!(
      {
        name: "central digest",
        schedule: "0 8 * * *",
        task: "Summarize emails",
        integrations: [],
        notify: false,
      },
      toolOpts,
    );

    expect(convex.mutation).toHaveBeenCalledOnce();
    expect(convex.mutation.mock.calls[0]![1]).toMatchObject({
      timezone: "America/Chicago",
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

describe("toggle_automation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls setEnabled and returns confirmation", async () => {
    const convex = mockConvex([
      { automationId: "auto_1", enabled: true, name: "test", schedule: "0 8 * * *", task: "do it" },
    ]);
    convex.mutation.mockResolvedValue("auto_1");
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.toggle_automation.execute!(
      { automationId: "auto_1", enabled: false },
      toolOpts,
    );

    const resultStr = z.string().parse(result);
    expect(resultStr).toContain("auto_1");
    expect(resultStr).toContain("enabled=false");
  });

  it("returns 'Not found.' when automation doesn't exist", async () => {
    const convex = mockConvex([]);
    const tools = createAutomationTools({ convex: cvx(convex), conversationId: CONV_ID });

    const result = await tools.toggle_automation.execute!(
      { automationId: "auto_missing", enabled: true },
      toolOpts,
    );

    expect(z.string().parse(result)).toBe("Not found.");
  });
});

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

describe("validateSchedule", () => {
  it("validates a cron expression without timezone", () => {
    expect(validateSchedule("0 8 * * *").valid).toBe(true);
  });

  it("validates with a timezone", () => {
    expect(validateSchedule("0 8 * * *", "America/New_York").valid).toBe(true);
  });

  it("rejects invalid cron", () => {
    expect(validateSchedule("not valid").valid).toBe(false);
  });
});

describe("nextRunFor", () => {
  it("computes different next-run times for different timezones", () => {
    const eastern = nextRunFor("0 8 * * *", "America/New_York")!;
    const hawaii = nextRunFor("0 8 * * *", "Pacific/Honolulu")!;
    expect(eastern).toBeGreaterThan(0);
    expect(hawaii).toBeGreaterThan(0);
    expect(eastern).not.toBe(hawaii);
  });

  it("throws on invalid cron", () => {
    expect(() => nextRunFor("garbage", "UTC")).toThrow();
  });
});
