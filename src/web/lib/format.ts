import type { AgentName, RiskSeverity } from "@core/types";

const numberFmt = new Intl.NumberFormat("en-US");

export function formatNumber(n: number): string {
  return numberFmt.format(Math.round(n));
}

/** Compact token counts: 184200 -> "184.2k", 1_240_000 -> "1.24M". */
export function formatCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatTokens(n: number): string {
  return formatCompact(n);
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

/** "10:24:17" in the viewer's local timezone (auto-detected from the browser). */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "10:24" in the viewer's local timezone (auto-detected from the browser). */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Minutes between two ISO timestamps (best effort). */
export function durationBetween(start: string, end?: string): string {
  if (!end) return "active";
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return "—";
  const min = Math.round((b - a) / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

export const AGENT_COLOR_VAR: Record<AgentName, string> = {
  "claude-code": "var(--color-claude)",
  codex: "var(--color-codex)",
  cursor: "var(--color-cursor)",
  "gemini-cli": "var(--color-gemini)",
  unknown: "var(--color-ink-3)",
};

export const SEVERITY_COLOR_VAR: Record<RiskSeverity, string> = {
  info: "var(--color-info)",
  low: "var(--color-low)",
  medium: "var(--color-warn)",
  high: "#fb7185",
  critical: "var(--color-danger)",
};

export const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  info: "Info",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
