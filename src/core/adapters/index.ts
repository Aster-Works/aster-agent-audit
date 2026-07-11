/**
 * Agent adapters (REFACTOR_PLAN.md Phase 2).
 *
 * The boundary between agent-specific knowledge and the canonical pipeline.
 * Everything downstream of `normalize()` — redaction, risk, storage,
 * enrichment, UI — is agent-agnostic; everything upstream (how events are
 * obtained, what the raw payload looks like) belongs to an adapter.
 *
 * Honesty note: the two shipped agents collect DIFFERENTLY, and the
 * interface says so instead of pretending one model fits both:
 *  - Claude Code is "push": its own hook POSTs each event to our collector.
 *    There is nothing for us to iterate — collect() would be a lie.
 *  - Codex is "poll": we tail its rollout logs and synthesize hook-shaped
 *    payloads (see core/codex-rollout.ts + server/codex-import.ts).
 *
 * No adapter exists here for agents we cannot actually read (per the brief:
 * no fake adapters, no fake data). New agents implement this interface and
 * register in ADAPTERS.
 */
import type { AgentName, EventSource } from "../types";
import { normalizeHookEvent, type NormalizeResult } from "../normalize";
import { parseCodexRollout } from "../codex-rollout";

export type CollectionMode = "push" | "poll";

export type NormalizeOpts = { id?: string; source?: EventSource };

export interface AgentAdapter {
  id: AgentName;
  displayName: string;
  /** How events reach the collector for this agent. */
  mode: CollectionMode;
  adapterVersion: string;
  /**
   * Turn one raw (hook-shaped) payload into the canonical event + redaction
   * side-channel. MUST be pure and MUST redact before returning — nothing
   * downstream ever sees an unredacted value.
   */
  normalize(payload: unknown, opts?: NormalizeOpts): NormalizeResult;
}

const claudeCode: AgentAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  mode: "push",
  adapterVersion: "1.0.0",
  normalize: (payload, opts) => normalizeHookEvent("claude-code", payload, opts),
};

const codex: AgentAdapter = {
  id: "codex",
  displayName: "Codex",
  mode: "poll",
  adapterVersion: "1.0.0",
  normalize: (payload, opts) => normalizeHookEvent("codex", payload, opts),
};

/**
 * Codex-specific: parse one rollout .jsonl into synthetic hook payloads that
 * `codex.normalize` then treats identically to pushed events. Exposed on the
 * module (not the interface) — it is a poll-mode implementation detail.
 */
export { parseCodexRollout };

export const ADAPTERS: readonly AgentAdapter[] = [claudeCode, codex];

export function getAdapter(id: AgentName): AgentAdapter {
  const a = ADAPTERS.find((x) => x.id === id);
  if (!a) throw new Error(`no adapter registered for agent "${id}"`);
  return a;
}
