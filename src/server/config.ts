/**
 * Persisted local settings (~/.aster-agent-console/config.json). Everything here
 * is user-editable from the Settings screen and actually takes effect:
 *   - retentionDays: how long history is kept (pruned on start + every 12h)
 *   - pricing:       cost-estimate rates per model family (usage.ts)
 *
 * Reads tolerate a missing/corrupt file (fall back to defaults); writes merge so
 * unknown/older fields are preserved. Values are validated before they are used
 * or stored — a bad retention or rate can never wedge the collector.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG_DIR } from "../db/index";

export type PricingTable = Record<string, [number, number, number, number]>;

export type ConsoleConfig = {
  version: number;
  /** days of history to keep; 0 disables pruning */
  retentionDays: number;
  /** per-family rate overrides ([input, output, cacheRead, cacheWrite] per 1M tokens) */
  pricing?: PricingTable;
  /** preserved passthrough for older/unknown fields */
  [k: string]: unknown;
};

/** Editable pricing families — the keys usage.ts resolves a model to. */
export const PRICING_FAMILIES = ["claude-opus", "claude-sonnet", "claude-haiku", "gpt-5", "default"] as const;

const DEFAULTS: ConsoleConfig = { version: 1, retentionDays: 30 };

function configPath(dir: string): string {
  return join(dir, "config.json");
}

function clampRetention(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return DEFAULTS.retentionDays;
  return Math.min(3650, Math.round(n));
}

/** Keep only well-formed rate tuples for known families. */
function sanitizePricing(input: unknown): PricingTable | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: PricingTable = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (!(PRICING_FAMILIES as readonly string[]).includes(key)) continue;
    if (!Array.isArray(val) || val.length !== 4) continue;
    if (!val.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) continue;
    out[key] = [val[0], val[1], val[2], val[3]];
  }
  return Object.keys(out).length ? out : undefined;
}

export function loadConfig(dir: string = DEFAULT_CONFIG_DIR): ConsoleConfig {
  let raw: Record<string, unknown> = {};
  try {
    const file = configPath(dir);
    if (existsSync(file)) raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* corrupt file → defaults */
  }
  return {
    ...raw,
    version: typeof raw.version === "number" ? raw.version : DEFAULTS.version,
    retentionDays: "retentionDays" in raw ? clampRetention(raw.retentionDays) : DEFAULTS.retentionDays,
    pricing: sanitizePricing(raw.pricing),
  };
}

/** Merge a patch into config.json and return the persisted result. */
export function saveConfig(patch: Partial<ConsoleConfig>, dir: string = DEFAULT_CONFIG_DIR): ConsoleConfig {
  const current = loadConfig(dir);
  const next: ConsoleConfig = { ...current };
  if ("retentionDays" in patch) next.retentionDays = clampRetention(patch.retentionDays);
  if ("pricing" in patch) {
    const clean = sanitizePricing(patch.pricing);
    next.pricing = clean ? { ...(current.pricing ?? {}), ...clean } : current.pricing;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath(dir), JSON.stringify(next, null, 2));
  } catch {
    /* non-fatal: return the intended value even if the write failed */
  }
  return next;
}
