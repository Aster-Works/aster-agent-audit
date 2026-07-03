import { useMemo } from "react";
import type { HeatCell } from "@core/views";

/**
 * Contribution-style heatmap. Weeks are columns, weekdays are rows. Fixed cell
 * size with horizontal scroll so it never breaks the surrounding layout.
 */
export function HeatmapGrid({
  cells,
  cellSize = 12,
  gap = 3,
}: {
  cells: HeatCell[];
  cellSize?: number;
  gap?: number;
}) {
  const { weeks, max } = useMemo(() => {
    const w = cells.reduce((m, c) => Math.max(m, c.week), 0) + 1;
    const mx = cells.reduce((m, c) => Math.max(m, c.value), 0);
    return { weeks: w, max: mx || 1 };
  }, [cells]);

  function color(v: number): string {
    if (v <= 0) return "var(--color-surface-2)";
    const t = v / max;
    // Green → teal scale, intensity by value.
    const opacity = 0.22 + t * 0.78;
    const hue = t > 0.75 ? "var(--color-codex)" : "var(--color-claude)";
    return `color-mix(in srgb, ${hue} ${Math.round(opacity * 100)}%, transparent)`;
  }

  const byWeek: HeatCell[][] = Array.from({ length: weeks }, () => []);
  for (const c of cells) byWeek[c.week][c.weekday] = c;

  return (
    <div className="overflow-x-auto">
      <div className="flex" style={{ gap }}>
        {byWeek.map((week, wi) => (
          <div key={wi} className="flex flex-col" style={{ gap }}>
            {Array.from({ length: 7 }, (_, d) => {
              const cell = week[d];
              const v = cell?.value ?? 0;
              return (
                <div
                  key={d}
                  title={cell ? `${cell.date} · ${v} events` : ""}
                  className="rounded-[2px] border border-line/40"
                  style={{ width: cellSize, height: cellSize, background: color(v) }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeatmapLegend() {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
      <span>Less</span>
      {steps.map((t) => (
        <span
          key={t}
          className="h-2.5 w-2.5 rounded-[2px] border border-line/40"
          style={{
            background:
              t === 0
                ? "var(--color-surface-2)"
                : `color-mix(in srgb, ${
                    t > 0.75 ? "var(--color-codex)" : "var(--color-claude)"
                  } ${Math.round((0.22 + t * 0.78) * 100)}%, transparent)`,
          }}
        />
      ))}
      <span>More</span>
    </div>
  );
}
