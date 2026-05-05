import { api } from "@boop/convex";
import type { BroadcastFn } from "@boop/shared/events";
import type { ConvexHttpClient } from "convex/browser";
import { getServerByName } from "partyserver";
import { z } from "zod";
import { sendImessage } from "@/lib/sendblue";
import { randomId } from "@/memory/types";
import { nextRunFor } from "@/tools/automations";

interface RunAutomationDeps {
  automationId: string;
  userTimezone: string;
  env: Env;
  convex: ConvexHttpClient;
  broadcast: BroadcastFn;
  schedule: (automationId: string, runAt: Date) => Promise<string>;
}

export async function runAutomation(deps: RunAutomationDeps): Promise<string | null> {
  const { automationId, env, convex, broadcast, schedule } = deps;

  const all = await convex.query(api.automations.list, { enabledOnly: false });
  const a = all.find((auto: { automationId: string }) => auto.automationId === automationId);
  if (!a?.enabled) return null;

  const runId = randomId("run");
  await convex.mutation(api.automations.createRun, {
    runId,
    automationId,
  });
  broadcast("automation_started", { automationId, runId, name: a.name });

  try {
    const execAgentId = randomId("agent");
    const task = `AUTOMATION "${a.name}": ${a.task}`;
    const name = `auto:${a.name}`;

    await convex.mutation(api.agents.create, {
      agentId: execAgentId,
      ...(a.conversationId ? { conversationId: a.conversationId } : {}),
      name,
      task,
      mcpServers: a.integrations,
    });

    const stub = await getServerByName(env.EXEC_AGENT, execAgentId);
    const res = await stub.fetch("http://agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        integrations: a.integrations,
        conversationId: a.conversationId,
        name,
        agentId: execAgentId,
      }),
    });

    const execResultSchema = z.object({
      agentId: z.string(),
      result: z.string(),
      status: z.enum(["completed", "failed"]),
    });
    const result = execResultSchema.parse(await res.json());

    await convex.mutation(api.automations.updateRun, {
      runId,
      status: result.status === "completed" ? "completed" : "failed",
      result: result.result,
      agentId: result.agentId,
    });

    if (a.notifyConversationId && result.result) {
      if (a.notifyConversationId.startsWith("sms:")) {
        const number = a.notifyConversationId.slice(4);
        const preamble = `[${a.name}]\n\n`;
        await sendImessage(env, number, preamble + result.result);
      }
      await convex.mutation(api.messages.send, {
        conversationId: a.notifyConversationId,
        role: "assistant",
        content: `[${a.name}]\n\n${result.result}`,
      });
    }

    broadcast("automation_completed", { automationId, runId });
  } catch (err) {
    await convex.mutation(api.automations.updateRun, {
      runId,
      status: "failed",
      error: String(err),
    });
    broadcast("automation_failed", { automationId, runId, error: String(err) });
  }

  const tz = a.timezone ?? deps.userTimezone;
  const next = nextRunFor(a.schedule, tz);
  await convex.mutation(api.automations.markRan, {
    automationId,
    lastRunAt: Date.now(),
    ...(next ? { nextRunAt: next } : {}),
  });

  if (next) {
    const nextScheduleId = await schedule(automationId, new Date(next));
    return nextScheduleId;
  }
  return null;
}
