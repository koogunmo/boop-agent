import { api } from "@boop/convex";
import { tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { Cron } from "croner";
import { z } from "zod";
import { randomId } from "@/memory/types";

interface AutomationToolDeps {
  convex: ConvexHttpClient;
  conversationId: string;
  schedule?: (automationId: string, runAt: Date) => Promise<string>;
  cancelSchedule?: (scheduleId: string) => Promise<void>;
}

function validateSchedule(schedule: string): { valid: boolean; error?: string } {
  try {
    new Cron(schedule, { paused: true }).nextRun();
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

function nextRunFor(schedule: string): number | null {
  try {
    const c = new Cron(schedule, { paused: true });
    const next = c.nextRun();
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

export function createAutomationTools(deps: AutomationToolDeps) {
  const { convex, conversationId } = deps;

  return {
    create_automation: tool({
      description: `Schedule a recurring task. The agent will run the task on the schedule and reply with the result.

Cron expressions (5 fields: min hour day-of-month month day-of-week). Examples:
  "0 8 * * *"      — every day at 8am
  "*/15 * * * *"   — every 15 minutes
  "0 9 * * 1-5"    — weekdays at 9am
  "0 18 * * 0"     — Sundays at 6pm

Use this for anything the user says "every [time]" or "remind me" about.`,
      inputSchema: z.object({
        name: z.string().describe("Short label, e.g. 'morning email digest'."),
        schedule: z.string().describe("Cron expression (5 fields)."),
        task: z
          .string()
          .describe("Specific task for the sub-agent — what to look up, draft, or summarize."),
        integrations: z
          .array(z.string())
          .optional()
          .default([])
          .describe(
            "Integration names the sub-agent needs for this task. Pass [] for reminder-only automations that don't need external tools.",
          ),
        notify: z
          .boolean()
          .optional()
          .default(true)
          .describe("If true, send the result to this conversation when it runs."),
      }),
      execute: async (args) => {
        const validation = validateSchedule(args.schedule);
        if (!validation.valid) {
          return `Invalid cron expression: ${validation.error}`;
        }

        const automationId = randomId("auto");
        const nextRunAt = nextRunFor(args.schedule);

        await convex.mutation(api.automations.create, {
          automationId,
          name: args.name,
          task: args.task,
          integrations: args.integrations,
          schedule: args.schedule,
          conversationId,
          ...(args.notify ? { notifyConversationId: conversationId } : {}),
          ...(nextRunAt ? { nextRunAt } : {}),
        });

        if (nextRunAt && deps.schedule) {
          const scheduleId = await deps.schedule(automationId, new Date(nextRunAt));
          await convex.mutation(api.automations.setScheduleId, {
            automationId,
            scheduleId,
          });
        }

        const nextStr = nextRunAt ? new Date(nextRunAt).toLocaleString() : "unknown";
        return `Created automation ${automationId} "${args.name}" — schedule: ${args.schedule}, next run: ${nextStr}.`;
      },
    }),

    list_automations: tool({
      description: "List all automations for this conversation.",
      inputSchema: z.object({
        enabledOnly: z.boolean().optional().default(false),
      }),
      execute: async (args) => {
        const all = await convex.query(api.automations.list, {
          enabledOnly: args.enabledOnly,
        });
        const mine = all.filter(
          (a: { conversationId?: string }) => a.conversationId === conversationId,
        );
        if (mine.length === 0) {
          return "No automations.";
        }
        return mine
          .map(
            (a: {
              automationId: string;
              enabled: boolean;
              name: string;
              schedule: string;
              task: string;
            }) =>
              `• [${a.automationId}] ${a.enabled ? "●" : "○"} "${a.name}" — ${a.schedule} — ${a.task}`,
          )
          .join("\n");
      },
    }),

    toggle_automation: tool({
      description: "Enable or disable an automation by id.",
      inputSchema: z.object({
        automationId: z.string(),
        enabled: z.boolean(),
      }),
      execute: async (args) => {
        const all = await convex.query(api.automations.list, { enabledOnly: false });
        const auto = all.find(
          (a: { automationId: string }) => a.automationId === args.automationId,
        );
        if (!auto) return "Not found.";

        const id = await convex.mutation(api.automations.setEnabled, args);
        if (!id) return "Not found.";

        if (!args.enabled && auto.scheduleId && deps.cancelSchedule) {
          await deps.cancelSchedule(auto.scheduleId);
          await convex.mutation(api.automations.setScheduleId, {
            automationId: args.automationId,
          });
        } else if (args.enabled && auto.nextRunAt && deps.schedule) {
          const scheduleId = await deps.schedule(args.automationId, new Date(auto.nextRunAt));
          await convex.mutation(api.automations.setScheduleId, {
            automationId: args.automationId,
            scheduleId,
          });
        }

        return `Set ${args.automationId} enabled=${String(args.enabled)}.`;
      },
    }),

    delete_automation: tool({
      description: "Permanently remove an automation.",
      inputSchema: z.object({
        automationId: z.string(),
      }),
      execute: async (args) => {
        const all = await convex.query(api.automations.list, { enabledOnly: false });
        const auto = all.find(
          (a: { automationId: string }) => a.automationId === args.automationId,
        );

        if (auto?.scheduleId && deps.cancelSchedule) {
          await deps.cancelSchedule(auto.scheduleId);
        }

        const id = await convex.mutation(api.automations.remove, args);
        return id ? `Deleted ${args.automationId}.` : "Not found.";
      },
    }),
  };
}
