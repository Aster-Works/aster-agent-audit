/**
 * Command classification (Phase 5). Pure TS — decides whether a shell command
 * is a TEST run or a GIT COMMIT so the normalized event can be reclassified
 * (test_result / git_event). Inspection only; nothing is ever executed.
 *
 * Robustness: a command may be a pipeline/sequence ("git add -A && git commit"),
 * and the word "commit" can appear in branch/file names ("git push origin
 * feature/commit-fixes") — so we split on shell separators and require that the
 * git SUBCOMMAND itself is `commit`, not merely that "commit" appears somewhere.
 */
import type { AgentEventType } from "./types";

/** Test runners we recognize, matched per command segment. */
const TEST_PATTERNS: RegExp[] = [
  /\bvitest\b/,
  /\bjest\b/,
  /\b(?:pnpm|npm|yarn|bun|npx)\s+(?:run\s+)?test\b/,
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test:/,
  /\bpytest\b/,
  /\bpy\.test\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\b(?:bundle\s+exec\s+)?rspec\b/,
  /\bmocha\b/,
  /\bava\b(?!\w)/,
  /\bphpunit\b/,
  /\bdotnet\s+test\b/,
  /\bmvn\s+(?:[\w:.-]+\s+)*test\b/,
  /\bgradle(?:w)?\s+(?:[\w:.-]+\s+)*test\b/,
  /\bunittest\b/,
  /\bgotestsum\b/,
];

const GIT_MUTATION_SUBCOMMANDS = new Set([
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "tag",
  "push",
]);

/** Split a command line into independent segments on shell separators. */
function segments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||;|\||&|\n)\s*/).filter((s) => s.trim().length > 0);
}

/**
 * The git subcommand of a single segment, e.g. "git -C /r commit -m x" -> "commit".
 * Returns undefined if the segment is not a git invocation. Skips leading env
 * assignments and global options (`-C <dir>` / `-c <kv>` take a value).
 */
function gitSubcommand(segment: string): string | undefined {
  const tokens = segment.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && /^\w+=/.test(tokens[i])) i++; // env prefix
  if (tokens[i] !== "git") return undefined;
  i++;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    if (tokens[i] === "-C" || tokens[i] === "-c") i += 2;
    else i += 1;
  }
  return tokens[i];
}

export function isTestCommand(command: string): boolean {
  if (!command) return false;
  return segments(command).some((seg) => TEST_PATTERNS.some((re) => re.test(seg)));
}

export function isCommitCommand(command: string): boolean {
  if (!command) return false;
  return segments(command).some((seg) => {
    if (gitSubcommand(seg) !== "commit") return false;
    return !/--dry-run\b|--help\b/.test(seg);
  });
}

export function isGitMutation(command: string): boolean {
  if (!command) return false;
  return segments(command).some((seg) => {
    const sub = gitSubcommand(seg);
    return sub != null && GIT_MUTATION_SUBCOMMANDS.has(sub);
  });
}

/**
 * Refine a post-execution command event into a more specific type.
 * Commit takes precedence over test: a commit whose message mentions a test
 * runner is still a commit.
 */
export function classifyCommand(command: string): AgentEventType | undefined {
  if (isCommitCommand(command)) return "git_event";
  if (isTestCommand(command)) return "test_result";
  return undefined;
}

export type TestOutcome = {
  ok: boolean;
  passed?: number;
  failed?: number;
};

/**
 * Best-effort parse of a test result from exit code and optional output.
 * A missing exit code is treated as a pass; parsed failure counts override a
 * zero exit code (some runners report failures but still exit 0).
 */
export function parseTestResult(exitCode?: number, output?: string): TestOutcome {
  const ok = exitCode == null ? true : exitCode === 0;
  const out: TestOutcome = { ok };
  if (!output) return out;

  const passed = matchNum(output, /(\d+)\s+passed/i) ?? matchNum(output, /(\d+)\s+passing/i);
  const failed = matchNum(output, /(\d+)\s+failed/i) ?? matchNum(output, /(\d+)\s+failing/i);
  if (passed != null) out.passed = passed;
  if (failed != null) out.failed = failed;
  if ((failed ?? 0) > 0) out.ok = false;
  return out;
}

function matchNum(s: string, re: RegExp): number | undefined {
  const m = s.match(re);
  return m ? Number(m[1]) : undefined;
}
