import { afterEach, describe, expect, it, vi } from "vitest";
import { testEnv } from "@/lib/test-helpers";
import { classifyEvent } from "@/proactive/classify";
import type { NormalizedEvent } from "@/proactive/types";

const mockEvent: NormalizedEvent = {
  triggerSlug: "GMAIL_NEW_GMAIL_MESSAGE",
  appSlug: "gmail",
  sender: "boss@company.com",
  subject: "Urgent: deploy is broken",
  body: "The production deploy just failed. Can you look at it?",
  dedupKey: "msg_123",
  connectedAccountId: "conn_1",
  raw: {},
};

const rubric = "Surface if urgent. Drop if spam.";

function mockAi(response: unknown) {
  return { run: vi.fn().mockResolvedValue({ response }) } as unknown as Ai;
}

describe("classifyEvent", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns important=true with summary when classified important", async () => {
    const env = testEnv({
      AI: mockAi({ important: true, summary: "Production deploy failed — boss needs you." }),
    });

    const result = await classifyEvent(env, mockEvent, rubric);
    expect(result.important).toBe(true);
    expect(result.summary).toBe("Production deploy failed — boss needs you.");
  });

  it("returns important=false when classified not important", async () => {
    const env = testEnv({
      AI: mockAi({ important: false }),
    });

    const result = await classifyEvent(env, mockEvent, rubric);
    expect(result.important).toBe(false);
    expect(result.summary).toBeUndefined();
  });

  it("parses string response as JSON", async () => {
    const env = testEnv({
      AI: mockAi('{"important": true, "summary": "Urgent from boss"}'),
    });

    const result = await classifyEvent(env, mockEvent, rubric);
    expect(result.important).toBe(true);
    expect(result.summary).toBe("Urgent from boss");
  });

  it("passes rubric in system message and event in user message", async () => {
    const mockRun = vi.fn().mockResolvedValue({ response: { important: false } });
    const env = testEnv({ AI: { run: mockRun } as unknown as Ai });

    await classifyEvent(env, mockEvent, rubric);

    expect(mockRun).toHaveBeenCalledOnce();
    const callArgs = mockRun.mock.calls[0]!;
    const opts = callArgs[1] as { messages: Array<{ role: string; content: string }> };
    expect(opts.messages[0]!.content).toContain(rubric);
    expect(opts.messages[1]!.content).toContain("boss@company.com");
    expect(opts.messages[1]!.content).toContain("Urgent: deploy is broken");
  });

  it("uses json_schema response format", async () => {
    const mockRun = vi.fn().mockResolvedValue({ response: { important: false } });
    const env = testEnv({ AI: { run: mockRun } as unknown as Ai });

    await classifyEvent(env, mockEvent, rubric);

    const callArgs = mockRun.mock.calls[0]!;
    const opts = callArgs[1] as { response_format: { type: string } };
    expect(opts.response_format.type).toBe("json_schema");
  });
});
