/**
 * Token & cost usage from agent transcripts (opt-in enrichment).
 *
 * Hook payloads do NOT carry token counts — they live only in each agent's
 * transcript. This module reads those transcripts *numbers-only*: it sums the
 * `usage` blocks and reads the model, and never extracts, stores, or forwards
 * any prompt/response content. Cost is an ESTIMATE from a small, editable rate
 * table (rates change; treat the figure as approximate).
 *
 * Fragility is contained by design: the transcript formats are internal to each
 * agent and may change. Every field access is guarded and a missing/renamed
 * field degrades to 0 — token/cost silently show nothing while everything else
 * keeps working. See docs/limitations.md.
 *
 * Claude Code: ~/.claude/projects/<cwd>/<session_id>.jsonl — per-turn `usage`.
 * Codex:       ~/.codex/sessions/YYYY/MM/DD/rollout-*-<uuid>.jsonl — cumulative
 *              `info.total_token_usage` (take the last).
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Usage = {
  model?: string;
  /** uncached input tokens */
  inputTokens: number;
  outputTokens: number;
  /** cache-read (discounted) input tokens */
  cachedInputTokens: number;
  /** cache-creation tokens (Claude only) */
  cacheWriteTokens: number;
  totalTokens: number;
  /** estimated USD (see rate table caveat above) */
  costUsd: number;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

// ---- pricing (USD per 1M tokens: [input, output, cacheRead, cacheWrite]) ----
// Estimates only. Defaults below; the Settings screen can override any family at
// runtime via applyPricingOverrides (persisted in config.json).
const PRICING: Record<string, [number, number, number, number]> = {
  "claude-opus": [15, 75, 1.5, 18.75],
  "claude-sonnet": [3, 15, 0.3, 3.75],
  "claude-haiku": [0.8, 4, 0.08, 1],
  "gpt-5": [1.25, 10, 0.125, 0],
  default: [3, 15, 0.3, 3.75],
};

/** Merge user rate overrides (from config.json) over the defaults, in place. */
export function applyPricingOverrides(overrides?: Record<string, [number, number, number, number]>): void {
  if (!overrides) return;
  for (const [key, rate] of Object.entries(overrides)) {
    if (key in PRICING && Array.isArray(rate) && rate.length === 4) PRICING[key] = [rate[0], rate[1], rate[2], rate[3]];
  }
}

/** Current effective rate table (defaults with any overrides applied). */
export function getPricing(): Record<string, [number, number, number, number]> {
  return { ...PRICING };
}

function rateFor(model?: string): [number, number, number, number] {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return PRICING["claude-opus"];
  if (m.includes("sonnet")) return PRICING["claude-sonnet"];
  if (m.includes("haiku")) return PRICING["claude-haiku"];
  if (m.includes("gpt") || m.includes("codex") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4"))
    return PRICING["gpt-5"];
  return PRICING.default;
}

export function estimateCost(u: Omit<Usage, "costUsd">): number {
  const [pi, po, pcr, pcw] = rateFor(u.model);
  const cost =
    (u.inputTokens * pi + u.outputTokens * po + u.cachedInputTokens * pcr + u.cacheWriteTokens * pcw) / 1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}

function finalize(base: Omit<Usage, "costUsd">): Usage | null {
  if (base.totalTokens <= 0) return null;
  return { ...base, costUsd: estimateCost(base) };
}

// ---- pure parsers (testable without the filesystem) -----------------------

/** Sum per-turn `message.usage` blocks from a Claude Code transcript (JSONL). */
export function parseClaudeUsage(text: string): Usage | null {
  let input = 0,
    output = 0,
    cacheR = 0,
    cacheW = 0;
  let model: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const msg = o.message as Record<string, unknown> | undefined;
    const u = msg?.usage as Record<string, unknown> | undefined;
    if (u && typeof u === "object") {
      input += num(u.input_tokens);
      output += num(u.output_tokens);
      cacheR += num(u.cache_read_input_tokens);
      cacheW += num(u.cache_creation_input_tokens);
      if (typeof msg?.model === "string") model = msg.model;
    }
  }
  return finalize({
    model,
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cacheR,
    cacheWriteTokens: cacheW,
    totalTokens: input + output + cacheR + cacheW,
  });
}

/** Take the last cumulative `info.total_token_usage` from a Codex rollout (JSONL). */
export function parseCodexUsage(text: string): Usage | null {
  let last: Record<string, unknown> | null = null;
  let model: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = o.payload as Record<string, unknown> | undefined;
    const info = payload?.info as Record<string, unknown> | undefined;
    const tot = info?.total_token_usage as Record<string, unknown> | undefined;
    if (tot && typeof tot === "object") last = tot;
    const m = payload?.model ?? (o.model as unknown);
    if (typeof m === "string") model = m;
  }
  if (!last) return null;
  const inputAll = num(last.input_tokens);
  const cached = num(last.cached_input_tokens);
  const output = num(last.output_tokens);
  const total = num(last.total_tokens);
  return finalize({
    model,
    inputTokens: Math.max(0, inputAll - cached),
    outputTokens: output,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    totalTokens: total || inputAll + output,
  });
}

// ---- filesystem readers (path-validated) ----------------------------------

const CLAUDE_ROOT = join(homedir(), ".claude", "projects");
const CODEX_ROOT = join(homedir(), ".codex", "sessions");
const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024;

/** Read a file only if it canonicalizes to inside `root` (untrusted path guard). */
function safeRead(path: string, root: string): string | null {
  try {
    const real = realpathSync(path);
    const realRoot = realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + "/")) return null;
    const st = statSync(real);
    if (!st.isFile() || st.size > MAX_TRANSCRIPT_BYTES) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

export function readClaudeUsage(transcriptPath: string): Usage | null {
  const text = safeRead(transcriptPath, CLAUDE_ROOT);
  return text == null ? null : parseClaudeUsage(text);
}

export function readCodexUsage(rolloutPath: string): Usage | null {
  const text = safeRead(rolloutPath, CODEX_ROOT);
  return text == null ? null : parseCodexUsage(text);
}

/** List rollout files under ~/.codex/sessions, newest first (bounded). */
function walkRollouts(root: string, limit = 400): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(root);
  // filenames start with an ISO-ish timestamp, so lexical desc ≈ newest first
  out.sort((a, b) => (a < b ? 1 : -1));
  return out.slice(0, limit);
}

function firstLineJson(path: string): Record<string, unknown> | null {
  try {
    const buf = readFileSync(path, "utf8");
    const nl = buf.indexOf("\n");
    return JSON.parse(nl >= 0 ? buf.slice(0, nl) : buf) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Best-effort mapping of a Codex session to its rollout file: match the session
 * id in the filename first (rollout-*-<uuid>.jsonl), then fall back to the newest
 * rollout whose `session_meta.cwd` matches. Returns null when nothing fits.
 */
export function findCodexRollout(sessionId?: string, cwd?: string): string | null {
  if (!existsSync(CODEX_ROOT)) return null;
  const files = walkRollouts(CODEX_ROOT);
  if (sessionId) {
    const hit = files.find((f) => f.includes(sessionId));
    if (hit) return hit;
  }
  if (cwd) {
    for (const f of files) {
      const meta = firstLineJson(f);
      const payload = (meta?.payload as Record<string, unknown> | undefined) ?? meta ?? {};
      if (payload.cwd === cwd) return f;
    }
  }
  return null;
}
