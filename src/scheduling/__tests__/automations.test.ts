import { describe, expect, it } from "vitest";
import { nextRunFor } from "@/scheduling/automations";

describe("nextRunFor", () => {
  it("returns timestamp for valid cron", () => {
    const next = nextRunFor("0 8 * * *");
    expect(next).toBeTypeOf("number");
    expect(next).toBeGreaterThan(Date.now());
  });

  it("returns null for invalid cron", () => {
    expect(nextRunFor("not a cron")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(nextRunFor("")).toBeNull();
  });
});
