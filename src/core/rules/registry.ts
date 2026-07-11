/**
 * Security-rule registry (REFACTOR_PLAN.md Phase 2).
 *
 * One queryable catalog over every detection rule the product ships, in the
 * new `AAA-*` namespace with the pre-rename `AAC-*` ids preserved as
 * `legacyIds`. Stored findings keep whatever id they were written with;
 * `resolveRule()` accepts either generation, so old databases, old
 * policy.json `ignoreRules`, and new reports all keep working.
 *
 * The registry DERIVES its command/MCP entries from the live rule tables
 * (riskRuleCatalog / mcpRuleCatalog) rather than duplicating them — titles
 * and severities cannot drift from the code that actually detects. Detection
 * itself stays where it is; this is metadata + id mapping, not a new engine.
 *
 * `references` (CWE / OWASP / MCP-best-practice mappings) is part of the
 * shape but ships EMPTY: a wrong mapping is worse than none, and curated
 * mappings land with Phase 4 verification. Nothing here claims a standards
 * coverage it does not have.
 */
import type { RiskCategory, RiskSeverity } from "../types";
import { riskRuleCatalog } from "../risk";
import { mcpRuleCatalog } from "../mcp";

export type RuleReference = {
  /** e.g. "CWE", "OWASP-LLM", "OWASP-Agentic", "MCP-BP" */
  standard: string;
  id: string;
  url?: string;
};

export type DetectionMethod =
  | "runtime-event" // observed in an ingested agent event
  | "static-config"; // found by scanning on-disk configuration

export type SecurityRuleDefinition = {
  /** New-namespace id, e.g. "AAA-SHELL-002". */
  id: string;
  /** Ids this rule was known by before the rename; matched by resolveRule(). */
  legacyIds: string[];
  /** Rule semantics version — bumped when detection or severity changes. */
  version: string;
  title: string;
  category: RiskCategory;
  defaultSeverity: RiskSeverity;
  /**
   * How much a match should be trusted. Pattern rules over shell text are
   * "medium" (regexes have false positives); config-structure rules are
   * "high" (the config either declares it or it doesn't).
   */
  confidence: "low" | "medium" | "high";
  detectionMethod: DetectionMethod;
  appliesTo: string[];
  references: RuleReference[];
};

const LEGACY_PREFIX = "AAC-";
const PREFIX = "AAA-";

/** AAC-GIT-014 → AAA-GIT-014 (the domain/number part is stable). */
export function modernId(legacyId: string): string {
  return legacyId.startsWith(LEGACY_PREFIX) ? PREFIX + legacyId.slice(LEGACY_PREFIX.length) : legacyId;
}

/**
 * The three runtime rules that live inline in risk.ts (not in a catalog).
 * Severity for these is context-dependent at detection time; the registry
 * records the highest the rule can assign.
 */
const INLINE_RUNTIME_RULES: Array<{
  legacyId: string;
  title: string;
  category: RiskCategory;
  defaultSeverity: RiskSeverity;
}> = [
  { legacyId: "AAC-SECRET-001", title: "Secret detected in tool input", category: "secrets", defaultSeverity: "critical" },
  { legacyId: "AAC-SECRET-004", title: "Access to a likely secret file", category: "secrets", defaultSeverity: "medium" },
  { legacyId: "AAC-FILE-005", title: "Write outside repository root", category: "files", defaultSeverity: "medium" },
];

function buildRegistry(): SecurityRuleDefinition[] {
  const out: SecurityRuleDefinition[] = [];

  for (const r of riskRuleCatalog()) {
    out.push({
      id: modernId(r.ruleId),
      legacyIds: [r.ruleId],
      version: "1.0.0",
      title: r.title,
      category: r.category,
      defaultSeverity: r.severity,
      confidence: "medium", // regex over shell text
      detectionMethod: "runtime-event",
      appliesTo: ["claude-code", "codex"],
      references: [],
    });
  }

  for (const r of INLINE_RUNTIME_RULES) {
    out.push({
      id: modernId(r.legacyId),
      legacyIds: [r.legacyId],
      version: "1.0.0",
      title: r.title,
      category: r.category,
      defaultSeverity: r.defaultSeverity,
      confidence: r.legacyId === "AAC-SECRET-001" ? "high" : "medium", // redaction hit vs path heuristic
      detectionMethod: "runtime-event",
      appliesTo: ["claude-code", "codex"],
      references: [],
    });
  }

  for (const r of mcpRuleCatalog()) {
    out.push({
      id: modernId(r.ruleId),
      legacyIds: [r.ruleId],
      version: "1.0.0",
      title: r.title,
      category: r.category as RiskCategory,
      defaultSeverity: r.severity,
      confidence: "high", // structural facts about configuration
      detectionMethod: "static-config",
      appliesTo: ["mcp-config"],
      references: [],
    });
  }

  return out;
}

let cached: SecurityRuleDefinition[] | undefined;

export function ruleRegistry(): SecurityRuleDefinition[] {
  return (cached ??= buildRegistry());
}

/** Look a rule up by its current OR any legacy id. */
export function resolveRule(id: string): SecurityRuleDefinition | undefined {
  return ruleRegistry().find((r) => r.id === id || r.legacyIds.includes(id));
}
