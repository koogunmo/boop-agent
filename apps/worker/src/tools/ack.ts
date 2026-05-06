import { api } from "@boop/convex";
import type { BroadcastFn } from "@boop/shared/events";
import { tool } from "ai";
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { sendImessage } from "@/lib/sendblue";
import type { MessageKind } from "@/proactive/types";

interface AckToolDeps {
  convex: ConvexHttpClient;
  env: Env;
  conversationId: string;
  turnId: string;
  broadcast: BroadcastFn;
  kind: MessageKind;
}

export function createAckTools(deps: AckToolDeps) {
  const { convex, env, conversationId, turnId, broadcast, kind } = deps;

  return {
    send_ack: tool({
      description:
        'Send a short acknowledgment message to the user IMMEDIATELY, before a slow operation. Use this BEFORE spawn_agent so the user knows you heard them and are working on it. Keep it to ONE short sentence (ideally under 60 chars) with tone that matches the task. Examples: "On it — one sec", "Looking into it…", "Drafting now, hold tight.", "Let me check your calendar."',
      inputSchema: z.object({
        message: z.string().describe("1 short sentence ack. No markdown. Emojis OK."),
      }),
      execute: async (args) => {
        const text = args.message.trim();
        if (!text) {
          return "Empty ack skipped.";
        }

        if (kind === "proactive") {
          return "Ack skipped (proactive turn).";
        }

        if (conversationId.startsWith("sms:")) {
          const number = conversationId.slice(4);
          await sendImessage(env, number, text);
        }

        await convex.mutation(api.messages.send, {
          conversationId,
          role: "assistant",
          content: text,
          turnId,
        });

        broadcast("assistant_ack", { conversationId, content: text });
        console.log(`[ack] → ${text}`);

        return "Ack sent to user.";
      },
    }),
  };
}
