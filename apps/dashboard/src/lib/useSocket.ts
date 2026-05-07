import type { EventData, EventName } from "@boop/shared/events";
import { useAgent } from "agents/react";
import { useCallback, useRef } from "react";

export interface SocketEvent {
  event: EventName;
  data: EventData<EventName>;
  at: number;
}

function isSocketEvent(v: unknown): v is SocketEvent {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.event === "string" && typeof obj.at === "number" && "data" in obj;
}

export function useSocket(onEvent?: (e: SocketEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const handleMessage = useCallback((evt: MessageEvent) => {
    if (typeof evt.data !== "string") return;
    try {
      const parsed: unknown = JSON.parse(evt.data);
      if (isSocketEvent(parsed)) {
        handlerRef.current?.(parsed);
      }
    } catch {
      /* ignore framework messages and non-JSON */
    }
  }, []);

  const socket = useAgent({
    agent: "boop-interaction-agent",
    name: "default",
    prefix: "api/agents",
    onMessage: handleMessage,
  });

  const connected = socket.readyState === WebSocket.OPEN;
  return { connected };
}
