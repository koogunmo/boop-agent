import { describe, expect, it } from "vitest";
import { createDateTimeTool } from "@/tools/datetime";

const toolOpts = {
  messages: [],
  abortSignal: new AbortController().signal,
  toolCallId: "tc_test",
};

describe("get_current_datetime", () => {
  it("returns UTC by default", async () => {
    const tools = createDateTimeTool();
    const result = await tools.get_current_datetime.execute!({}, toolOpts);
    expect(result).toContain("UTC");
    expect(result).toMatch(/\d{4}/);
  });

  it("returns time in specified IANA timezone", async () => {
    const tools = createDateTimeTool();
    const result = await tools.get_current_datetime.execute!({ timezone: "Asia/Tokyo" }, toolOpts);
    expect(result).toMatch(/JST|GMT\+9/);
    expect(result).toContain("UTC:");
  });

  it("resolves alias 'eastern' to America/New_York", async () => {
    const tools = createDateTimeTool();
    const result = await tools.get_current_datetime.execute!({ timezone: "eastern" }, toolOpts);
    expect(result).toMatch(/EDT|EST/);
  });

  it("resolves city alias 'tokyo' to Asia/Tokyo", async () => {
    const tools = createDateTimeTool();
    const result = await tools.get_current_datetime.execute!({ timezone: "tokyo" }, toolOpts);
    expect(result).toMatch(/JST|GMT\+9/);
  });

  it("includes day of week", async () => {
    const tools = createDateTimeTool();
    const result = await tools.get_current_datetime.execute!({}, toolOpts);
    expect(result).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
  });

  it("includes ISO timestamp", async () => {
    const tools = createDateTimeTool();
    const result = await tools.get_current_datetime.execute!({}, toolOpts);
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
