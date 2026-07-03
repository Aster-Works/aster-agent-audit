import { useMemo } from "react";
import type { RiskSeverity } from "@core/types";
import type { TreemapNode } from "@core/views";
import { SEVERITY_COLOR_VAR } from "../lib/format";
import { cn } from "../lib/cn";

type Rect = { x: number; y: number; w: number; h: number; node: TreemapNode };

/**
 * Binary slice-and-dice treemap in a normalized 0..100 box, rendered with
 * percentage positioning so it stays responsive without measuring the DOM.
 */
function layout(
  nodes: TreemapNode[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: Rect[]
) {
  if (nodes.length === 0) return;
  if (nodes.length === 1) {
    out.push({ x, y, w, h, node: nodes[0] });
    return;
  }
  const total = nodes.reduce((a, n) => a + Math.max(1, n.churn), 0);
  let acc = 0;
  let split = 1;
  // Split into two groups with ~half the total churn each.
  for (let i = 0; i < nodes.length; i++) {
    acc += Math.max(1, nodes[i].churn);
    if (acc >= total / 2) {
      split = i + 1;
      break;
    }
  }
  split = Math.min(Math.max(split, 1), nodes.length - 1);
  const first = nodes.slice(0, split);
  const second = nodes.slice(split);
  const firstSum = first.reduce((a, n) => a + Math.max(1, n.churn), 0);
  const ratio = firstSum / total;
  if (w >= h) {
    const fw = w * ratio;
    layout(first, x, y, fw, h, out);
    layout(second, x + fw, y, w - fw, h, out);
  } else {
    const fh = h * ratio;
    layout(first, x, y, w, fh, out);
    layout(second, x, y + fh, w, h - fh, out);
  }
}

export function RepoTreemap({
  nodes,
  height = 220,
  selected,
  onSelect,
}: {
  nodes: TreemapNode[];
  height?: number;
  selected?: string;
  onSelect?: (path: string) => void;
}) {
  const rects = useMemo(() => {
    const sorted = [...nodes].sort((a, b) => b.churn - a.churn);
    const out: Rect[] = [];
    layout(sorted, 0, 0, 100, 100, out);
    return out;
  }, [nodes]);

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-line bg-bg" style={{ height }}>
      {rects.map((r) => {
        const sev = (r.node.risk ?? "info") as RiskSeverity;
        const color = SEVERITY_COLOR_VAR[sev];
        const isSel = selected === r.node.path;
        const big = r.w > 18 && r.h > 16;
        return (
          <button
            type="button"
            key={r.node.path}
            onClick={() => onSelect?.(r.node.path)}
            title={`${r.node.path} · churn ${r.node.churn} · ${r.node.files} files`}
            className={cn(
              "absolute overflow-hidden border border-bg p-1.5 text-left transition-[outline] hover:z-10",
              isSel && "z-10"
            )}
            style={{
              left: `${r.x}%`,
              top: `${r.y}%`,
              width: `${r.w}%`,
              height: `${r.h}%`,
              background: `color-mix(in srgb, ${color} ${isSel ? 26 : 15}%, var(--color-surface))`,
              outline: isSel ? `1.5px solid ${color}` : "none",
              outlineOffset: -1.5,
            }}
          >
            {big && (
              <div className="flex h-full flex-col justify-between">
                <span className="aac-truncate block font-mono text-[11px] text-ink">
                  {r.node.name}
                </span>
                <span className="aac-tnum text-[10px] text-ink-3">
                  {r.node.churn}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
