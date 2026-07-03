/**
 * Safe, read-only git integration (Phase 5).
 *
 * SAFETY:
 *  - Git is invoked with `execFile` and an ARGUMENT ARRAY — never a shell
 *    string — so command/path content cannot be interpreted as shell.
 *  - Only read-only verbs are used (rev-parse, diff, show). User-controlled
 *    file paths are passed after `--` as pathspecs, so a path starting with
 *    `-` cannot become an option.
 *  - The working directory is validated to exist before any call.
 *  - Every call has a hard timeout, an output cap, and disabled prompts/locks.
 *  - The collector NEVER runs commands from agent payloads — only these.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";

export interface GitRunner {
  /** Run `git <args>` in `cwd`. Resolves with stdout and the process code.
   *  Never rejects — failures surface as a non-zero code. */
  run(args: string[], cwd: string): Promise<{ stdout: string; code: number }>;
}

export type GitRunnerOptions = {
  timeoutMs?: number;
  maxBufferBytes?: number;
};

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };
}

/** Default runner backed by the real `git` binary. */
export function execFileGitRunner(opts: GitRunnerOptions = {}): GitRunner {
  const timeout = opts.timeoutMs ?? 2500;
  const maxBuffer = opts.maxBufferBytes ?? 4 * 1024 * 1024;
  return {
    run(args, cwd) {
      return new Promise((resolve) => {
        if (!isDirectory(cwd)) return resolve({ stdout: "", code: -1 });
        execFile(
          "git",
          args,
          { cwd, timeout, maxBuffer, windowsHide: true, env: gitEnv(), encoding: "utf8" },
          (err, stdout) => {
            if (err) {
              const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1;
              resolve({ stdout: stdout ?? "", code });
            } else {
              resolve({ stdout: stdout ?? "", code: 0 });
            }
          }
        );
      });
    },
  };
}

async function out(runner: GitRunner, args: string[], cwd: string): Promise<string | undefined> {
  const r = await runner.run(args, cwd);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

export async function isWorkTree(runner: GitRunner, dir: string): Promise<boolean> {
  return (await out(runner, ["rev-parse", "--is-inside-work-tree"], dir)) === "true";
}

export async function repoRoot(runner: GitRunner, dir: string): Promise<string | undefined> {
  return out(runner, ["rev-parse", "--show-toplevel"], dir);
}

export async function currentBranch(runner: GitRunner, dir: string): Promise<string | undefined> {
  const b = await out(runner, ["rev-parse", "--abbrev-ref", "HEAD"], dir);
  return b === "HEAD" ? "detached" : b;
}

export async function headSha(runner: GitRunner, dir: string): Promise<string | undefined> {
  return out(runner, ["rev-parse", "--short", "HEAD"], dir);
}

const NUMSTAT_LINE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

function isHex(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function sumNumstat(text: string): { added: number; deleted: number; files: { path: string; added: number; deleted: number }[] } {
  let added = 0;
  let deleted = 0;
  const files: { path: string; added: number; deleted: number }[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(NUMSTAT_LINE);
    if (!m) continue;
    const a = m[1] === "-" ? 0 : Number(m[1]);
    const d = m[2] === "-" ? 0 : Number(m[2]);
    added += a;
    deleted += d;
    files.push({ path: m[3], added: a, deleted: d });
  }
  return { added, deleted, files };
}

/** Working-tree line +/- for a single file (unstaged + staged). */
export async function numstatFile(
  runner: GitRunner,
  dir: string,
  file: string
): Promise<{ added: number; deleted: number }> {
  // Total working-tree change vs HEAD (staged + unstaged) in one diff, so a
  // fully-staged change is not double counted. core.quotePath=false keeps
  // non-ASCII paths verbatim.
  let r = await runner.run(["-c", "core.quotePath=false", "diff", "--numstat", "HEAD", "--", file], dir);
  if (r.code !== 0) {
    // No HEAD yet (empty repo): fall back to the index/working diff.
    r = await runner.run(["-c", "core.quotePath=false", "diff", "--numstat", "--", file], dir);
  }
  if (r.code !== 0) return { added: 0, deleted: 0 };
  const s = sumNumstat(r.stdout);
  return { added: s.added, deleted: s.deleted };
}

export type CommitInfo = {
  sha: string;
  message: string;
  branch?: string;
  files: { path: string; added: number; deleted: number }[];
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
};

/** Details (files + line stats) for HEAD — used for commit association. */
export async function lastCommit(runner: GitRunner, dir: string): Promise<CommitInfo | undefined> {
  // Format line is "<sha><sep><subject>"; sep is a NUL byte (%x00). We parse
  // the sha as the leading hex run and take the subject after one separator
  // char — robust to the NUL or any whitespace.
  const r = await runner.run(
    ["-c", "core.quotePath=false", "show", "--numstat", "--format=%H%x00%s", "HEAD"],
    dir
  );
  if (r.code !== 0 || !r.stdout) return undefined;
  const firstNl = r.stdout.indexOf("\n");
  const firstLine = firstNl < 0 ? r.stdout : r.stdout.slice(0, firstNl);
  const body = firstNl < 0 ? "" : r.stdout.slice(firstNl + 1);

  let i = 0;
  while (i < firstLine.length && isHex(firstLine[i])) i++;
  if (i < 7) return undefined;
  const sha = firstLine.slice(0, i);
  const message = firstLine.slice(i + 1).trim();

  const stat = sumNumstat(body);
  const branch = await currentBranch(runner, dir);
  return {
    sha: sha.slice(0, 7),
    message,
    branch,
    files: stat.files,
    filesChanged: stat.files.length,
    linesAdded: stat.added,
    linesDeleted: stat.deleted,
  };
}
