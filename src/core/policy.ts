/**
 * Team policy (Phase 6). Mirrors AsterGuard's `.aster-guard/policy.json`:
 *   allowedMcpHosts  — remote MCP hosts the user has vetted (AAC-MCP-005 skips them)
 *   ignoreRules      — rule ids to suppress everywhere (display + scan exit code)
 *   failOn           — severity that makes `aster-audit scan` exit non-zero
 *
 * Policy is advisory over the *display* of findings and the scan exit code. It
 * never changes what is collected — the DB keeps the honest record; policy only
 * filters what the Risk Radar surfaces. This keeps the tool trustworthy: a user
 * who has vetted their own remote host can silence the noise without hiding it
 * from the raw log.
 */
import type { RiskSeverity } from "./types";
import { SEVERITY_ORDER } from "./types";
import { resolveRule } from "./rules/registry";

export type ConsolePolicy = {
  allowedMcpHosts?: string[];
  ignoreRules?: string[];
  failOn?: RiskSeverity | "never";
};

// ---- Policy schema v1 -------------------------------------------------------

/** Per-rule override: disable it, or change the severity it reports at. */
export type RuleOverride = {
  enabled?: boolean;
  severity?: RiskSeverity;
};

/**
 * Schema v1 extends the original three-field policy; every old policy.json is
 * a valid v1 policy. `ignoredRules` is accepted as an alias of `ignoreRules`.
 *
 * Reserved fields (accepted, validated, NOT yet enforced — validate() says so
 * out loud rather than silently accepting): forbiddenCommands, sensitivePaths,
 * allowedAgents, requireRedaction, retentionDays (retention is enforced via
 * config.json / Settings today; declaring it here too would create two sources
 * of truth until they are unified).
 */
export type PolicyV1 = ConsolePolicy & {
  schemaVersion?: number;
  name?: string;
  rules?: Record<string, RuleOverride>;
};

export type PolicyValidation = {
  policy: PolicyV1;
  /** Fatal: the file cannot be used. */
  errors: string[];
  /** Non-fatal: the file is used, but something deserves attention. */
  warnings: string[];
};

const KNOWN_FIELDS = new Set(["schemaVersion", "name", "allowedMcpHosts", "ignoreRules", "ignoredRules", "failOn", "rules"]);
const RESERVED_FIELDS = new Set(["forbiddenCommands", "sensitivePaths", "allowedAgents", "requireRedaction", "retentionDays"]);
const SEVERITIES = new Set<string>([...SEVERITY_ORDER]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Validate a parsed policy document. Never throws — malformed input becomes
 * `errors` (clear, field-by-field), suspicious-but-usable input becomes
 * `warnings`. An empty/undefined document is a valid empty policy.
 */
export function validatePolicy(raw: unknown): PolicyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const policy: PolicyV1 = {};

  if (raw == null) return { policy, errors, warnings };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { policy, errors: ["policy must be a JSON object"], warnings };
  }
  const doc = raw as Record<string, unknown>;

  if (doc.schemaVersion !== undefined) {
    if (typeof doc.schemaVersion !== "number" || !Number.isInteger(doc.schemaVersion)) {
      errors.push(`schemaVersion must be an integer (got ${JSON.stringify(doc.schemaVersion)})`);
    } else if (doc.schemaVersion > 1) {
      errors.push(`schemaVersion ${doc.schemaVersion} is newer than this version supports (1) — upgrade the app or lower the version`);
    } else {
      policy.schemaVersion = doc.schemaVersion;
    }
  }

  if (doc.name !== undefined) {
    if (typeof doc.name === "string") policy.name = doc.name;
    else errors.push("name must be a string");
  }

  if (doc.allowedMcpHosts !== undefined) {
    if (isStringArray(doc.allowedMcpHosts)) policy.allowedMcpHosts = doc.allowedMcpHosts;
    else errors.push("allowedMcpHosts must be an array of strings");
  }

  // `ignoredRules` (brief-era name) is an accepted alias of `ignoreRules`.
  const ignore = doc.ignoreRules ?? doc.ignoredRules;
  if (doc.ignoreRules !== undefined && doc.ignoredRules !== undefined) {
    warnings.push("both ignoreRules and ignoredRules present — using ignoreRules");
  }
  if (ignore !== undefined) {
    if (isStringArray(doc.ignoreRules !== undefined ? doc.ignoreRules : ignore)) {
      policy.ignoreRules = (doc.ignoreRules !== undefined ? doc.ignoreRules : ignore) as string[];
      for (const id of policy.ignoreRules) {
        if (!resolveRule(id)) warnings.push(`ignoreRules: unknown rule id "${id}" (no shipped rule matches — typo?)`);
      }
    } else {
      errors.push("ignoreRules must be an array of strings");
    }
  }

  if (doc.failOn !== undefined) {
    if (typeof doc.failOn === "string" && (doc.failOn === "never" || SEVERITIES.has(doc.failOn))) {
      policy.failOn = doc.failOn as PolicyV1["failOn"];
      if (doc.failOn === "never") warnings.push('failOn "never" disables the scan gate entirely — CI will pass regardless of findings');
    } else {
      errors.push(`failOn must be one of ${[...SEVERITIES].join(", ")} or "never"`);
    }
  }

  if (doc.rules !== undefined) {
    if (typeof doc.rules !== "object" || doc.rules === null || Array.isArray(doc.rules)) {
      errors.push("rules must be an object keyed by rule id");
    } else {
      const rules: Record<string, RuleOverride> = {};
      for (const [id, v] of Object.entries(doc.rules as Record<string, unknown>)) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          errors.push(`rules["${id}"] must be an object`);
          continue;
        }
        const o = v as Record<string, unknown>;
        const entry: RuleOverride = {};
        if (o.enabled !== undefined) {
          if (typeof o.enabled === "boolean") entry.enabled = o.enabled;
          else errors.push(`rules["${id}"].enabled must be a boolean`);
        }
        if (o.severity !== undefined) {
          if (typeof o.severity === "string" && SEVERITIES.has(o.severity)) entry.severity = o.severity as RiskSeverity;
          else errors.push(`rules["${id}"].severity must be one of ${[...SEVERITIES].join(", ")}`);
        }
        for (const k of Object.keys(o)) {
          if (k !== "enabled" && k !== "severity") warnings.push(`rules["${id}"].${k} is not a recognized override`);
        }
        const def = resolveRule(id);
        if (!def) warnings.push(`rules: unknown rule id "${id}" (no shipped rule matches — typo?)`);
        else if (entry.enabled === false && def.defaultSeverity === "critical") {
          warnings.push(`rules["${id}"] disables a critical-severity rule ("${def.title}") — make sure this is deliberate`);
        }
        rules[id] = entry;
      }
      policy.rules = rules;
    }
  }

  for (const k of Object.keys(doc)) {
    if (KNOWN_FIELDS.has(k)) continue;
    if (RESERVED_FIELDS.has(k)) {
      warnings.push(`${k} is reserved and NOT enforced in this version — it is accepted for forward compatibility only`);
    } else {
      warnings.push(`unknown field "${k}" is ignored`);
    }
  }

  return { policy, errors, warnings };
}

export type PolicySource = { path: string; scope: "user" | "repo" };

/**
 * Merge user-level and repo-local policies. Repo-local wins per field
 * (a repository can tighten or loosen its own gate); `rules` merges per rule
 * id with repo-local overrides taking precedence.
 */
export function mergePolicies(user: PolicyV1, repo?: PolicyV1): PolicyV1 {
  if (!repo) return user;
  return {
    ...user,
    ...repo,
    rules: { ...(user.rules ?? {}), ...(repo.rules ?? {}) },
    // Arrays replace rather than union: a repo policy that sets its own
    // allowlist means exactly that list, not "mine plus whatever else".
  };
}

/** `example.com` matches exactly; `*.example.com` matches any subdomain and the apex. */
export function hostAllowed(host: string, allow: string[] = []): boolean {
  const h = host.toLowerCase();
  return allow.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith("*.")) {
      const domain = a.slice(1); // ".example.com"
      return h === a.slice(2) || h.endsWith(domain);
    }
    return h === a;
  });
}

/**
 * Apply a policy to findings:
 *  - drop rule ids listed in ignoreRules (or per-rule `enabled: false`)
 *  - rewrite severity where a per-rule override sets one
 * Policy filters what is SURFACED; the DB keeps the honest record.
 */
export function applyPolicy<T extends { ruleId: string; severity?: RiskSeverity }>(
  findings: T[],
  policy?: PolicyV1
): T[] {
  if (!policy) return findings;

  // A policy may address a rule by either id generation (AAA-* or AAC-*);
  // stored findings likewise carry whichever id they were written with.
  // Expand every referenced id to its full alias set once, up front.
  const aliases = (id: string): string[] => {
    const def = resolveRule(id);
    return def ? [def.id, ...def.legacyIds] : [id];
  };
  const ignore = new Set((policy.ignoreRules ?? []).flatMap(aliases));
  const overrides = new Map<string, RuleOverride>();
  for (const [id, o] of Object.entries(policy.rules ?? {})) {
    for (const a of aliases(id)) overrides.set(a, o);
  }

  const out: T[] = [];
  for (const f of findings) {
    if (ignore.has(f.ruleId)) continue;
    const o = overrides.get(f.ruleId);
    if (o?.enabled === false) continue;
    out.push(o?.severity && f.severity !== undefined ? { ...f, severity: o.severity } : f);
  }
  return out;
}

/**
 * True when any finding is at or above the policy's failOn severity. Used by the
 * `scan` command to set a non-zero exit code (CI / pre-flight gate). Default
 * threshold is "high" — high and critical fail, medium and below do not.
 */
export function hasBlockingFindings(
  findings: { severity: RiskSeverity }[],
  policy?: ConsolePolicy
): boolean {
  const failOn = policy?.failOn ?? "high";
  if (failOn === "never") return false;
  const threshold = SEVERITY_ORDER.indexOf(failOn);
  return findings.some((f) => SEVERITY_ORDER.indexOf(f.severity) >= threshold);
}
