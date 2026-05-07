import { mergeTextLogs } from "@boop/shared";
import { describe, expect, it } from "vitest";

describe("mergeTextLogs", () => {
  it("merges consecutive text logs into one entry", () => {
    const logs = [
      { _id: "1", logType: "text", content: "G" },
      { _id: "2", logType: "text", content: "mail is available —" },
      { _id: "3", logType: "text", content: " I'll" },
      { _id: "4", logType: "text", content: " save a draft." },
    ];
    const merged = mergeTextLogs(logs);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.logType).toBe("text");
    expect(merged[0]!.content).toBe("Gmail is available — I'll save a draft.");
  });

  it("preserves non-text logs between text runs", () => {
    const logs = [
      { _id: "1", logType: "text", content: "Starting" },
      { _id: "2", logType: "text", content: " search" },
      { _id: "3", logType: "tool_use", content: '{"query":"test"}', toolName: "web_search" },
      { _id: "4", logType: "tool_result", content: "results here" },
      { _id: "5", logType: "text", content: "Found" },
      { _id: "6", logType: "text", content: " the answer." },
    ];
    const merged = mergeTextLogs(logs);
    expect(merged).toHaveLength(4);
    expect(merged[0]!.content).toBe("Starting search");
    expect(merged[1]!.logType).toBe("tool_use");
    expect(merged[2]!.logType).toBe("tool_result");
    expect(merged[3]!.content).toBe("Found the answer.");
  });

  it("returns empty array for empty input", () => {
    expect(mergeTextLogs([])).toEqual([]);
  });

  it("passes through non-text logs unchanged", () => {
    const logs = [
      { _id: "1", logType: "tool_use", content: "call", toolName: "web_search" },
      { _id: "2", logType: "error", content: "failed" },
    ];
    const merged = mergeTextLogs(logs);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(logs[0]);
    expect(merged[1]).toEqual(logs[1]);
  });

  it("handles single text log without modification", () => {
    const logs = [{ _id: "1", logType: "text", content: "hello world" }];
    const merged = mergeTextLogs(logs);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.content).toBe("hello world");
  });
});
