import { api } from "@boop/convex";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { rpc } from "@/lib/api";

interface Toolkit {
  slug: string;
  displayName: string;
  logoUrl?: string;
  connections: Array<{
    connectionId: string;
    accountLabel?: string | null;
    accountEmail?: string | null;
    accountName?: string | null;
    alias?: string | null;
    status: string;
  }>;
}

interface TriggerType {
  slug: string;
  name: string;
  appSlug: string;
}

const TEMPLATE_LABELS: Record<string, string> = {
  email: "Email",
  message: "Message",
  issue: "Issue",
  calendar: "Calendar",
  generic: "Generic",
};

const SLUG_TO_TEMPLATE: Record<string, string> = {
  GMAIL_NEW_GMAIL_MESSAGE: "email",
  SLACK_RECEIVE_MESSAGE: "message",
  SLACK_DIRECT_MESSAGE_RECEIVED: "message",
  SLACK_CHANNEL_MESSAGE_RECEIVED: "message",
  DISCORD_MESSAGE_RECEIVED: "message",
  GITHUB_PULL_REQUEST_EVENT: "issue",
  GITHUB_ISSUES_EVENT: "issue",
  LINEAR_ISSUE_CREATED: "issue",
  LINEAR_ISSUE_UPDATED: "issue",
  GOOGLE_CALENDAR_EVENT_CHANGED: "calendar",
};

function defaultTemplate(triggerSlug: string): string {
  return SLUG_TO_TEMPLATE[triggerSlug] ?? "generic";
}

function connLabel(conn: Toolkit["connections"][number]): string {
  return (
    conn.accountLabel ??
    conn.accountEmail ??
    conn.accountName ??
    conn.alias ??
    conn.connectionId.slice(0, 12)
  );
}

export function TriggersPanel({ isDark }: { isDark: boolean }) {
  const triggerConfigs = useQuery(api.triggerConfigs.list, {});
  const upsertTrigger = useMutation(api.triggerConfigs.upsert);
  const setEnabled = useMutation(api.triggerConfigs.setEnabled);
  const setTemplate = useMutation(api.triggerConfigs.setTemplate);

  const [toolkits, setToolkits] = useState<Toolkit[] | null>(null);
  const [triggerTypes, setTriggerTypes] = useState<TriggerType[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedConn, setSelectedConn] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const muted = isDark ? "text-slate-500" : "text-slate-400";
  const cardBg = isDark ? "bg-slate-900/40 border-slate-800/60" : "bg-white border-slate-200";

  const loadedRef = useRef(false);
  if (!loadedRef.current) {
    loadedRef.current = true;
    void Promise.all([
      rpc.api.composio.toolkits.$get(),
      fetch("/api/composio/triggers/types"),
    ]).then(([toolkitRes, triggerRes]) => {
      if (toolkitRes.ok) {
        void (toolkitRes.json() as Promise<{ toolkits: Toolkit[] }>).then((data) => {
          setToolkits(
            data.toolkits.filter((t) => t.connections.some((c) => c.status === "ACTIVE")),
          );
        });
      }
      if (triggerRes.ok) {
        void (triggerRes.json() as Promise<{ triggers: TriggerType[] }>).then((data) => {
          setTriggerTypes(data.triggers);
        });
      }
    });
  }

  const configMap = new Map(
    (triggerConfigs ?? []).map((c) => [`${c.triggerSlug}:${c.connectedAccountId}`, c]),
  );

  const toolkitMap = new Map((toolkits ?? []).map((t) => [t.slug, t]));
  const triggersByApp = new Map<string, TriggerType[]>();
  for (const t of triggerTypes ?? []) {
    const arr = triggersByApp.get(t.appSlug) ?? [];
    arr.push(t);
    triggersByApp.set(t.appSlug, arr);
  }

  function toggleExpanded(slug: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function handleToggle(
    appSlug: string,
    connectionId: string,
    triggerSlug: string,
    currentlyEnabled: boolean,
  ) {
    const key = `${triggerSlug}:${connectionId}`;
    setBusy(key);
    if (currentlyEnabled) {
      const config = configMap.get(key);
      if (config?.composioTriggerId) {
        await fetch(`/api/composio/triggers/${config.composioTriggerId}/disable`, {
          method: "POST",
        });
      }
      await setEnabled({ triggerSlug, connectedAccountId: connectionId, enabled: false });
    } else {
      const res = await fetch("/api/composio/triggers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerSlug, connectedAccountId: connectionId }),
      });
      const data = (await res.json()) as { triggerId?: string };
      await upsertTrigger({
        triggerSlug,
        connectedAccountId: connectionId,
        appSlug,
        template: defaultTemplate(triggerSlug),
        enabled: true,
        ...(data.triggerId ? { composioTriggerId: data.triggerId } : {}),
      });
    }
    setBusy(null);
  }

  const loading = toolkits === null || triggerTypes === null;
  const appsWithTriggers = [...triggersByApp.keys()].filter((slug) => toolkitMap.has(slug));

  function enabledCount(appSlug: string): number {
    const toolkit = toolkitMap.get(appSlug);
    const triggers = triggersByApp.get(appSlug) ?? [];
    if (!toolkit) return 0;
    let count = 0;
    for (const conn of toolkit.connections) {
      for (const trigger of triggers) {
        const config = configMap.get(`${trigger.slug}:${conn.connectionId}`);
        if (config?.enabled) count++;
      }
    }
    return count;
  }

  return (
    <div className="flex flex-col h-full -m-5">
      <div
        className={`shrink-0 border-b px-5 py-3 flex items-center gap-3 ${
          isDark ? "border-slate-800" : "border-slate-200"
        }`}
      >
        <h2 className={`text-xs font-semibold uppercase tracking-wider ${muted}`}>
          Proactive Triggers
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto debug-scroll p-4 space-y-2">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-16 rounded-xl border ${cardBg} shimmer`} />
            ))}
          </div>
        ) : appsWithTriggers.length === 0 ? (
          <div
            className={`text-sm py-8 text-center ${isDark ? "text-slate-600" : "text-slate-400"}`}
          >
            No connected integrations with trigger support.
            <p className={`text-xs mt-2 ${muted}`}>
              Connect Gmail, Slack, GitHub, or other integrations from the Connections tab.
            </p>
          </div>
        ) : (
          appsWithTriggers.map((appSlug) => {
            const toolkit = toolkitMap.get(appSlug);
            const triggers = triggersByApp.get(appSlug) ?? [];
            if (!toolkit) return null;
            const activeConns = toolkit.connections.filter((c) => c.status === "ACTIVE");
            const isExpanded = expanded.has(appSlug);
            const active = enabledCount(appSlug);

            return (
              <div key={appSlug} className={`border rounded-xl overflow-hidden ${cardBg}`}>
                <button
                  type="button"
                  onClick={() => toggleExpanded(appSlug)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left ${
                    isDark ? "hover:bg-slate-800/40" : "hover:bg-slate-50"
                  }`}
                >
                  {toolkit.logoUrl && (
                    <img src={toolkit.logoUrl} alt="" className="w-5 h-5 rounded" />
                  )}
                  <span
                    className={`text-sm font-medium flex-1 ${isDark ? "text-slate-200" : "text-slate-800"}`}
                  >
                    {toolkit.displayName}
                  </span>
                  {active > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold">
                      {active} active
                    </span>
                  )}
                  <span className={`text-[10px] ${muted}`}>
                    {triggers.length} trigger{triggers.length !== 1 ? "s" : ""}
                  </span>
                  <span
                    className={`text-xs ${muted} transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    ▶
                  </span>
                </button>

                {isExpanded &&
                  (() => {
                    const first = activeConns[0];
                    if (!first) return null;
                    const activeConn = selectedConn[appSlug]
                      ? (activeConns.find((c) => c.connectionId === selectedConn[appSlug]) ?? first)
                      : first;

                    return (
                      <div
                        className={`border-t ${isDark ? "border-slate-800/60" : "border-slate-200"}`}
                      >
                        {activeConns.length > 1 && (
                          <div
                            className={`flex border-b ${isDark ? "border-slate-800/60" : "border-slate-200"}`}
                          >
                            {activeConns.map((conn) => (
                              <button
                                type="button"
                                key={conn.connectionId}
                                onClick={() =>
                                  setSelectedConn((prev) => ({
                                    ...prev,
                                    [appSlug]: conn.connectionId,
                                  }))
                                }
                                className={`px-3 py-1.5 text-[10px] transition-colors ${
                                  conn.connectionId === activeConn.connectionId
                                    ? isDark
                                      ? "text-sky-400 border-b-2 border-sky-400"
                                      : "text-sky-600 border-b-2 border-sky-600"
                                    : `${muted} hover:${isDark ? "text-slate-300" : "text-slate-600"}`
                                }`}
                              >
                                {connLabel(conn)}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="px-4 py-2 space-y-1">
                          {triggers.map((trigger) => {
                            const key = `${trigger.slug}:${activeConn.connectionId}`;
                            const config = configMap.get(key);
                            const enabled = config?.enabled ?? false;
                            const isBusy = busy === key;

                            return (
                              <div key={key} className="flex items-center gap-2 py-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleToggle(
                                      appSlug,
                                      activeConn.connectionId,
                                      trigger.slug,
                                      enabled,
                                    )
                                  }
                                  disabled={isBusy}
                                  role="switch"
                                  aria-checked={enabled}
                                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0 ${
                                    isBusy ? "opacity-50" : ""
                                  } ${enabled ? "bg-emerald-500" : isDark ? "bg-slate-700" : "bg-slate-300"}`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                                      enabled ? "translate-x-3" : "translate-x-0.5"
                                    }`}
                                  />
                                </button>
                                <span
                                  className={`text-xs flex-1 ${isDark ? "text-slate-300" : "text-slate-700"}`}
                                >
                                  {trigger.name}
                                </span>
                                {enabled && (
                                  <select
                                    value={config?.template ?? defaultTemplate(trigger.slug)}
                                    onChange={(e) =>
                                      setTemplate({
                                        triggerSlug: trigger.slug,
                                        connectedAccountId: activeConn.connectionId,
                                        template: e.target.value,
                                      })
                                    }
                                    className={`text-[9px] mono px-1 py-0.5 rounded border ${
                                      isDark
                                        ? "bg-slate-800 border-slate-700 text-slate-400"
                                        : "bg-slate-50 border-slate-200 text-slate-500"
                                    }`}
                                  >
                                    {Object.entries(TEMPLATE_LABELS).map(([val, label]) => (
                                      <option key={val} value={val}>
                                        {label}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
