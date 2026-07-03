/**
 * Secret redaction. Runs BEFORE any DB persistence (02 §7). Raw secret values
 * are never stored — only a masked replacement, a non-reversible fingerprint,
 * the field path, and the kind. Pure TS (no Node built-ins) so it is safe to
 * import anywhere, including the browser bundle.
 */
import type { Redaction, RedactedJson, RedactionKind } from "./types";

type Pattern = {
  kind: RedactionKind;
  re: RegExp;
  /** keep this many trailing chars visible in the mask */
  keepTail?: number;
};

// Order matters: more specific patterns first.
const PATTERNS: Pattern[] = [
  { kind: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { kind: "api_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, keepTail: 4 },
  // Generic OpenAI keys incl. newer sk-proj-/sk-svcacct- formats (allow - and _).
  { kind: "api_key", re: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{18,}\b/g, keepTail: 4 },
  { kind: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, keepTail: 4 },
  { kind: "github_token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, keepTail: 4 },
  { kind: "supabase_key", re: /\bsb(?:p|s|secret)_[A-Za-z0-9_-]{20,}\b/g, keepTail: 4 },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, keepTail: 4 },
  { kind: "private_key", re: /\bAKIA[0-9A-Z]{16}\b/g, keepTail: 4 }, // AWS access key id
  { kind: "url_credential", re: /\b([a-z][a-z0-9+.-]*):\/\/[^/\s:@]+:([^/\s@]+)@/gi },
];

// .env-style assignments: API_KEY=..., SECRET=..., TOKEN=..., PASSWORD=...
const ENV_ASSIGN =
  /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE)[A-Z0-9_]*)\s*=\s*("?)([^"\s]{6,})\2/g;

/** FNV-1a 32-bit hash → 8 hex chars. Non-reversible identity for dedupe. */
export function fingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function mask(secret: string, kind: RedactionKind, keepTail = 0): string {
  if (kind === "private_key") return "-----BEGIN PRIVATE KEY----- ••• [redacted]";
  const tail = keepTail > 0 ? secret.slice(-keepTail) : "";
  const prefixMatch = secret.match(/^(sk-ant-|sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sbp_|sbs_|AKIA)/);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  return `${prefix}${"•".repeat(8)}${tail}`;
}

let counter = 0;
function rid(): string {
  counter = (counter + 1) % 1_000_000;
  return `red_${fingerprint(String(counter) + ":" + Date.now())}`;
}

/** Redact all secrets in a string, returning masked text + findings. */
export function redactString(input: string, fieldPath = "$"): {
  text: string;
  redactions: Redaction[];
} {
  if (!input) return { text: input, redactions: [] };
  let text = input;
  const redactions: Redaction[] = [];

  const apply = (re: RegExp, kind: RedactionKind, keepTail = 0, group?: number) => {
    text = text.replace(re, (match, ...args) => {
      const secret = group != null ? args[group - 1] : match;
      if (!secret) return match;
      const replacement = mask(secret, kind, keepTail);
      redactions.push({
        id: rid(),
        kind,
        fieldPath,
        fingerprint: fingerprint(secret),
        replacement,
      });
      // For url_credential we only replace the password group.
      return group != null ? match.replace(secret, replacement) : replacement;
    });
  };

  for (const p of PATTERNS) {
    if (p.kind === "url_credential") {
      apply(new RegExp(p.re.source, p.re.flags), p.kind, 0, 2);
    } else {
      apply(new RegExp(p.re.source, p.re.flags), p.kind, p.keepTail ?? 0);
    }
  }

  // env assignments — redact the value (group 3)
  text = text.replace(ENV_ASSIGN, (match, key, _q, value) => {
    if (!value) return match;
    redactions.push({
      id: rid(),
      kind: "env_value",
      fieldPath: `${fieldPath}.${key}`,
      fingerprint: fingerprint(value),
      replacement: "••••••",
    });
    return match.replace(value, "••••••");
  });

  return { text, redactions };
}

/** Recursively redact a JSON value, collecting findings with field paths. */
export function redactJson(value: unknown, path = "$"): RedactedJson {
  const redactions: Redaction[] = [];

  function walk(v: unknown, p: string): unknown {
    if (typeof v === "string") {
      const r = redactString(v, p);
      redactions.push(...r.redactions);
      return r.text;
    }
    if (Array.isArray(v)) {
      return v.map((item, i) => walk(item, `${p}[${i}]`));
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = walk(val, `${p}.${k}`);
      }
      return out;
    }
    return v;
  }

  const redacted = walk(value, path);
  return { value: redacted, redactions };
}

export function hasSecret(input: string): boolean {
  return redactString(input).redactions.length > 0;
}
