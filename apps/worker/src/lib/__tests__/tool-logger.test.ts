import { describe, expect, it } from "vitest";
import { extractAccounts, serializeToolResult } from "@/lib/tool-logger";

describe("serializeToolResult", () => {
  it("returns string results as-is", () => {
    expect(serializeToolResult("hello world")).toBe("hello world");
  });

  it("serializes objects to formatted JSON", () => {
    const result = { status: "ok", data: [1, 2, 3] };
    const serialized = serializeToolResult(result);
    expect(JSON.parse(serialized)).toEqual(result);
  });

  it("serializes nested objects", () => {
    const result = { outer: { inner: { deep: true } } };
    const serialized = serializeToolResult(result);
    expect(JSON.parse(serialized)).toEqual(result);
  });

  it("serializes arrays", () => {
    const result = [{ id: 1 }, { id: 2 }];
    const serialized = serializeToolResult(result);
    expect(JSON.parse(serialized)).toEqual(result);
  });

  it("serializes null", () => {
    expect(serializeToolResult(null)).toBe("null");
  });

  it("serializes numbers", () => {
    expect(serializeToolResult(42)).toBe("42");
  });

  it("serializes booleans", () => {
    expect(serializeToolResult(true)).toBe("true");
  });

  it("truncates to maxLength", () => {
    const long = "a".repeat(5000);
    expect(serializeToolResult(long, 100)).toHaveLength(100);
  });

  it("truncates large objects", () => {
    const large = { data: "x".repeat(5000) };
    const serialized = serializeToolResult(large, 200);
    expect(serialized.length).toBeLessThanOrEqual(200);
  });

  it("produces valid JSON for non-string inputs", () => {
    const cases: [unknown, unknown][] = [
      [{}, {}],
      [{ a: 1 }, { a: 1 }],
      [{ nested: { obj: true } }, { nested: { obj: true } }],
      [
        [1, 2, 3],
        [1, 2, 3],
      ],
      [null, null],
      [42, 42],
      [true, true],
    ];
    for (const [input, expected] of cases) {
      const result = serializeToolResult(input);
      expect(JSON.parse(result)).toEqual(expected);
    }
  });

  it("returns 'undefined' string for undefined input", () => {
    expect(serializeToolResult(undefined)).toBe("undefined");
  });
});

describe("extractAccounts", () => {
  it("extracts account from top-level field", () => {
    expect(extractAccounts({ account: "user@example.com" })).toEqual(["user@example.com"]);
  });

  it("returns empty for non-object input", () => {
    expect(extractAccounts("string")).toEqual([]);
    expect(extractAccounts(null)).toEqual([]);
    expect(extractAccounts(42)).toEqual([]);
  });
});
