import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  PolarRadiusAxis,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import type { RiskCategory, RiskSeverity } from "@core/types";
import { CATEGORY_LABEL } from "./RiskBadge";

const TOOLTIP_STYLE = {
  background: "var(--color-surface-2)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-ink)",
  padding: "6px 10px",
} as const;

const SEV_WEIGHT: Record<RiskSeverity, number> = {
  info: 1,
  low: 2,
  medium: 4,
  high: 7,
  critical: 10,
};

/** Convert risk rows into a 0..100 score per category for the radar. */
export function radarScores(
  rows: { category: RiskCategory; severity: RiskSeverity }[],
  categories: RiskCategory[]
): { category: RiskCategory; label: string; score: number }[] {
  return categories.map((category) => {
    const score = rows
      .filter((r) => r.category === category)
      .reduce((a, r) => a + SEV_WEIGHT[r.severity], 0);
    return {
      category,
      label: CATEGORY_LABEL[category],
      score: Math.min(100, score * 9),
    };
  });
}

export function RiskRadarChart({
  data,
  height = 240,
  color = "var(--color-danger)",
  fillOpacity = 0.22,
}: {
  data: { label: string; score: number }[];
  height?: number;
  color?: string;
  fillOpacity?: number;
}) {
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke="var(--color-line)" />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: "var(--color-ink-2)", fontSize: 11 }}
          />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            dataKey="score"
            stroke={color}
            strokeWidth={2}
            fill={color}
            fillOpacity={fillOpacity}
            isAnimationActive={false}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={false} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({
  data,
  height = 180,
  centerLabel,
  centerSub,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  return (
    <div className="relative" style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="var(--color-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={false} />
        </PieChart>
      </ResponsiveContainer>
      {centerLabel && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="aac-tnum text-[18px] font-semibold text-ink">{centerLabel}</span>
          {centerSub && <span className="text-[10px] text-ink-3">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

export function ActivityArea({
  data,
  height = 150,
}: {
  data: { label: string; claude: number; codex: number; risk: number }[];
  height?: number;
}) {
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
          <defs>
            <linearGradient id="aClaude" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-claude)" stopOpacity={0.34} />
              <stop offset="100%" stopColor="var(--color-claude)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="aCodex" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-codex)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--color-codex)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-ink-3)", fontSize: 10 }}
            axisLine={{ stroke: "var(--color-line)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-ink-3)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={34}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--color-line)" }} />
          <Area
            type="monotone"
            dataKey="claude"
            stroke="var(--color-claude)"
            strokeWidth={1.5}
            fill="url(#aClaude)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="codex"
            stroke="var(--color-codex)"
            strokeWidth={1.5}
            fill="url(#aCodex)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SeverityBars({
  data,
  height = 150,
}: {
  data: { label: string; value: number; color: string }[];
  height?: number;
}) {
  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="var(--color-line-soft)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-ink-3)", fontSize: 10 }}
            axisLine={{ stroke: "var(--color-line)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "var(--color-ink-3)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={32}
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--color-surface-2)" }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
