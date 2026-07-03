import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Sparkline } from "./Sparkline";

/** Dense metric tile: label, value, optional delta and sparkline. */
export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  delta,
  spark,
  sparkColor = "var(--color-ink-3)",
  accent,
  footnote,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon?: LucideIcon;
  delta?: number;
  spark?: number[];
  sparkColor?: string;
  accent?: string;
  footnote?: ReactNode;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="aac-card-2 flex min-w-0 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="aac-truncate text-[11px] font-medium text-ink-3">
          {label}
        </span>
        {Icon && (
          <Icon size={14} style={{ color: accent ?? "var(--color-ink-3)" }} />
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span
            className="aac-tnum text-[22px] font-semibold leading-none tracking-tight text-ink"
            style={accent ? { color: accent } : undefined}
          >
            {value}
          </span>
          {unit && <span className="text-[12px] text-ink-3">{unit}</span>}
        </div>
        {delta != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] font-medium",
              up ? "text-safe" : "text-danger"
            )}
          >
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {spark && spark.length > 1 ? (
        <Sparkline data={spark} color={sparkColor} height={26} />
      ) : footnote ? (
        <div className="text-[11px] text-ink-3">{footnote}</div>
      ) : null}
    </div>
  );
}
