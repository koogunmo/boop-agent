import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex, testEnv } from "@/lib/test-helpers";
import { createAckTools } from "@/tools/ack";

const CONV_ID = "test:conv";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

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
