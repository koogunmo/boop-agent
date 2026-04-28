import { afterEach, describe, expect, it, vi } from "vitest";
import { chunk, sendImessage } from "./sendblue";
import { testEnv } from "./test-helpers";

function mockSendblueResponse(status = "QUEUED") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ status, number: "+1234", content: "test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("chunk", () => {
  it("returns single chunk for short text", () => {
    expect(chunk("hello")).toEqual(["hello"]);
  });

  it("uses default MAX_CHUNK of 2900", () => {
    const text = "a".repeat(2900);
    expect(chunk(text)).toEqual([text]);

    const longText = `${"a".repeat(1500)}\n${"b".repeat(1500)}`;
    const result = chunk(longText);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(1500));
    expect(result[1]).toBe("b".repeat(1500));
  });

  it("splits on newline boundaries when exceeding size", () => {
    const line = "a".repeat(1500);
    const result = chunk(`${line}\n${line}`, 2900);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(line);
    expect(result[1]).toBe(line);
  });

  it("keeps lines together when they fit", () => {
    expect(chunk("line1\nline2\nline3", 2900)).toEqual(["line1\nline2\nline3"]);
  });

  it("handles empty string", () => {
    expect(chunk("")).toEqual([""]);
  });

  it("does NOT split a single line exceeding size", () => {
    const longLine = "a".repeat(4000);
    const result = chunk(longLine, 2900);
    expect(result).toHaveLength(1);
    expect(result[0]!.length).toBeGreaterThan(2900);
  });

  it("handles multiple splits", () => {
    const line = "x".repeat(1000);
    const result = chunk([line, line, line, line].join("\n"), 2100);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(`${line}\n${line}`);
    expect(result[1]).toBe(`${line}\n${line}`);
  });
});

describe("sendImessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call fetch when credentials are missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendImessage(testEnv({ SENDBLUE_API_KEY: "", SENDBLUE_API_SECRET: "" }), "+1234", "hi");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not call fetch when from number is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sendImessage(testEnv({ SENDBLUE_FROM_NUMBER: "" }), "+1234", "hi");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls Sendblue SDK to send message", async () => {
    const fetchSpy = mockSendblueResponse();

    await sendImessage(testEnv(), "+14155551234", "**bold** message");

    expect(fetchSpy).toHaveBeenCalled();
    const call = fetchSpy.mock.calls[0]!;
    const url = call[0];
    expect(String(url)).toContain("sendblue");
  });

  it("strips markdown from message content before sending", async () => {
    const fetchSpy = mockSendblueResponse();

    await sendImessage(testEnv(), "+14155551234", "**bold** and *italic*");

    expect(fetchSpy).toHaveBeenCalled();
    const call = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(call[1]!.body! as string) as { content: string };
    expect(body.content).toBe("bold and italic");
  });

  it("chunks long messages into multiple SDK calls", async () => {
    const fetchSpy = mockSendblueResponse();

    const longMessage = `${"a".repeat(1500)}\n${"b".repeat(1500)}`;
    await sendImessage(testEnv(), "+1234", longMessage);

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("logs error on failed send but does not throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error_message: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendImessage(testEnv(), "+1234", "hi");

    expect(consoleSpy).toHaveBeenCalled();
  });
});
