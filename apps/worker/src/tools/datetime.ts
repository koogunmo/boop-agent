import { tool } from "ai";
import { z } from "zod";
import { resolveTimezoneInput } from "@/lib/timezone";

export function createDateTimeTool() {
  return {
    get_current_datetime: tool({
      description:
        "Get the current date and time. Optionally specify a timezone by IANA ID or alias (e.g. 'eastern', 'tokyo', 'America/Chicago'). Returns both the local time in that timezone and UTC.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            "Timezone — IANA ID or alias like 'eastern', 'pacific', 'tokyo'. Defaults to UTC.",
          ),
      }),
      execute: async (args) => {
        const now = new Date();
        const resolved = args.timezone ? resolveTimezoneInput(args.timezone) : null;
        const tz = resolved ?? "UTC";
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
