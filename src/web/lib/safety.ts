/**
 * Safety scoring shared by the Risk Radar page and the Overview panel. Inverts
 * risk into a 0–100 safety score so a clean setup reads as a big green shape.
 */
import type { RiskSeverity } from "@core/types";

const SAFETY_PENALTY: Record<RiskSeverity, number> = {
  info: 0,
  low: 2,
  medium: 7,
  high: 15,
  critical: 25,
};

export type Safety = { score: number; grade: string; color: string; label: string; safe: boolean };

export function computeSafety(rows: { severity: RiskSeverity }[]): Safety {
  const penalty = rows.reduce((a, r) => a + SAFETY_PENALTY[r.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  const color =
    score >= 80 ? "var(--color-safe)" : score >= 55 ? "var(--color-warn)" : "var(--color-danger)";
  const urgent = rows.filter((r) => r.severity === "critical" || r.severity === "high").length;
  const label = rows.length === 0 ? "All clear" : urgent > 0 ? `${urgent} to address` : "Minor only";
  return { score, grade, color, label, safe: score >= 80 };
}

/** Invert a risk radar (higher = riskier) into a safety radar (higher = safer). */
export function toSafetyRadar<T extends { score: number }>(radar: T[]): T[] {
  return radar.map((r) => ({ ...r, score: Math.max(0, 100 - r.score) }));
}
