import { Bot, Sparkles } from "lucide-react";
import type { AgentName } from "@core/types";
import { AGENT_LABELS } from "@core/types";
import { AGENT_COLOR_VAR } from "../lib/format";
import { cn } from "../lib/cn";

/** Compact agent identity chip. Claude Code = green, Codex = cyan. */
export function AgentBadge({
  agent,
  size = "sm",
  showLabel = true,
}: {
  agent: AgentName;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const color = AGENT_COLOR_VAR[agent];
  const Icon = agent === "claude-code" ? Sparkles : Bot;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium",
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-[12px]"
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <Icon size={size === "sm" ? 12 : 14} strokeWidth={2.25} />
      {showLabel && AGENT_LABELS[agent]}
    </span>
  );
}

export function AgentDot({ agent, size = 8 }: { agent: AgentName; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: AGENT_COLOR_VAR[agent] }}
    />
  );
}
