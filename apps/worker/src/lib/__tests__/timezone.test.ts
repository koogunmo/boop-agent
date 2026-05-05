import { describe, expect, it } from "vitest";
import { cvx, mockConvex } from "@/lib/test-helpers";
import {
  describeUserNow,
  getUserTimezone,
  isValidTimezone,
  resolveTimezoneInput,
} from "@/lib/timezone";

describe("isValidTimezone", () => {
  it("returns true for valid IANA timezone", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("returns false for invalid timezone", () => {
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("Fake/Zone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("resolveTimezoneInput", () => {
  it("returns IANA ID directly if valid", () => {
    expect(resolveTimezoneInput("America/Chicago")).toBe("America/Chicago");
  });

  it("resolves aliases to IANA IDs", () => {
    expect(resolveTimezoneInput("eastern")).toBe("America/New_York");
    expect(resolveTimezoneInput("Pacific")).toBe("America/Los_Angeles");
    expect(resolveTimezoneInput("tokyo")).toBe("Asia/Tokyo");
    expect(resolveTimezoneInput("CST")).toBe("America/Chicago");
  });

  it("returns null for unrecognized input", () => {
    expect(resolveTimezoneInput("Mars/Olympus_Mons")).toBeNull();
    expect(resolveTimezoneInput("")).toBeNull();
    expect(resolveTimezoneInput("   ")).toBeNull();
  });
});

describe("getUserTimezone", () => {
  it("returns stored timezone when set", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("America/Chicago");

    const tz = await getUserTimezone(cvx(convex));
    expect(tz).toBe("America/Chicago");
  });

  it("falls back to server timezone when not set", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue(null);

    const tz = await getUserTimezone(cvx(convex));
    expect(isValidTimezone(tz)).toBe(true);
  });

  it("falls back to server timezone when stored value is invalid", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("Not/A/Real/Zone");

    const tz = await getUserTimezone(cvx(convex));
    expect(tz).not.toBe("Not/A/Real/Zone");
    expect(isValidTimezone(tz)).toBe(true);
  });
});

describe("describeUserNow", () => {
  it("returns isExplicit=true when timezone is stored", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue("Asia/Tokyo");

    const result = await describeUserNow(cvx(convex));
    expect(result.isExplicit).toBe(true);
    expect(result.timezone).toBe("Asia/Tokyo");
    expect(result.now).toMatch(/JST|GMT\+9/);
    expect(result.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.weekday).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    expect(result.hourMinute).toMatch(/\d{1,2}:\d{2}/);
  });

  it("returns isExplicit=false when no timezone stored", async () => {
    const convex = mockConvex();
    convex.query.mockResolvedValue(null);

    const result = await describeUserNow(cvx(convex));
    expect(result.isExplicit).toBe(false);
    expect(isValidTimezone(result.timezone)).toBe(true);
  });
});
