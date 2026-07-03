import {
  Boxes,
  Coins,
  TerminalSquare,
  ShieldAlert,
  Cpu,
  Recycle,
  Timer,
  AlertTriangle,
  FileType2,
  CalendarDays,
  Activity,
} from "lucide-react";
import { useDataset } from "../data/useDataset";
import { buildInsights, type Insights as InsightsData } from "../lib/insights";
import { Panel, EmptyState } from "../components/ui";
import { Donut } from "../components/charts";
import { AGENT_COLOR_VAR, formatNumber, formatPct, formatTokens, formatUsd } from "../lib/format";
import { useT } from "../lib/i18n";

/** Human-readable duration: 120ms · 1.8s · 2m 05s. */
function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

const TOKEN_COLORS = {
  uncachedInput: "var(--color-claude)",
  cacheRead: "var(--color-codex)",
  output: "var(--color-warn)",
  cacheWrite: "var(--color-ink-3)",
} as const;

export function Insights() {
  const t = useT();
  const dataset = useDataset();
  const ins = buildInsights(dataset);

  return (
    <div className="space-y-4 p-4">
      {/* Row 1: token composition + cache hit rate */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title={t("Token Composition")}
          icon={Boxes}
          subtitle={t("Where your tokens actually go")}
          className="xl:col-span-2"
        >
          <TokenComposition ins={ins} />
        </Panel>
        <Panel title={t("Cache Hit Rate")} icon={Recycle} iconColor="var(--color-safe)" subtitle={t("Cheap cache reads vs fresh input")}>
          <CacheHitRate ins={ins} />
        </Panel>
      </div>

      {/* Row 2: cost efficiency */}
      <Panel title={t("Cost Efficiency")} icon={Coins} subtitle={t("Estimated spend per unit of work")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t("per commit")} value={money(ins.efficiency.costPerCommit)} />
          <StatTile label={t("per file changed")} value={money(ins.efficiency.costPerFile)} />
          <StatTile label={t("per session")} value={money(ins.efficiency.costPerSession)} />
          <StatTile
            label={t("tokens / tool call")}
            value={ins.efficiency.tokensPerToolCall == null ? "—" : formatTokens(Math.round(ins.efficiency.tokensPerToolCall))}
          />
        </div>
      </Panel>

      {/* Row 3: tool usage + risk interception + model cost */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={t("Tool Usage")} icon={TerminalSquare} subtitle={t("What your agents actually do")}>
          {ins.toolUsage.length ? <BarList items={ins.toolUsage.map((t) => ({ label: t.name, value: t.count }))} color="var(--color-claude)" /> : <EmptyState icon={TerminalSquare} title={t("No tool calls yet")} />}
        </Panel>

        <Panel title={t("Risk Interception")} icon={ShieldAlert} iconColor="var(--color-warn)" subtitle={t("Flagged share of tool calls")}>
          <RiskInterception ins={ins} />
        </Panel>

        <Panel title={t("Cost by Model")} icon={Cpu} subtitle={t("Estimated spend per model")}>
          {ins.models.length ? <ModelCost ins={ins} /> : <EmptyState icon={Cpu} title={t("No model data yet")} />}
        </Panel>
      </div>

      {/* Row 4: latency + command failures */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title={t("Tool Latency")}
          icon={Timer}
          iconColor="var(--color-codex)"
          subtitle={t("Where your agents actually spend time")}
          className="xl:col-span-2"
        >
          <ToolLatency ins={ins} />
        </Panel>
        <Panel title={t("Command Failures")} icon={AlertTriangle} iconColor="var(--color-warn)" subtitle={t("Share of commands that exit non-zero")}>
          <CommandFailures ins={ins} />
        </Panel>
      </div>

      {/* Row 5: file types + session outcomes */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={t("File Types")} icon={FileType2} subtitle={t("What your agents edit, by extension")} className="xl:col-span-2">
          {ins.fileTypes.length ? (
            <BarList items={ins.fileTypes.map((f) => ({ label: f.ext, value: f.count }))} color="var(--color-safe)" />
          ) : (
            <EmptyState icon={FileType2} title={t("No file changes yet")} />
          )}
        </Panel>
        <Panel title={t("Session Outcomes")} icon={Activity} subtitle={t("How sessions end")} iconColor="var(--color-safe)">
          <Outcomes ins={ins} />
        </Panel>
      </div>

      {/* Row 6: daily trend */}
      <Panel title={t("Daily Trend")} icon={CalendarDays} subtitle={t("Estimated cost & tokens per day (last 30 days)")}>
        {ins.daily.length ? <DailyTrend ins={ins} /> : <EmptyState icon={CalendarDays} title={t("No dated activity yet")} />}
      </Panel>
    </div>
  );
}

function money(v: number | null): string {
  return v == null ? "—" : formatUsd(v);
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="aac-card-2 flex flex-col gap-1 p-3">
      <span className="text-[11px] font-medium text-ink-3">{label}</span>
      <span className="aac-tnum text-[22px] font-semibold leading-none text-ink">{value}</span>
    </div>
  );
}

function TokenComposition({ ins }: { ins: InsightsData }) {
  const t = useT();
  const { tokens } = ins;
  if (!tokens.hasBreakdown || tokens.total === 0) {
    return (
      <EmptyState icon={Boxes} title={t("No token breakdown yet")}>
        {t("Run Claude Code or Codex — token composition is read from the transcript.")}
      </EmptyState>
    );
  }
  const parts = [
    { name: t("Uncached input"), value: tokens.uncachedInput, color: TOKEN_COLORS.uncachedInput },
    { name: t("Cache read"), value: tokens.cacheRead, color: TOKEN_COLORS.cacheRead },
    { name: t("Output"), value: tokens.output, color: TOKEN_COLORS.output },
    { name: t("Cache write"), value: tokens.cacheWrite, color: TOKEN_COLORS.cacheWrite },
  ].filter((p) => p.value > 0);
  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
      <Donut data={parts} height={170} centerLabel={formatTokens(tokens.total)} centerSub={t("total")} />
      <div className="space-y-2">
        {parts.map((p) => (
          <div key={p.name} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="aac-tnum text-ink">
              {formatTokens(p.value)} <span className="text-ink-3">· {formatPct(p.value / tokens.total)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CacheHitRate({ ins }: { ins: InsightsData }) {
  const t = useT();
  const { tokens } = ins;
  if (!tokens.hasBreakdown) return <EmptyState icon={Recycle} title={t("No data yet")} />;
  const pct = tokens.cacheHitRate;
  const color = pct >= 0.7 ? "var(--color-safe)" : pct >= 0.4 ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <span className="aac-tnum text-[44px] font-bold leading-none" style={{ color }}>
        {formatPct(pct)}
      </span>
      <span className="text-[11px] text-ink-3">{t("of input tokens were cache reads")}</span>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%`, background: color }} />
      </div>
      <p className="mt-1 text-center text-[11px] leading-snug text-ink-3">
        {t("Cache reads are billed at a fraction of fresh input — a high rate means most of your context is being reused cheaply.")}
      </p>
    </div>
  );
}

function RiskInterception({ ins }: { ins: InsightsData }) {
  const t = useT();
  const { flagged, toolCalls, rate } = ins.risk;
  const color = rate >= 0.1 ? "var(--color-danger)" : rate >= 0.03 ? "var(--color-warn)" : "var(--color-safe)";
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <span className="aac-tnum text-[44px] font-bold leading-none" style={{ color }}>
        {formatPct(rate)}
      </span>
      <span className="text-[11px] text-ink-3">
        {t("{flagged} of {toolCalls} tool calls flagged", { flagged: formatNumber(flagged), toolCalls: formatNumber(toolCalls) })}
      </span>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(rate * 100))}%`, background: color }} />
      </div>
      <p className="mt-1 text-center text-[11px] leading-snug text-ink-3">
        {t("Share of your agents' actions that tripped a risk rule. Lower is calmer; a spike is worth a look on the Risk Radar.")}
      </p>
    </div>
  );
}

function ModelCost({ ins }: { ins: InsightsData }) {
  const max = Math.max(1, ...ins.models.map((m) => m.costUsd));
  return (
    <div className="space-y-2.5">
      {ins.models.map((m, i) => (
        <div key={m.model}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="aac-truncate font-mono text-ink-2">{m.model}</span>
            <span className="aac-tnum text-ink">
              {formatUsd(m.costUsd)} <span className="text-ink-3">· {formatTokens(m.tokens)}</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(3, (m.costUsd / max) * 100)}%`,
                background: i === 0 ? AGENT_COLOR_VAR["claude-code"] : "var(--color-codex)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolLatency({ ins }: { ins: InsightsData }) {
  const t = useT();
  const { latency } = ins;
  if (!latency.sampled) {
    return (
      <EmptyState icon={Timer} title={t("No timing data yet")}>
        {t("Latency appears once tool calls with timing are collected.")}
      </EmptyState>
    );
  }
  const max = Math.max(1, ...latency.tools.map((tool) => tool.medianMs));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={t("median tool latency")} value={formatDuration(latency.medianMs)} />
        <StatTile label={t("median thinking time")} value={formatDuration(latency.thinkingMs)} />
      </div>
      <div className="space-y-2.5">
        {latency.tools.slice(0, 8).map((tool) => (
          <div key={tool.name}>
            <div className="flex items-center justify-between text-[12px]">
              <span className="aac-truncate font-mono text-ink-2">{tool.name}</span>
              <span className="aac-tnum text-ink">
                {formatDuration(tool.medianMs)}{" "}
                <span className="text-ink-3">· p90 {formatDuration(tool.p90Ms)} · ×{formatNumber(tool.count)}</span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${Math.max(3, (tool.medianMs / max) * 100)}%`, background: "var(--color-codex)" }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-3">
        {t("Median execution time per tool. “Thinking time” is how long from your prompt to the agent’s first action.")}
      </p>
    </div>
  );
}

function CommandFailures({ ins }: { ins: InsightsData }) {
  const t = useT();
  const { failures } = ins;
  if (!failures.withExit) return <EmptyState icon={AlertTriangle} title={t("No commands with exit codes yet")} />;
  const rate = failures.rate;
  const color = rate >= 0.2 ? "var(--color-danger)" : rate >= 0.05 ? "var(--color-warn)" : "var(--color-safe)";
  return (
    <div className="flex flex-col items-center gap-2 py-1">
      <span className="aac-tnum text-[44px] font-bold leading-none" style={{ color }}>
        {formatPct(rate)}
      </span>
      <span className="text-[11px] text-ink-3">
        {t("{failed} of {withExit} commands exited non-zero", { failed: formatNumber(failures.failed), withExit: formatNumber(failures.withExit) })}
      </span>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(rate * 100))}%`, background: color }} />
      </div>
      {failures.tools.filter((t) => t.failed > 0).length > 0 && (
        <div className="mt-2 w-full space-y-1.5">
          {failures.tools.filter((t) => t.failed > 0).slice(0, 4).map((t) => (
            <div key={t.name} className="flex items-center justify-between text-[11px]">
              <span className="aac-truncate font-mono text-ink-2">{t.name}</span>
              <span className="aac-tnum text-ink-3">{t.failed}/{t.total} · {formatPct(t.rate)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Outcomes({ ins }: { ins: InsightsData }) {
  const t = useT();
  const { outcomes } = ins;
  if (!outcomes.total) return <EmptyState icon={Activity} title={t("No sessions yet")} />;
  const segs = [
    { label: t("completed"), value: outcomes.completed, color: "var(--color-safe)" },
    { label: t("failed"), value: outcomes.failed, color: "var(--color-danger)" },
    { label: t("interrupted"), value: outcomes.active, color: "var(--color-warn)" },
  ].filter((s) => s.value > 0);
  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex items-baseline gap-2">
        <span className="aac-tnum text-[34px] font-bold leading-none text-safe">{formatPct(outcomes.completionRate)}</span>
        <span className="text-[11px] text-ink-3">{t("completed cleanly")}</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {segs.map((s) => (
          <div key={s.label} style={{ width: `${(s.value / outcomes.total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="space-y-1.5">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 capitalize text-ink-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="aac-tnum text-ink">{formatNumber(s.value)}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-3">
        {t("“Interrupted” sessions ended without a clean stop — abandoned or cut off mid-turn.")}
      </p>
    </div>
  );
}

function DailyTrend({ ins }: { ins: InsightsData }) {
  const max = Math.max(1, ...ins.daily.map((d) => d.costUsd));
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-full items-end gap-2" style={{ height: 140 }}>
        {ins.daily.map((d) => (
          <div key={d.date} className="flex min-w-[26px] flex-1 flex-col items-center gap-1" title={`${d.date} · ${formatUsd(d.costUsd)} · ${formatTokens(d.tokens)} · ${d.sessions} session(s)`}>
            <span className="aac-tnum text-[9px] text-ink-3">{d.costUsd >= 0.005 ? formatUsd(d.costUsd) : ""}</span>
            <div className="flex w-full items-end justify-center" style={{ height: 96 }}>
              <div
                className="w-full max-w-[22px] rounded-t"
                style={{ height: `${Math.max(4, (d.costUsd / max) * 96)}px`, background: "var(--color-claude)" }}
              />
            </div>
            <span className="aac-tnum text-[9px] text-ink-3">{d.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarList({ items, color }: { items: { label: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="aac-truncate font-mono text-ink-2">{it.label}</span>
            <span className="aac-tnum text-ink">{formatNumber(it.value)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, (it.value / max) * 100)}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
