import { cn } from "../lib/cn";

export type DiffLine = {
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
  oldNo?: number;
  newNo?: number;
};

/** Minimal, read-only unified diff renderer (no editor dependency). */
export function DiffViewer({
  file,
  lines,
  added,
  deleted,
}: {
  file: string;
  lines: DiffLine[];
  added?: number;
  deleted?: number;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-bg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="aac-truncate font-mono text-[11px] text-ink-2">{file}</span>
        <span className="shrink-0 font-mono text-[11px]">
          {added != null && <span className="text-safe">+{added}</span>}{" "}
          {deleted != null && <span className="text-danger">−{deleted}</span>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[12px] leading-[1.5]">
          <tbody>
            {lines.map((l, i) => (
              <tr
                key={i}
                className={cn(
                  l.type === "add" && "bg-[color-mix(in_srgb,var(--color-safe)_12%,transparent)]",
                  l.type === "del" && "bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]",
                  l.type === "hunk" && "bg-surface-2"
                )}
              >
                <td className="select-none border-r border-line/60 px-2 text-right text-[10px] text-ink-3 w-10">
                  {l.type === "add" ? "" : l.oldNo ?? ""}
                </td>
                <td className="select-none border-r border-line/60 px-2 text-right text-[10px] text-ink-3 w-10">
                  {l.type === "del" ? "" : l.newNo ?? ""}
                </td>
                <td
                  className={cn(
                    "select-none px-1.5 text-center w-5",
                    l.type === "add" && "text-safe",
                    l.type === "del" && "text-danger",
                    (l.type === "ctx" || l.type === "hunk") && "text-ink-3"
                  )}
                >
                  {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
                </td>
                <td
                  className={cn(
                    "whitespace-pre px-2",
                    l.type === "add" && "text-[#86efac]",
                    l.type === "del" && "text-[#fca5a5]",
                    l.type === "ctx" && "text-ink-2",
                    l.type === "hunk" && "text-ink-3"
                  )}
                >
                  {l.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
