import { tool } from "ai";
import { z } from "zod";

export function createDateTimeTool() {
  return {
    get_current_datetime: tool({
      description:
        "Get the current date and time. Optionally specify a timezone (e.g. 'America/New_York', 'Asia/Tokyo', 'Europe/London'). Returns both the local time in that timezone and UTC.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe("IANA timezone name (e.g. 'America/New_York'). Defaults to UTC."),
      }),
      execute: async (args) => {
        const now = new Date();
        const tz = args.timezone ?? "UTC";
        const local = now.toLocaleString("en-US", {
          timeZone: tz,
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        });
        const utc = now.toISOString();
        return `${local} (UTC: ${utc})`;
      },
    }),
  };
}
