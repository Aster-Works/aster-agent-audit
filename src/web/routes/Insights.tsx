import {
  Boxes,
  Coins,
  TerminalSquare,
  ShieldAlert,
  Cpu,
  Recycle,
} from "lucide-react";
import { useDataset } from "../data/useDataset";
import { buildInsights, type Insights as InsightsData } from "../lib/insights";
import { Panel, EmptyState } from "../components/ui";
import { Donut } from "../components/charts";
import { AGENT_COLOR_VAR, formatNumber, formatPct, formatTokens, formatUsd } from "../lib/format";

const TOKEN_COLORS = {
  uncachedInput: "var(--color-claude)",
  cacheRead: "var(--color-codex)",
  output: "var(--color-warn)",
  cacheWrite: "var(--color-ink-3)",
} as const;

export function Insights() {
  const dataset = useDataset();
  const ins = buildInsights(dataset);

  return (
    <div className="space-y-4 p-4">
      {/* Row 1: token composition + cache hit rate */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Token Composition"
          icon={Boxes}
          subtitle="Where your tokens actually go"
          className="xl:col-span-2"
        >
          <TokenComposition ins={ins} />
        </Panel>
        <Panel title="Cache Hit Rate" icon={Recycle} iconColor="var(--color-safe)" subtitle="Cheap cache reads vs fresh input">
          <CacheHitRate ins={ins} />
        </Panel>
      </div>

      {/* Row 2: cost efficiency */}
      <Panel title="Cost Efficiency" icon={Coins} subtitle="Estimated spend per unit of work">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="per commit" value={money(ins.efficiency.costPerCommit)} />
          <StatTile label="per file changed" value={money(ins.efficiency.costPerFile)} />
          <StatTile label="per session" value={money(ins.efficiency.costPerSession)} />
          <StatTile
            label="tokens / tool call"
            value={ins.efficiency.tokensPerToolCall == null ? "—" : formatTokens(Math.round(ins.efficiency.tokensPerToolCall))}
          />
        </div>
      </Panel>

      {/* Row 3: tool usage + risk interception + model cost */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Tool Usage" icon={TerminalSquare} subtitle="What your agents actually do">
          {ins.toolUsage.length ? <BarList items={ins.toolUsage.map((t) => ({ label: t.name, value: t.count }))} color="var(--color-claude)" /> : <EmptyState icon={TerminalSquare} title="No tool calls yet" />}
        </Panel>

        <Panel title="Risk Interception" icon={ShieldAlert} iconColor="var(--color-warn)" subtitle="Flagged share of tool calls">
          <RiskInterception ins={ins} />
        </Panel>

        <Panel title="Cost by Model" icon={Cpu} subtitle="Estimated spend per model">
          {ins.models.length ? <ModelCost ins={ins} /> : <EmptyState icon={Cpu} title="No model data yet" />}
        </Panel>
      </div>
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
  const { tokens } = ins;
  if (!tokens.hasBreakdown || tokens.total === 0) {
    return (
      <EmptyState icon={Boxes} title="No token breakdown yet">
        Run Claude Code or Codex — token composition is read from the transcript.
      </EmptyState>
    );
  }
  const parts = [
    { name: "Uncached input", value: tokens.uncachedInput, color: TOKEN_COLORS.uncachedInput },
    { name: "Cache read", value: tokens.cacheRead, color: TOKEN_COLORS.cacheRead },
    { name: "Output", value: tokens.output, color: TOKEN_COLORS.output },
    { name: "Cache write", value: tokens.cacheWrite, color: TOKEN_COLORS.cacheWrite },
  ].filter((p) => p.value > 0);
  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
      <Donut data={parts} height={170} centerLabel={formatTokens(tokens.total)} centerSub="total" />
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
  const { tokens } = ins;
  if (!tokens.hasBreakdown) return <EmptyState icon={Recycle} title="No data yet" />;
  const pct = tokens.cacheHitRate;
  const color = pct >= 0.7 ? "var(--color-safe)" : pct >= 0.4 ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <span className="aac-tnum text-[44px] font-bold leading-none" style={{ color }}>
        {formatPct(pct)}
      </span>
      <span className="text-[11px] text-ink-3">of input tokens were cache reads</span>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.round(pct * 100)}%`, background: color }} />
      </div>
      <p className="mt-1 text-center text-[11px] leading-snug text-ink-3">
        Cache reads are billed at a fraction of fresh input — a high rate means most of your context is being reused cheaply.
      </p>
    </div>
  );
}

function RiskInterception({ ins }: { ins: InsightsData }) {
  const { flagged, toolCalls, rate } = ins.risk;
  const color = rate >= 0.1 ? "var(--color-danger)" : rate >= 0.03 ? "var(--color-warn)" : "var(--color-safe)";
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <span className="aac-tnum text-[44px] font-bold leading-none" style={{ color }}>
        {formatPct(rate)}
      </span>
      <span className="text-[11px] text-ink-3">
        {formatNumber(flagged)} of {formatNumber(toolCalls)} tool calls flagged
      </span>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(rate * 100))}%`, background: color }} />
      </div>
      <p className="mt-1 text-center text-[11px] leading-snug text-ink-3">
        Share of your agents' actions that tripped a risk rule. Lower is calmer; a spike is worth a look on the Risk Radar.
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
