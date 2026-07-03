/**
 * Derived statistics for the Insights screen. Pure — computed from the
 * (already filtered) dataset so the top-bar filters apply here too.
 */
import type { Dataset } from "@core/views";

export type Insights = {
  /** token composition summed across sessions that have a breakdown */
  tokens: {
    uncachedInput: number;
    cacheRead: number;
    output: number;
    cacheWrite: number;
    total: number;
    /** cacheRead / (cacheRead + uncachedInput) */
    cacheHitRate: number;
    /** has any breakdown data at all */
    hasBreakdown: boolean;
  };
  /** cost / outcome efficiency (null when the denominator is 0) */
  efficiency: {
    costPerCommit: number | null;
    costPerFile: number | null;
    costPerSession: number | null;
    tokensPerToolCall: number | null;
  };
  /** tool-call distribution, most-used first */
  toolUsage: { name: string; count: number }[];
  /** share of tool calls that tripped a risk finding */
  risk: { flagged: number; toolCalls: number; rate: number };
  /** cost & tokens grouped by model, most-expensive first */
  models: { model: string; costUsd: number; tokens: number; sessions: number }[];
};

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function buildInsights(dataset: Dataset): Insights {
  const { sessions, eventsBySession, risk, overview } = dataset;
  const t = overview.totals;

  // 1. token composition
  let uncachedInput = 0;
  let cacheRead = 0;
  let output = 0;
  let cacheWrite = 0;
  let hasBreakdown = false;
  for (const s of sessions) {
    if (
      s.inputTokens != null ||
      s.outputTokens != null ||
      s.cachedInputTokens != null ||
      s.cacheWriteTokens != null
    ) {
      hasBreakdown = true;
    }
    uncachedInput += s.inputTokens ?? 0;
    cacheRead += s.cachedInputTokens ?? 0;
    output += s.outputTokens ?? 0;
    cacheWrite += s.cacheWriteTokens ?? 0;
  }
  const inputTotal = uncachedInput + cacheRead;

  // 2. cost efficiency
  const efficiency = {
    costPerCommit: div(t.costUsd, t.commits),
    costPerFile: div(t.costUsd, t.filesChanged),
    costPerSession: div(t.costUsd, t.sessions),
    tokensPerToolCall: div(t.tokens, t.toolCalls),
  };

  // 3. tool usage distribution (completed calls)
  const toolCounts = new Map<string, number>();
  for (const evs of Object.values(eventsBySession)) {
    for (const e of evs) {
      if (e.toolName && e.type === "post_tool_use") {
        toolCounts.set(e.toolName, (toolCounts.get(e.toolName) ?? 0) + 1);
      }
    }
  }
  const toolUsage = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // 4. risk interception rate
  const flagged = risk.filter((r) => r.sessionId !== "mcp-config-scan").length;
  const riskStat = { flagged, toolCalls: t.toolCalls, rate: div(flagged, t.toolCalls) ?? 0 };

  // 5. cost by model
  const modelMap = new Map<string, { costUsd: number; tokens: number; sessions: number }>();
  for (const s of sessions) {
    const m = s.model || "unknown";
    const cur = modelMap.get(m) ?? { costUsd: 0, tokens: 0, sessions: 0 };
    cur.costUsd += s.estimatedCostUsd ?? 0;
    cur.tokens += s.totalTokens ?? 0;
    cur.sessions += 1;
    modelMap.set(m, cur);
  }
  const models = [...modelMap.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);

  return {
    tokens: {
      uncachedInput,
      cacheRead,
      output,
      cacheWrite,
      total: uncachedInput + cacheRead + output + cacheWrite,
      cacheHitRate: inputTotal > 0 ? cacheRead / inputTotal : 0,
      hasBreakdown,
    },
    efficiency,
    toolUsage,
    risk: riskStat,
    models,
  };
}
