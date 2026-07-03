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
  /** A. tool latency — execution time from explicit duration or pre/post pairing */
  latency: {
    /** per-tool median & p90 execution time (ms), most-used first */
    tools: { name: string; count: number; medianMs: number; p90Ms: number }[];
    /** median execution time across all timed tool calls */
    medianMs: number | null;
    /** median time from a user prompt to the agent's first tool call */
    thinkingMs: number | null;
    /** number of tool calls that contributed a timing sample */
    sampled: number;
  };
  /** B. command failure rate over tool calls that carry an exit code */
  failures: {
    withExit: number;
    failed: number;
    rate: number;
    tools: { name: string; total: number; failed: number; rate: number }[];
  };
  /** C. changed-file breakdown by extension, most-touched first */
  fileTypes: { ext: string; count: number }[];
  /** D. per-day tokens / cost / sessions, chronological (activity days only) */
  daily: { date: string; tokens: number; costUsd: number; sessions: number }[];
  /** E. session outcomes */
  outcomes: {
    completed: number;
    failed: number;
    active: number;
    total: number;
    completionRate: number;
  };
};

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

const COMPLETED_TOOL = (t: string): boolean =>
  t === "post_tool_use" || t === "test_result" || t === "git_event";

const MAX_TOOL_MS = 30 * 60 * 1000; // ignore pairs beyond 30m (clock skew guard)

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(nums: number[], q: number): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

/** Local YYYY-MM-DD for a timestamp (uses the browser/machine timezone). */
function localDay(iso: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA");
}

function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const m = base.match(/\.([A-Za-z0-9]+)$/);
  return m ? "." + m[1].toLowerCase() : "(no ext)";
}

export function buildInsights(dataset: Dataset): Insights {
  const { sessions, eventsBySession, fileChanges, risk, overview } = dataset;
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

  // A. latency + B. failures — one pass over the per-session event streams
  // (already ordered by timestamp). Latency prefers an explicit duration
  // (Codex "Wall time"); otherwise it pairs each completed call with the
  // nearest earlier pre_tool_use of the same tool (FIFO within a session).
  const durByTool = new Map<string, number[]>();
  const allDur: number[] = [];
  const thinking: number[] = [];
  const failTools = new Map<string, { total: number; failed: number }>();
  let withExit = 0;
  let failedCalls = 0;

  for (const evs of Object.values(eventsBySession)) {
    const pending = new Map<string, number[]>(); // tool -> queue of pre timestamps (ms)
    let promptTs: number | null = null;
    for (const e of evs) {
      const ts = Date.parse(e.timestamp);
      if (e.type === "user_prompt") {
        promptTs = Number.isFinite(ts) ? ts : null;
        continue;
      }
      if (e.type === "pre_tool_use") {
        if (e.toolName && Number.isFinite(ts)) {
          const q = pending.get(e.toolName) ?? [];
          q.push(ts);
          pending.set(e.toolName, q);
        }
        if (promptTs != null && Number.isFinite(ts)) {
          const d = ts - promptTs;
          if (d >= 0 && d <= MAX_TOOL_MS) thinking.push(d);
          promptTs = null;
        }
        continue;
      }
      if (!COMPLETED_TOOL(e.type)) continue;

      const name = e.toolName ?? "tool";
      // latency: prefer an explicit duration; only consume a queued pre when we
      // actually pair (consuming on explicit-duration calls would desync FIFO).
      const explicit =
        typeof e.metrics?.durationMs === "number" ? e.metrics.durationMs : undefined;
      let dur = explicit;
      if (dur == null) {
        const q = pending.get(name);
        if (q?.length && Number.isFinite(ts)) dur = ts - q.shift()!;
      }
      if (dur != null && dur >= 0 && dur <= MAX_TOOL_MS) {
        allDur.push(dur);
        const arr = durByTool.get(name) ?? [];
        arr.push(dur);
        durByTool.set(name, arr);
      }
      // failure rate: real command runs only. test_result / git_event are
      // excluded — a red test suite (exit 1) is a healthy outcome tracked
      // separately, not a broken command, and commits shouldn't pad the base.
      const code = e.metrics?.exitCode;
      if (e.type === "post_tool_use" && typeof code === "number") {
        withExit++;
        const bad = code !== 0;
        if (bad) failedCalls++;
        const ft = failTools.get(name) ?? { total: 0, failed: 0 };
        ft.total++;
        if (bad) ft.failed++;
        failTools.set(name, ft);
      }
    }
  }

  const latency = {
    tools: [...durByTool.entries()]
      .map(([name, arr]) => ({
        name,
        count: arr.length,
        medianMs: Math.round(median(arr) ?? 0),
        p90Ms: Math.round(quantile(arr, 0.9) ?? 0),
      }))
      .sort((a, b) => b.count - a.count),
    medianMs: median(allDur),
    thinkingMs: median(thinking),
    sampled: allDur.length,
  };

  const failures = {
    withExit,
    failed: failedCalls,
    rate: withExit ? failedCalls / withExit : 0,
    tools: [...failTools.entries()]
      .map(([name, v]) => ({ name, total: v.total, failed: v.failed, rate: v.total ? v.failed / v.total : 0 }))
      .sort((a, b) => b.failed - a.failed || b.total - a.total),
  };

  // C. changed-file breakdown by extension
  const extCount = new Map<string, number>();
  for (const fc of fileChanges) extCount.set(extOf(fc.filePath), (extCount.get(extOf(fc.filePath)) ?? 0) + 1);
  const fileTypes = [...extCount.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count);

  // D. per-day tokens / cost / sessions
  const dayMap = new Map<string, { tokens: number; costUsd: number; sessions: number }>();
  for (const s of sessions) {
    const date = localDay(s.startedAt);
    if (!date) continue;
    const d = dayMap.get(date) ?? { tokens: 0, costUsd: 0, sessions: 0 };
    d.tokens += s.totalTokens ?? 0;
    d.costUsd += s.estimatedCostUsd ?? 0;
    d.sessions += 1;
    dayMap.set(date, d);
  }
  const daily = [...dayMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-30);

  // E. session outcomes
  let completed = 0;
  let failedSessions = 0;
  let activeSessions = 0;
  for (const s of sessions) {
    if (s.status === "completed") completed++;
    else if (s.status === "failed") failedSessions++;
    else activeSessions++;
  }
  const outcomes = {
    completed,
    failed: failedSessions,
    active: activeSessions,
    total: sessions.length,
    completionRate: sessions.length ? completed / sessions.length : 0,
  };

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
    latency,
    failures,
    fileTypes,
    daily,
    outcomes,
  };
}
