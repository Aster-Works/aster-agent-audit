import { useNavigate } from "react-router-dom";
import {
  CircleCheck,
  CircleDot,
  CircleX,
  FileCode2,
  GitCommitHorizontal,
  ShieldAlert,
} from "lucide-react";
import type { AgentSession, RiskSeverity } from "@core/types";
import { cn } from "../lib/cn";
import {
  formatTime,
  formatTokens,
  formatUsd,
  SEVERITY_COLOR_VAR,
} from "../lib/format";
import { AgentDot } from "./AgentBadge";

const STATUS_META: Record<
  AgentSession["status"],
  { icon: typeof CircleCheck; color: string; label: string }
> = {
  completed: { icon: CircleCheck, color: "var(--color-safe)", label: "Completed" },
  active: { icon: CircleDot, color: "var(--color-info)", label: "Active" },
  failed: { icon: CircleX, color: "var(--color-danger)", label: "Failed" },
  unknown: { icon: CircleDot, color: "var(--color-ink-3)", label: "Unknown" },
};

export function SessionRow({
  session,
  compact,
}: {
  session: AgentSession;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const status = STATUS_META[session.status];
  const StatusIcon = status.icon;
  return (
    <button
      type="button"
      onClick={() => navigate(`/session-replay/${session.id}`)}
      className="group flex w-full min-w-0 items-center gap-3 border-b border-line/60 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-2"
    >
      <AgentDot agent={session.agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="aac-truncate text-[13px] font-medium text-ink group-hover:text-ink">
            {session.summary ?? session.id}
          </span>
          {session.maxRiskSeverity && session.maxRiskSeverity !== "info" && (
            <RiskCountDot count={session.riskCount ?? 0} severity={session.maxRiskSeverity} />
          )}
        </div>
        {!compact && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
            <span className="aac-truncate font-mono">{session.model}</span>
          </div>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-3 text-[11px] text-ink-3 sm:flex">
        <Metric icon={FileCode2}>{session.filesChanged ?? 0}</Metric>
        <Metric icon={GitCommitHorizontal}>{session.commits ?? 0}</Metric>
        <span className="aac-tnum w-12 text-right">{formatTokens(session.totalTokens ?? 0)}</span>
        <span className="aac-tnum w-10 text-right text-ink-2">
          {formatUsd(session.estimatedCostUsd ?? 0)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StatusIcon size={13} style={{ color: status.color }} />
        <span className="aac-tnum hidden w-9 text-right text-[11px] text-ink-3 md:inline">
          {formatTime(session.startedAt)}
        </span>
      </div>
    </button>
  );
}

function Metric({
  icon: Icon,
  children,
}: {
  icon: typeof FileCode2;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={12} />
      <span className="aac-tnum">{children}</span>
    </span>
  );
}

function RiskCountDot({ count, severity }: { count: number; severity: RiskSeverity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-semibold"
      )}
      style={{
        color: SEVERITY_COLOR_VAR[severity],
        background: `color-mix(in srgb, ${SEVERITY_COLOR_VAR[severity]} 14%, transparent)`,
      }}
    >
      <ShieldAlert size={10} />
      {count}
    </span>
  );
}
