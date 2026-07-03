import { CheckCircle2, FlaskConical, GitCommitHorizontal, Layers, ShieldAlert, TerminalSquare } from "lucide-react";
import type { AgentRollup } from "@core/types";
import { useAppStore } from "../app/store";
import { useDataset } from "../data/useDataset";
import { Panel } from "../components/ui";
import { AgentBadge } from "../components/AgentBadge";
import { SessionRow } from "../components/SessionRow";
import { Sparkline } from "../components/Sparkline";
import {
  AGENT_COLOR_VAR,
  formatPct,
  formatTokens,
  formatUsd,
  formatNumber,
} from "../lib/format";

export function Agents() {
  const dataset = useDataset();
  const { overview, sessions } = dataset;

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {overview.perAgent.map((a) => (
          <AgentCard key={a.agent} rollup={a} sessions={sessions} />
        ))}
      </div>

      {/* Comparison table */}
      <Panel title="Agent Comparison" icon={Layers} subtitle="Side-by-side this range" noBodyPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="px-4 py-2 font-medium">Metric</th>
                {overview.perAgent.map((a) => (
                  <th key={a.agent} className="px-4 py-2 font-medium">
                    <AgentBadge agent={a.agent} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="aac-tnum">
              <Row label="Sessions" values={overview.perAgent.map((a) => String(a.sessions))} />
              <Row label="Tokens" values={overview.perAgent.map((a) => formatTokens(a.tokens))} />
              <Row label="Cost" values={overview.perAgent.map((a) => formatUsd(a.costUsd))} />
              <Row label="Tool calls" values={overview.perAgent.map((a) => formatNumber(a.toolCalls))} />
              <Row label="Files changed" values={overview.perAgent.map((a) => String(a.filesChanged))} />
              <Row label="Commits" values={overview.perAgent.map((a) => String(a.commits))} />
              <Row
                label="Tests"
                values={overview.perAgent.map((a) => `${a.testsPassed} / ${a.testsFailed} fail`)}
              />
              <Row label="Risk findings" values={overview.perAgent.map((a) => String(a.riskFindings))} />
              <Row label="Success rate" values={overview.perAgent.map((a) => formatPct(a.successRate))} />
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-b border-line/50 last:border-b-0">
      <td className="px-4 py-2 text-ink-3">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-4 py-2 font-medium text-ink">
          {v}
        </td>
      ))}
    </tr>
  );
}

function AgentCard({
  rollup,
  sessions,
}: {
  rollup: AgentRollup;
  sessions: ReturnType<typeof useAppStore.getState>["dataset"]["sessions"];
}) {
  const color = AGENT_COLOR_VAR[rollup.agent];
  const own = sessions.filter((s) => s.agent === rollup.agent).slice(0, 5);
  return (
    <Panel
      title={<AgentBadge agent={rollup.agent} size="md" />}
      action={
        <span className="inline-flex items-center gap-1 text-[11px] text-safe">
          <CheckCircle2 size={13} /> Hook ready
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon={Layers} label="Sessions" value={String(rollup.sessions)} color={color} />
        <Tile icon={TerminalSquare} label="Tool calls" value={formatNumber(rollup.toolCalls)} color={color} />
        <Tile icon={GitCommitHorizontal} label="Commits" value={String(rollup.commits)} color={color} />
        <Tile icon={ShieldAlert} label="Risks" value={String(rollup.riskFindings)} color={color} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-ink-3">
            <span>Activity</span>
            <span className="inline-flex items-center gap-1">
              <FlaskConical size={11} className="text-safe" />
              {rollup.testsPassed} tests · {formatPct(rollup.successRate)} success
            </span>
          </div>
          <Sparkline data={rollup.spark} color={color} height={32} />
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-line">
        {own.map((s) => (
          <SessionRow key={s.id} session={s} compact />
        ))}
      </div>
    </Panel>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="aac-inset rounded-md px-2.5 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-3">{label}</span>
        <Icon size={12} style={{ color }} />
      </div>
      <div className="aac-tnum mt-0.5 text-[16px] font-semibold text-ink">{value}</div>
    </div>
  );
}

export default Agents;
