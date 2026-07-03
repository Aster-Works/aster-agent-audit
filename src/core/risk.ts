/**
 * Risk engine (02 §8). Deterministic, rule-based detection of dangerous shell
 * commands, secret exposure, risky file access and destructive git operations.
 * Findings carry an evidence string that is itself redacted, plus a concrete
 * recommended action. Commands are NEVER executed — only inspected as text.
 */
import type {
  NormalizedAgentEvent,
  RiskCategory,
  RiskFinding,
  RiskSeverity,
} from "./types";
import { fingerprint, redactString } from "./redaction";

type CommandRule = {
  ruleId: string;
  category: RiskCategory;
  severity: RiskSeverity;
  title: string;
  test: RegExp;
  describe: string;
  action: string;
  /** Optional escalation: bump severity when this matches too. */
  escalateTo?: RiskSeverity;
  escalateWhen?: RegExp;
};

const COMMAND_RULES: CommandRule[] = [
  {
    ruleId: "AAC-GIT-014",
    category: "git",
    severity: "high",
    title: "Force push to a branch",
    test: /\bgit\s+push\b[^\n|;&]*\s(?:--force\b|-f\b|--force-with-lease)/,
    describe:
      "A git force push was detected. Force pushes rewrite history and can destroy others' work.",
    action:
      "Prefer --force-with-lease against a feature branch, never a protected branch. Confirm with a human before rewriting shared history.",
  },
  {
    ruleId: "AAC-SHELL-002",
    category: "shell",
    severity: "high",
    title: "Recursive force delete",
    test: /\brm\s+(?:-[a-zA-Z]*\s+)*-?[a-zA-Z]*(?:rf|fr)\b|\brm\s+-r\w*\s+-f|\brm\s+-f\w*\s+-r/,
    describe:
      "A recursive force-delete (rm -rf) was detected. This can remove an unexpected tree if the path is empty or interpolated.",
    action:
      "Scope deletes to an explicit, repo-relative path. Guard interpolated variables (set -u) and avoid rm -rf on wildcards.",
    escalateTo: "critical",
    escalateWhen: /\brm\s+-[a-zA-Z]*[rf]+[a-zA-Z]*\s+(?:\/\s|\/$|\/\*|~|\$[A-Z_]|\*)/,
  },
  {
    ruleId: "AAC-SHELL-005",
    category: "shell",
    severity: "high",
    title: "Pipe remote script to a shell",
    test: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish)\b/,
    describe:
      "A remote script is piped directly into a shell (curl | sh). The fetched code is executed unreviewed.",
    action:
      "Download the script, review it, then run it explicitly. Never pipe an untrusted URL straight into a shell.",
  },
  {
    ruleId: "AAC-SHELL-008",
    category: "shell",
    severity: "critical",
    title: "Write to a raw block device",
    test: /\bdd\b[^\n]*\bof=\/dev\/|\bmkfs\b|>\s*\/dev\/sd[a-z]/,
    describe: "A command writes directly to a block device or formats a filesystem.",
    action: "Do not run. Verify the target device explicitly; this can destroy a disk.",
  },
  {
    ruleId: "AAC-SHELL-011",
    category: "shell",
    severity: "critical",
    title: "Fork bomb",
    test: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    describe: "A fork bomb pattern was detected, which can exhaust system resources.",
    action: "Do not run. Remove this command.",
  },
  {
    ruleId: "AAC-GIT-002",
    category: "git",
    severity: "low",
    title: "Hard reset discards working changes",
    test: /\bgit\s+reset\s+--hard\b/,
    describe: "git reset --hard discards uncommitted changes in the working tree.",
    action: "Prefer git stash to preserve work. Confirm there are no unsaved edits first.",
  },
  {
    ruleId: "AAC-GIT-007",
    category: "git",
    severity: "medium",
    title: "Clean removes untracked files",
    test: /\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d|\bgit\s+clean\s+-[a-zA-Z]*d[a-zA-Z]*f/,
    describe: "git clean -fd permanently removes untracked files and directories.",
    action: "Run with --dry-run (-n) first to review what would be deleted.",
  },
  {
    ruleId: "AAC-SHELL-009",
    category: "shell",
    severity: "low",
    title: "Permissive file mode (chmod 777)",
    test: /\bchmod\s+(?:-R\s+)?0?777\b/,
    describe: "A world-writable permission mode was applied, allowing any local user to modify the file.",
    action: "Use least-privilege modes (e.g. 755 for executables). Avoid 777 in shared environments.",
  },
  {
    ruleId: "AAC-SHELL-013",
    category: "shell",
    severity: "low",
    title: "Privileged command (sudo)",
    test: /(^|\s)sudo\s+/,
    describe: "A command runs with elevated privileges.",
    action: "Confirm the command needs root. Avoid running agent tool calls under sudo.",
    escalateTo: "high",
    escalateWhen: /sudo\s+(?:rm\b|dd\b|chmod\b|chown\b)/,
  },
];

function makeFinding(
  ruleId: string,
  category: RiskCategory,
  severity: RiskSeverity,
  title: string,
  description: string,
  action: string,
  evidence: string
): RiskFinding {
  const redactedEvidence = redactString(evidence).text;
  return {
    id: `risk_${fingerprint(ruleId + ":" + evidence)}`,
    ruleId,
    category,
    severity,
    title,
    description,
    recommendedAction: action,
    redactedEvidence,
  };
}

/** Inspect a shell command string for dangerous patterns. */
export function detectCommandRisks(command: string): RiskFinding[] {
  if (!command) return [];
  const out: RiskFinding[] = [];
  for (const rule of COMMAND_RULES) {
    if (rule.test.test(command)) {
      let severity = rule.severity;
      if (rule.escalateWhen && rule.escalateTo && rule.escalateWhen.test(command)) {
        severity = rule.escalateTo;
      }
      out.push(
        makeFinding(rule.ruleId, rule.category, severity, rule.title, rule.describe, rule.action, command)
      );
    }
  }
  return out;
}

const SECRET_FILE = /(^|\/)\.env(\.[\w.-]+)?$|id_rsa|id_ed25519|\.pem$|\.p12$|credentials(\.json)?$|\.aws\/|\.ssh\/|secrets?\.(json|ya?ml|toml)$/i;

/** Inspect a file access (read/write) for risky targets. */
export function detectFileRisks(
  action: "read" | "write",
  filePath: string,
  repoPath?: string
): RiskFinding[] {
  const out: RiskFinding[] = [];
  if (!filePath) return out;

  if (SECRET_FILE.test(filePath)) {
    out.push(
      makeFinding(
        "AAC-SECRET-004",
        "secrets",
        action === "write" ? "medium" : "info",
        `${action === "write" ? "Write to" : "Read of"} a likely secret file`,
        `A tool ${action === "write" ? "wrote to" : "read"} ${filePath}, which commonly holds credentials.`,
        "Confirm the file is git-ignored and its values stay local. Avoid passing them inline to other tools.",
        filePath
      )
    );
  }

  if (action === "write" && repoPath && !isInside(filePath, repoPath)) {
    out.push(
      makeFinding(
        "AAC-FILE-005",
        "files",
        "medium",
        "Write outside repository root",
        `A write targeted ${filePath}, which is outside the repository root. Such writes are not covered by version control or review.`,
        "Keep generated artifacts inside the repo or an ignored temp dir. Confirm any write to user config directories.",
        filePath
      )
    );
  }
  return out;
}

function isInside(filePath: string, repoPath: string): boolean {
  const f = normalize(filePath);
  const r = normalize(repoPath).replace(/\/+$/, "");
  // Relative paths are assumed repo-relative.
  if (!f.startsWith("/") && !f.startsWith("~")) return true;
  return f === r || f.startsWith(r + "/");
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Top-level: derive all risk findings for a normalized event, pulling the
 * command from common tool-input shapes and folding in secret findings from
 * redaction.
 */
export function detectEventRisks(
  event: NormalizedAgentEvent,
  rawInput?: Record<string, unknown>,
  secretKinds?: string[]
): RiskFinding[] {
  const out: RiskFinding[] = [];
  const input = rawInput ?? (event.input?.value as Record<string, unknown> | undefined) ?? {};

  const command = pickString(input, ["command", "cmd", "script"]);
  if (command) out.push(...detectCommandRisks(command));

  const tool = (event.toolName ?? "").toLowerCase();
  const filePath = pickString(input, ["file_path", "path", "filePath", "target"]);
  if (filePath) {
    const action: "read" | "write" = /write|edit|create|append/.test(tool) ? "write" : "read";
    out.push(...detectFileRisks(action, filePath, event.repoPath));
  }

  if (secretKinds && secretKinds.length) {
    const kindList = [...new Set(secretKinds)].join(", ");
    out.push(
      makeFinding(
        "AAC-SECRET-001",
        "secrets",
        secretKinds.includes("private_key") || secretKinds.some((k) => k.includes("key"))
          ? "critical"
          : "high",
        "Secret detected in tool input",
        `A secret (${kindList}) was detected in tool input and redacted before storage. No raw value was persisted.`,
        "Rotate the exposed secret and move it to a local .env that is never passed inline to tools.",
        command || filePath || event.title
      )
    );
  }

  // De-duplicate by ruleId+severity to avoid noisy repeats.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.ruleId}:${f.severity}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

export function maxSeverity(findings: { severity: RiskSeverity }[]): RiskSeverity | undefined {
  const order: RiskSeverity[] = ["info", "low", "medium", "high", "critical"];
  let best = -1;
  for (const f of findings) best = Math.max(best, order.indexOf(f.severity));
  return best >= 0 ? order[best] : undefined;
}

/** Read-only catalog of the active command-risk rules (for the Settings UI). */
export function riskRuleCatalog(): { ruleId: string; category: RiskCategory; severity: RiskSeverity; title: string }[] {
  return COMMAND_RULES.map((r) => ({ ruleId: r.ruleId, category: r.category, severity: r.severity, title: r.title }));
}
