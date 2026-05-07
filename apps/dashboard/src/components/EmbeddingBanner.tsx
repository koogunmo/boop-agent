import { useCallback, useEffect, useState } from "react";
import { type SocketEvent, useSocket } from "@/lib/useSocket";

interface Status {
  provider: string;
  total: number;
  withEmbedding: number;
  withoutEmbedding: number;
  truncated: boolean;
  running: boolean;
}

export function EmbeddingBanner({ isDark }: { isDark: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ embedded: number; failed: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/trigger/embedding-status");
    if (!r.ok) {
      setErrorMsg(`status ${r.status}`);
      return;
    }
    const data = (await r.json()) as Status;
    setStatus(data);
    setBusy(data.running);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [busy, refresh]);

  const handleEvent = useCallback(
    (e: SocketEvent) => {
      if (e.event === "memory.reembed.progress") {
        const d = e.data as { embedded: number; failed: number };
        setProgress({ embedded: d.embedded, failed: d.failed });
      } else if (e.event === "memory.reembed.done") {
        const d = e.data as { embedded: number; failed: number };
        setProgress({ embedded: d.embedded, failed: d.failed });
        setBusy(false);
        void refresh();
      }
    },
    [refresh],
  );

  useSocket(handleEvent);

  const startReembed = useCallback(async () => {
    setBusy(true);
    setErrorMsg(null);
    setProgress({ embedded: 0, failed: 0 });
    const r = await fetch("/api/trigger/reembed", { method: "POST" });
    const data = (await r.json()) as { started?: boolean; error?: string };
    if (!r.ok || !data.started) {
      setErrorMsg(data.error ?? `Re-embed failed (${r.status})`);
      setBusy(false);
    }
  }, []);

  if (!status) return null;

  const isStale = status.withoutEmbedding > 0;
  if (!isStale && !busy && !errorMsg) return null;

  const bg =
    isStale && !busy
      ? isDark
        ? "bg-amber-500/10 border-amber-500/30"
        : "bg-amber-50 border-amber-200"
      : isDark
        ? "bg-slate-800/40 border-slate-700"
        : "bg-slate-100 border-slate-200";
  const heading = isDark ? "text-slate-100" : "text-slate-900";
  const body = isDark ? "text-slate-400" : "text-slate-600";

  let title = "";
  let detail = "";
  if (busy) {
    title = "Re-embedding memories…";
    detail = progress
      ? `Embedded ${progress.embedded}${progress.failed ? ` · ${progress.failed} failed` : ""}.`
      : "Starting…";
  } else if (isStale) {
    title = `${status.withoutEmbedding} of ${status.total} memories have no embedding`;
    detail = `Semantic recall can't find them — falls back to literal substring matching. Re-embed via ${status.provider} to fix.`;
  } else if (errorMsg) {
    title = "Re-embed error";
    detail = errorMsg;
  }

  return (
    <div className={`mx-5 my-3 rounded-lg border px-4 py-3 ${bg}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${heading}`}>{title}</div>
          <div className={`text-xs mt-1 ${body}`}>{detail}</div>
        </div>
        {!busy && isStale && (
          <button
            type="button"
            onClick={startReembed}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-md border transition ${
              isDark
                ? "border-amber-500/40 hover:bg-amber-500/20 text-amber-200"
                : "border-amber-300 hover:bg-amber-100 text-amber-800"
            }`}
          >
            Re-embed now
          </button>
        )}
        {busy && (
          <div
            className={`shrink-0 text-xs px-3 py-1.5 rounded-md mono ${
              isDark ? "text-amber-300" : "text-amber-700"
            }`}
          >
            {progress?.embedded ?? 0} /{" "}
            {Math.max(status.withoutEmbedding, (progress?.embedded ?? 0) + (progress?.failed ?? 0))}
          </div>
        )}
      </div>
    </div>
  );
}
