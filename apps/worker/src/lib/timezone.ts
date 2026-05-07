import { api } from "@boop/convex";
import type { ConvexHttpClient } from "convex/browser";

const VALID_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

const ALIASES: Record<string, string> = {
  eastern: "America/New_York",
  "eastern time": "America/New_York",
  et: "America/New_York",
  est: "America/New_York",
  edt: "America/New_York",
  central: "America/Chicago",
  "central time": "America/Chicago",
  ct: "America/Chicago",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  mountain: "America/Denver",
  "mountain time": "America/Denver",
  mt: "America/Denver",
  mst: "America/Denver",
  mdt: "America/Denver",
  pacific: "America/Los_Angeles",
  "pacific time": "America/Los_Angeles",
  pt: "America/Los_Angeles",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  alaska: "America/Anchorage",
  hawaii: "Pacific/Honolulu",
  dallas: "America/Chicago",
  chicago: "America/Chicago",
  houston: "America/Chicago",
  austin: "America/Chicago",
  "new york": "America/New_York",
  nyc: "America/New_York",
  boston: "America/New_York",
  miami: "America/New_York",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  "los angeles": "America/Los_Angeles",
  la: "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  sf: "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  london: "Europe/London",
  uk: "Europe/London",
  gmt: "UTC",
  bst: "Europe/London",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  cet: "Europe/Berlin",
  amsterdam: "Europe/Amsterdam",
  tokyo: "Asia/Tokyo",
  jst: "Asia/Tokyo",
  india: "Asia/Kolkata",
  ist: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  utc: "UTC",
};

export function isValidTimezone(tz: string): boolean {
  return VALID_TIMEZONES.has(tz) || tz === "UTC";
}

export function resolveTimezoneInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isValidTimezone(trimmed)) return trimmed;
  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return null;
}

export function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function envFallback(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export async function getUserTimezone(convex: ConvexHttpClient): Promise<string> {
  const stored = await convex.query(api.settings.get, { key: "user_timezone" });
  return stored && isValidTimezone(stored) ? stored : envFallback();
}

export async function describeUserNow(convex: ConvexHttpClient): Promise<{
  timezone: string;
  isExplicit: boolean;
  now: string;
  isoDate: string;
  weekday: string;
  hourMinute: string;
}> {
  const stored = await convex.query(api.settings.get, { key: "user_timezone" });
  const isExplicit = stored !== null && isValidTimezone(stored);
  const timezone = isExplicit ? stored : envFallback();
  const d = new Date();
  const fmt = (opts: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(d);
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return {
    timezone,
    isExplicit,
    now: formatLocalTime(d, timezone),
    isoDate,
    weekday: fmt({ weekday: "long" }),
    hourMinute: fmt({ hour: "numeric", minute: "2-digit" }),
  };
}
