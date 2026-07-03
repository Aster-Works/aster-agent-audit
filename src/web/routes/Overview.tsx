import {
  Activity,
  Boxes,
  CircleDollarSign,
  FileCode2,
  GitCommitHorizontal,
  Layers,
  ShieldAlert,
  TerminalSquare,
  FlaskConical,
  ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { RISK_CATEGORIES, AGENT_LABELS } from "@core/types";
import type { AgentRollup } from "@core/types";
import { useAppStore } from "../app/store";
import { MetricCard } from "../components/MetricCard";
import { Panel, SectionLabel } from "../components/ui";
import { AgentBadge } from "../components/AgentBadge";
import { SessionRow } from "../components/SessionRow";
import { HeatmapGrid, HeatmapLegend } from "../components/HeatmapGrid";
import { ActivityArea, Donut, RiskRadarChart, radarScores } from "../components/charts";
import {
  AGENT_COLOR_VAR,
  formatNumber,
  formatTokens,
  formatUsd,
  formatPct,
} from "../lib/format";

export function Overview() {
  const dataset = useAppStore((s) => s.dataset);
  const { overview, sessions, risk, repoActivity } = dataset;
  const t = overview.totals;

  const radar = radarScores(risk, RISK_CATEGORIES);
  const costData = overview.perAgent.map((a) => ({
    name: AGENT_LABELS[a.agent],
    value: a.costUsd,
    color: AGENT_COLOR_VAR[a.agent],
  }));

  const claudeSpark = overview.perAgent.find((a) => a.agent === "claude-code")?.spark ?? [];
  const codexSpark = overview.perAgent.find((a) => a.agent === "codex")?.spark ?? [];

  return (
    <div className="space-y-4 p-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <MetricCard label="Sessions" value={t.sessions} icon={Layers} delta={12} spark={claudeSpark} sparkColor="var(--color-claude)" />
        <MetricCard label="Tokens" value={formatTokens(t.tokens)} icon={Boxes} delta={8} spark={codexSpark} sparkColor="var(--color-codex)" />
        <MetricCard label="Cost" value={formatUsd(t.costUsd)} icon={CircleDollarSign} delta={-4} accent="var(--color-ink)" footnote="across all repos" />
        <MetricCard label="Files Changed" value={t.filesChanged} icon={FileCode2} delta={15} footnote="9 high-churn" />
        <MetricCard label="Tool Calls" value={formatNumber(t.toolCalls)} icon={TerminalSquare} delta={6} footnote="Bash · Edit · Read" />
        <MetricCard label="Risk Findings" value={t.riskFindings} icon={ShieldAlert} accent="var(--color-warn)" footnote="1 critical · 2 high" />
        <MetricCard label="Tests Passing" value={`${t.testsPassing}`} icon={FlaskConical} accent="var(--color-safe)" footnote={`${t.testsFailing} failing`} />
        <MetricCard label="Commits" value={t.commits} icon={GitCommitHorizontal} delta={20} footnote="3 PR drafts" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Agent comparison */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:col-span-2">
          {overview.perAgent.map((a) => (
            <AgentPanel key={a.agent} rollup={a} sessions={sessions} />
          ))}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          <Panel
            title="Risk Radar"
            icon={ShieldAlert}
            iconColor="var(--color-warn)"
            subtitle={`${t.riskFindings} findings across ${RISK_CATEGORIES.length} categories`}
            action={
              <Link to="/risk-radar" className="text-[11px] text-ink-3 hover:text-ink-2">
                View all
              </Link>
            }
          >
            <RiskRadarChart data={radar} height={210} />
          </Panel>

          <Panel title="Cost" icon={CircleDollarSign} subtitle="Estimated spend by agent">
            <div className="grid grid-cols-2 items-center gap-2">
              <Donut data={costData} height={150} centerLabel={formatUsd(t.costUsd)} centerSub="today" />
              <div className="space-y-2">
                {overview.perAgent.map((a) => (
                  <div key={a.agent} className="flex items-center justify-between text-[12px]">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: AGENT_COLOR_VAR[a.agent] }}
                      />
                      {AGENT_LABELS[a.agent]}
                    </span>
                    <span className="aac-tnum text-ink">{formatUsd(a.costUsd)}</span>
                  </div>
                ))}
                <div className="mt-1 border-t border-line pt-1.5 text-[11px] text-ink-3">
                  {overview.costByRepo.slice(0, 2).map((r) => (
                    <div key={r.repo} className="flex items-center justify-between">
                      <span className="aac-truncate">{r.repo}</span>
                      <span className="aac-tnum">{formatUsd(r.costUsd)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Bottom: activity + repo heatmap */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Live Activity"
          icon={Activity}
          subtitle="Sessions started per hour"
          className="xl:col-span-2"
          action={
            <div className="flex items-center gap-3 text-[11px]">
              <Legend color="var(--color-claude)" label="Claude Code" />
              <Legend color="var(--color-codex)" label="Codex" />
            </div>
          }
        >
          <ActivityArea data={overview.activitySeries} height={170} />
        </Panel>

        <Panel
          title="Repo Activity"
          icon={Boxes}
          subtitle={`${repoActivity.repo} · ${repoActivity.churn} churn`}
          action={
            <Link
              to="/repo-activity"
              className="flex items-center gap-0.5 text-[11px] text-ink-3 hover:text-ink-2"
            >
              Details <ChevronRight size={12} />
            </Link>
          }
        >
          <div className="space-y-2">
            <HeatmapGrid cells={repoActivity.heatmap.filter((c) => c.week >= 8)} cellSize={11} />
            <div className="flex items-center justify-between">
              <HeatmapLegend />
              <span className="text-[11px] text-ink-3">
                {repoActivity.commits} commits · {repoActivity.prDrafts} PR drafts
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AgentPanel({
  rollup,
  sessions,
}: {
  rollup: AgentRollup;
  sessions: ReturnType<typeof useAppStore.getState>["dataset"]["sessions"];
}) {
  const color = AGENT_COLOR_VAR[rollup.agent];
  const own = sessions.filter((s) => s.agent === rollup.agent).slice(0, 4);
  return (
    <Panel
      title={<AgentBadge agent={rollup.agent} size="md" />}
      action={
        <span className="text-[11px] text-ink-3">
          success <span className="font-medium text-ink-2">{formatPct(rollup.successRate)}</span>
        </span>
      }
      bodyClassName="p-3"
    >
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Sessions" value={String(rollup.sessions)} color={color} />
        <Stat label="Tokens" value={formatTokens(rollup.tokens)} color={color} />
        <Stat label="Cost" value={formatUsd(rollup.costUsd)} color={color} />
        <Stat label="Tools" value={String(rollup.toolCalls)} color={color} />
      </div>
      <div className="mt-3">
        <SectionLabel>Recent sessions</SectionLabel>
        <div className="mt-1.5 overflow-hidden rounded-md border border-line">
          {own.map((s) => (
            <SessionRow key={s.id} session={s} compact />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="aac-inset rounded-md px-2 py-1.5">
      <div className="aac-truncate text-[10px] text-ink-3">{label}</div>
      <div className="aac-tnum text-[15px] font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-3">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
