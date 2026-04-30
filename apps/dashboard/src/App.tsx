import { api } from "@boop/convex";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Activity01Icon,
  AiBrain02Icon,
  ArrowShrink02Icon,
  DashboardSquare01Icon,
  Link04Icon,
  MachineRobotIcon,
  WorkflowCircle03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { AgentsPanel } from "@/components/AgentsPanel";
import { AutomationsPanel } from "@/components/AutomationsPanel";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { ConsolidationPanel } from "@/components/ConsolidationPanel";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EventsPanel } from "@/components/EventsPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { useSocket } from "@/lib/useSocket";

type View =
  | "dashboard"
  | "agents"
  | "automations"
  | "memory"
  | "events"
  | "consolidation"
  | "connections";

type Theme = "dark" | "light";

const NAV_ICONS: Record<View, typeof DashboardSquare01Icon> = {
  dashboard: DashboardSquare01Icon,
  agents: MachineRobotIcon,
  automations: WorkflowCircle03Icon,
  memory: AiBrain02Icon,
  events: Activity01Icon,
  consolidation: ArrowShrink02Icon,
  connections: Link04Icon,
};

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "agents", label: "Agents" },
  { id: "automations", label: "Automations" },
  { id: "memory", label: "Memory" },
  { id: "events", label: "Events" },
  { id: "consolidation", label: "Consolidation" },
  { id: "connections", label: "Connections" },
];

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("boop-debug-theme");
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function LoginScreen() {
  const { signIn } = useAuthActions();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSendCode = async () => {
    setError("");
    setLoading(true);
    try {
      await signIn("sendblue-otp", { phone });
      setStep("code");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError("");
    setLoading(true);
    try {
      await signIn("sendblue-otp", { phone, code });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-slate-950">
      <div className="w-80 space-y-6 text-center">
        <img src="/lunagotchi.png" alt="Boop" className="w-16 h-16 rounded-2xl mx-auto" />
        <h1 className="text-xl font-bold text-slate-200">Boop Dashboard</h1>
        {step === "phone" ? (
          <div className="space-y-3">
            <input
              type="tel"
              placeholder="+1XXXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={loading || !phone}
              className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send Code via iMessage"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">Code sent to {phone}</p>
            <input
              type="text"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-500 text-sm text-center tracking-[0.3em] font-mono text-lg"
              onKeyDown={(e) => e.key === "Enter" && handleVerify()}
              // biome-ignore lint/a11y/noAutofocus: OTP code input should auto-focus after phone step
              autoFocus
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={loading || code.length !== 6}
              className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setCode("");
                setError("");
              }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Use different number
            </button>
          </div>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

export function App() {
  return (
    <>
      <AuthLoading>
        <div className="h-full flex items-center justify-center bg-slate-950">
          <div className="text-slate-500 text-sm">Loading…</div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <LoginScreen />
      </Unauthenticated>
      <Authenticated>
        <Dashboard />
      </Authenticated>
    </>
  );
}

function Dashboard() {
  const { signOut } = useAuthActions();
  const [view, setView] = useState<View>("dashboard");
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const { connected } = useSocket();

  const counts = useQuery(api.memoryRecords.countsByTier, {});
  const agents = useQuery(api.agents.list, {});
  const activeAgentCount = (agents ?? []).filter(
    (a) => a.status === "running" || a.status === "spawned",
  ).length;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    document.body.style.background = theme === "dark" ? "#020617" : "#f8fafc";
    document.body.style.color = theme === "dark" ? "#e2e8f0" : "#1e293b";
    localStorage.setItem("boop-debug-theme", theme);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <div
      className={`h-full flex flex-col ${isDark ? "bg-slate-950 text-slate-200" : "bg-slate-50 text-slate-800"}`}
    >
      {/* Top bar */}
      <header
        className={`flex items-center justify-between px-5 py-2.5 border-b shrink-0 ${
          isDark ? "border-slate-800 bg-slate-950/80" : "border-slate-200 bg-white/80"
        } backdrop-blur-sm`}
      >
        <div className="flex items-center gap-3">
          <img src="/lunagotchi.png" alt="Boop" className="w-7 h-7 rounded-lg" />
          <h1
            className={`text-sm font-bold tracking-wide uppercase ${
              isDark ? "text-slate-400" : "text-slate-500"
            }`}
          >
            Boop Debug
          </h1>
          <div
            className={`flex items-center gap-1.5 text-xs ${
              connected ? "text-emerald-500" : "text-rose-400"
            }`}
          >
            <span className="relative flex h-2 w-2">
              {connected && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 pulse-ring" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  connected ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
            </span>
            {connected ? "Live" : "Disconnected"}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {counts && (
            <div className="flex items-center gap-4">
              <MetricPill label="Short" value={counts.short} isDark={isDark} />
              <MetricPill label="Long" value={counts.long} isDark={isDark} />
              <MetricPill
                label="Perm"
                value={counts.permanent}
                isDark={isDark}
                color={isDark ? "text-amber-400" : "text-amber-600"}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className={`p-1.5 rounded-lg transition-colors ${
              isDark
                ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-200"
            }`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {isDark ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <title>Switch to light mode</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <title>Switch to dark mode</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
              isDark
                ? "text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                : "text-slate-400 hover:text-rose-500 hover:bg-slate-100"
            }`}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav
          className={`w-[168px] shrink-0 border-r flex flex-col py-1.5 ${
            isDark ? "border-slate-800 bg-slate-950/50" : "border-slate-200 bg-white/50"
          }`}
        >
          {NAV.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setView(item.id)}
              className={`flex items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-all duration-150 ${
                view === item.id
                  ? isDark
                    ? "bg-slate-800/70 text-white font-medium"
                    : "bg-slate-100 text-slate-900 font-medium"
                  : isDark
                    ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800/30"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-100/60"
              }`}
            >
              <HugeiconsIcon icon={NAV_ICONS[item.id]} size={18} className="shrink-0" />
              {item.label}
              {item.id === "agents" && activeAgentCount > 0 && (
                <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-sky-500 text-white">
                  {activeAgentCount}
                </span>
              )}
            </button>
          ))}

          <div className="mt-auto px-4 py-3 flex items-center gap-2">
            <img src="/appicon.png" alt="" className="w-5 h-5 rounded" />
            <span className={`text-[10px] ${isDark ? "text-slate-600" : "text-slate-400"} mono`}>
              v0.1
            </span>
          </div>
        </nav>

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-hidden debug-scroll">
          <div className="h-full overflow-auto debug-scroll p-5 fade-in">
            {view === "dashboard" && <DashboardPanel isDark={isDark} />}
            {view === "agents" && <AgentsPanel isDark={isDark} />}
            {view === "automations" && <AutomationsPanel isDark={isDark} />}
            {view === "memory" && <MemoryPanel isDark={isDark} />}
            {view === "events" && <EventsPanel isDark={isDark} />}
            {view === "consolidation" && <ConsolidationPanel isDark={isDark} />}
            {view === "connections" && <ConnectionsPanel isDark={isDark} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function MetricPill({
  label,
  value,
  isDark,
  color,
}: {
  label: string;
  value: number;
  isDark: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={isDark ? "text-slate-500" : "text-slate-400"}>{label}</span>
      <span
        className={`mono font-semibold ${color ?? (isDark ? "text-slate-300" : "text-slate-700")}`}
      >
        {value}
      </span>
    </div>
  );
}
