import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { useId } from "react";

/** Tiny inline area sparkline for metric tiles. */
export function Sparkline({
  data,
  color,
  height = 28,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height, width: "100%" }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.34} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${id})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
