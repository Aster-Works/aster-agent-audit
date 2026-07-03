import type { RiskCategory, RiskSeverity } from "@core/types";
import {
  KeyRound,
  Terminal,
  Plug,
  Globe,
  FileWarning,
  GitBranch,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SEVERITY_COLOR_VAR, SEVERITY_LABEL } from "../lib/format";
import { cn } from "../lib/cn";

export const CATEGORY_ICON: Record<RiskCategory, LucideIcon> = {
  secrets: KeyRound,
  shell: Terminal,
  mcp: Plug,
  network: Globe,
  files: FileWarning,
  git: GitBranch,
  policy: ShieldAlert,
};

export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  secrets: "Secrets",
  shell: "Shell",
  mcp: "MCP",
  network: "Network",
  files: "Files",
  git: "Git",
  policy: "Policy",
};

export function SeverityDot({ severity, size = 8 }: { severity: RiskSeverity; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: SEVERITY_COLOR_VAR[severity] }}
    />
  );
}

export function RiskBadge({
  severity,
  className,
}: {
  severity: RiskSeverity;
  className?: string;
}) {
  const color = SEVERITY_COLOR_VAR[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 38%, transparent)`,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      <SeverityDot severity={severity} size={6} />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function CategoryChip({ category }: { category: RiskCategory }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">
      <Icon size={12} className="text-ink-3" />
      {CATEGORY_LABEL[category]}
    </span>
  );
}
