import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileCode2,
  GitCommitHorizontal,
  GitPullRequestDraft,
  FlaskConical,
  ShieldAlert,
  Flame,
  FolderTree,
  History,
  PieChart as PieIcon,
} from "lucide-react";
import { AGENT_LABELS } from "@core/types";
import { useDataset } from "../data/useDataset";
import { MetricCard } from "../components/MetricCard";
import { Panel, EmptyState } from "../components/ui";
import { AgentDot, AgentBadge } from "../components/AgentBadge";
import { RiskBadge } from "../components/RiskBadge";
import { RepoTreemap } from "../components/Treemap";
import { HeatmapGrid, HeatmapLegend } from "../components/HeatmapGrid";
import { Donut } from "../components/charts";
import { DiffViewer, type DiffLine } from "../components/DiffViewer";
import { cn } from "../lib/cn";
import { AGENT_COLOR_VAR, formatClock, formatNumber } from "../lib/format";

const SAMPLE_DIFF: DiffLine[] = [
  { type: "hunk", text: "@@ -18,6 +18,9 @@ redaction" },
  { type: "ctx", text: "const PATTERNS = [", oldNo: 18, newNo: 18 },
  { type: "add", text: "  /sk-ant-[a-z0-9-]{24,}/gi, // anthropic", newNo: 19 },
  { type: "add", text: "  /ghp_[a-zA-Z0-9]{36}/g,    // github", newNo: 20 },
  { type: "del", text: "  /token=[^&]+/g,", oldNo: 19 },
  { type: "ctx", text: "];", oldNo: 20, newNo: 21 },
];

export function RepoActivity() {
  const navigate = useNavigate();
  const dataset = useDataset();
  const { repoActivity: ra, fileChanges, sessions } = dataset;

  const [selectedFile, setSelectedFile] = useState<string>(ra.hotFiles[0]?.filePath ?? "");
  const selected = ra.hotFiles.find((f) => f.filePath === selectedFile) ?? ra.hotFiles[0];

  const relatedSessions = useMemo(() => {
    const ids = new Set(
      fileChanges.filter((fc) => fc.filePath === selectedFile).map((fc) => fc.sessionId)
    );
    return sessions.filter((s) => ids.has(s.id));
  }, [fileChanges, sessions, selectedFile]);

  const contribData = ra.contribution.map((c) => ({
    name: AGENT_LABELS[c.agent],
    value: c.churn,
    color: AGENT_COLOR_VAR[c.agent],
  }));

  return (
    <div className="space-y-4 p-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Files Changed" value={ra.filesChanged} icon={FileCode2} footnote={`${formatNumber(ra.churn)} churn`} />
        <MetricCard label="Commits" value={ra.commits} icon={GitCommitHorizontal} delta={20} />
        <MetricCard label="PR Drafts" value={ra.prDrafts} icon={GitPullRequestDraft} accent="var(--color-cursor)" />
        <MetricCard label="Tests Passing" value={ra.testsPassing} icon={FlaskConical} accent="var(--color-safe)" footnote={`${ra.testsFailing} failing`} />
        <MetricCard label="High-risk Files" value={ra.highRiskFilesTouched} icon={ShieldAlert} accent="var(--color-warn)" />
        <MetricCard label="Churn" value={formatNumber(ra.churn)} icon={Flame} footnote="+1.0k / −0.3k" />
      </div>

      {/* Directory map + hot files */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="Directory Map"
          icon={FolderTree}
          subtitle="Rectangle size = churn · color = max risk"
          className="xl:col-span-2"
        >
          <RepoTreemap
            nodes={ra.treemap}
            height={260}
            selected={ra.treemap.find((n) => selectedFile.startsWith(n.path))?.path}
          />
        </Panel>

        <Panel title="Hot Files" icon={Flame} iconColor="var(--color-warn)" subtitle="Highest churn this range" noBodyPadding>
          <div className="max-h-[260px] overflow-y-auto">
            {ra.hotFiles.map((f) => {
              const isSel = f.filePath === selectedFile;
              const max = ra.hotFiles[0].churn;
              return (
                <button
                  key={f.filePath}
                  type="button"
                  onClick={() => setSelectedFile(f.filePath)}
                  className={cn(
                    "flex w-full min-w-0 flex-col gap-1 border-b border-line/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-2",
                    isSel && "bg-surface-2"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="aac-truncate font-mono text-[12px] text-ink">{f.filePath}</span>
                    {f.maxRisk && f.maxRisk !== "info" && <RiskBadge severity={f.maxRisk} />}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(f.churn / max) * 100}%`, background: "var(--color-warn)" }}
                      />
                    </div>
                    <span className="aac-tnum w-8 text-right text-[10px] text-ink-3">{f.churn}</span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {f.agents.map((a) => (
                        <AgentDot key={a} agent={a} size={6} />
                      ))}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Git timeline + selected file */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Git Timeline" icon={History} subtitle={`${ra.gitTimeline.length} commits`} className="xl:col-span-2" noBodyPadding>
          <div className="px-4 py-3">
            <ol className="relative ml-2 border-l border-line">
              {ra.gitTimeline.map((c) => (
                <li key={c.sha} className="relative mb-3 pl-5 last:mb-0">
                  <span
                    className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface"
                    style={{ background: AGENT_COLOR_VAR[c.agent] }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="aac-truncate text-[13px] font-medium text-ink">{c.message}</span>
                    {c.isPrDraft && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded border border-cursor/40 bg-cursor/10 px-1.5 py-0.5 text-[10px] font-medium text-cursor">
                        <GitPullRequestDraft size={10} /> PR draft
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
                    <span className="font-mono">{c.sha}</span>
                    <span className="aac-truncate">{c.branch}</span>
                    <span className="text-safe">+{c.linesAdded}</span>
                    <span className="text-danger">−{c.linesDeleted}</span>
                    <span>{c.filesChanged} files</span>
                    {c.testsFailed ? (
                      <span className="text-danger">{c.testsFailed} tests failing</span>
                    ) : (
                      <span className="text-safe">{c.testsPassed} tests pass</span>
                    )}
                    <span className="aac-tnum">{formatClock(c.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Panel>

        <Panel title="Selected File" icon={FileCode2} subtitle={selected?.filePath}>
          {selected ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Churn" value={String(selected.churn)} />
                <MiniStat label="Edits" value={String(selected.edits)} />
                <MiniStat label="+/−" value={`${selected.linesAdded}/${selected.linesDeleted}`} />
              </div>
              <DiffViewer file={selected.filePath} lines={SAMPLE_DIFF} added={selected.linesAdded} deleted={selected.linesDeleted} />
              <div>
                <div className="mb-1 text-[11px] font-medium text-ink-3">Related sessions</div>
                <div className="space-y-1">
                  {relatedSessions.length ? (
                    relatedSessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/session-replay/${s.id}`)}
                        className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left text-[12px] hover:border-line"
                      >
                        <AgentDot agent={s.agent} />
                        <span className="aac-truncate flex-1 text-ink-2">{s.summary}</span>
                        <span className="text-[10px] text-ink-3">{formatClock(s.startedAt)}</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-[12px] text-ink-3">No linked sessions.</p>
                  )}
                </div>
              </div>
              <div className="rounded-md border border-line bg-surface-2 px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
                  <FlaskConical size={12} className="text-safe" /> Test impact
                </div>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Touched by {selected.agents.map((a) => AGENT_LABELS[a]).join(", ")}. Covered by
                  tests/agent.test.ts — last run green.
                </p>
              </div>
            </div>
          ) : (
            <EmptyState icon={FileCode2} title="No file selected" />
          )}
        </Panel>
      </div>

      {/* Heatmap + contribution */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Contribution Heatmap" subtitle="Agent edits over 18 weeks" className="xl:col-span-2">
          <div className="space-y-2">
            <HeatmapGrid cells={ra.heatmap} cellSize={12} />
            <HeatmapLegend />
          </div>
        </Panel>
        <Panel title="Agent Contribution" icon={PieIcon} subtitle="Share of churn">
          <div className="grid grid-cols-2 items-center gap-3">
            <Donut data={contribData} height={150} centerLabel={formatNumber(ra.churn)} centerSub="churn" />
            <div className="space-y-2">
              {ra.contribution.map((c) => (
                <div key={c.agent} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <AgentBadge agent={c.agent} />
                    <span className="aac-tnum text-ink">
                      {Math.round((c.churn / ra.churn) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(c.churn / ra.churn) * 100}%`, background: AGENT_COLOR_VAR[c.agent] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="aac-inset rounded-md px-2 py-1.5 text-center">
      <div className="text-[10px] text-ink-3">{label}</div>
      <div className="aac-tnum text-[14px] font-semibold text-ink">{value}</div>
    </div>
  );
}
