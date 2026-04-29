import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cvx, mockConvex } from "../lib/test-helpers";
import { createDraftDecisionTools, createDraftStagingTools } from "./drafts";

const CONV_ID = "test:conv";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

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
