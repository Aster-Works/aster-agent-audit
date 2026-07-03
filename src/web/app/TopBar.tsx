import { useLocation } from "react-router-dom";
import { ChevronDown, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useAppStore, type AgentFilter } from "./store";
import { PAGE_TITLES } from "./nav";
import { repoOptions } from "../data/filter";
import { AGENT_LABELS } from "@core/types";
import { StatusDot } from "../components/ui";

function currentKey(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "overview";
  return seg;
}

export function TopBar() {
  const location = useLocation();
  const key = currentKey(location.pathname);
  const page = PAGE_TITLES[key] ?? PAGE_TITLES.overview;

  const { repo, setRepo, agentFilter, setAgentFilter, dateRange, setDateRange, search, setSearch } =
    useAppStore();
  const status = useAppStore((s) => s.dataset.status);
  const repos = repoOptions(useAppStore((s) => s.dataset));
  const source = useAppStore((s) => s.source);
  const liveState = useAppStore((s) => s.liveState);
  const setSource = useAppStore((s) => s.setSource);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4">
      <div className="min-w-0">
        <h1 className="aac-truncate text-[15px] font-semibold tracking-tight text-ink">
          {page.title}
        </h1>
        <p className="aac-truncate text-[11px] text-ink-3">{page.subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative hidden lg:block">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions, files, commands…"
            className="h-8 w-56 rounded-md border border-line bg-bg pl-7 pr-2 text-[12px] text-ink placeholder:text-ink-3 focus:border-line focus:outline-none focus:ring-1 focus:ring-claude/40"
          />
        </div>

        <Select
          value={repo}
          onChange={setRepo}
          options={[{ value: "all", label: "All repos" }, ...repos.map((r) => ({ value: r, label: r }))]}
        />
        <Select
          value={dateRange}
          onChange={setDateRange}
          options={[
            { value: "today", label: "Today" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
          ]}
        />
        <Select
          value={agentFilter}
          onChange={(v) => setAgentFilter(v as AgentFilter)}
          options={[
            { value: "all", label: "All agents" },
            { value: "claude-code", label: AGENT_LABELS["claude-code"] },
            { value: "codex", label: AGENT_LABELS.codex },
          ]}
        />

        <button
          type="button"
          onClick={() => setSource(source === "live" ? "demo" : "live")}
          title={
            source === "live"
              ? "Connected to local collector — click for demo data"
              : "Showing demo data — click to connect to the local collector"
          }
          className="ml-1 flex items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1.5 text-[11px] transition-colors hover:border-ink-3"
        >
          <StatusDot
            color={
              liveState === "loading"
                ? "var(--color-info)"
                : source === "live" && liveState === "ready"
                ? "var(--color-safe)"
                : liveState === "error"
                ? "var(--color-danger)"
                : "var(--color-warn)"
            }
            pulse={source === "live" && liveState === "ready"}
          />
          <span className="text-ink-2">
            {liveState === "loading"
              ? "Connecting…"
              : source === "live" && liveState === "ready"
              ? "Live"
              : source === "live" && liveState === "empty"
              ? "Live (no data)"
              : "Demo"}
          </span>
          <span className="hidden font-mono text-ink-3 xl:inline">127.0.0.1:{status.port}</span>
        </button>
      </div>
    </header>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: ReactNode }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer appearance-none rounded-md border border-line bg-bg pl-2.5 pr-7 text-[12px] text-ink-2 hover:text-ink focus:border-line focus:outline-none focus:ring-1 focus:ring-claude/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface text-ink">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3"
      />
    </div>
  );
}
