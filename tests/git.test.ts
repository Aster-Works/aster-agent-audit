import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GitRunner,
  isWorkTree,
  numstatFile,
  lastCommit,
  currentBranch,
  execFileGitRunner,
} from "../src/server/git";

/** Fake runner that returns canned output keyed by the joined args. */
function fakeRunner(map: Record<string, { stdout: string; code?: number }>): GitRunner {
  return {
    async run(args) {
      const key = args.join(" ");
      const hit = map[key];
      if (hit) return { stdout: hit.stdout, code: hit.code ?? 0 };
      return { stdout: "", code: 1 };
    },
  };
}

describe("git helpers (fake runner)", () => {
  it("detects a work tree", async () => {
    const r = fakeRunner({ "rev-parse --is-inside-work-tree": { stdout: "true\n" } });
    expect(await isWorkTree(r, "/x")).toBe(true);
    const r2 = fakeRunner({});
    expect(await isWorkTree(r2, "/x")).toBe(false);
  });

  it("reads working-tree numstat vs HEAD and treats binary as 0", async () => {
    const r = fakeRunner({
      "-c core.quotePath=false diff --numstat HEAD -- a.ts": { stdout: "15\t3\ta.ts\n" },
    });
    expect(await numstatFile(r, "/x", "a.ts")).toEqual({ added: 15, deleted: 3 });

    const bin = fakeRunner({
      "-c core.quotePath=false diff --numstat HEAD -- img.png": { stdout: "-\t-\timg.png\n" },
    });
    expect(await numstatFile(bin, "/x", "img.png")).toEqual({ added: 0, deleted: 0 });
  });

  it("falls back to a plain diff when there is no HEAD (empty repo)", async () => {
    const r = fakeRunner({
      "-c core.quotePath=false diff --numstat -- new.ts": { stdout: "4\t0\tnew.ts\n" },
    });
    expect(await numstatFile(r, "/x", "new.ts")).toEqual({ added: 4, deleted: 0 });
  });

  it("parses last commit files + stats", async () => {
    const show = "abc1234567890 feat: add parser\n\n12\t3\tsrc/a.ts\n4\t0\tsrc/b.ts\n";
    const r = fakeRunner({
      "-c core.quotePath=false show --numstat --format=%H%x00%s HEAD": { stdout: show },
      "rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
    });
    const c = await lastCommit(r, "/x");
    expect(c?.sha).toBe("abc1234");
    expect(c?.message).toBe("feat: add parser");
    expect(c?.filesChanged).toBe(2);
    expect(c?.linesAdded).toBe(16);
    expect(c?.linesDeleted).toBe(3);
    expect(c?.branch).toBe("main");
  });

  it("returns code -1 for a non-existent directory (no throw)", async () => {
    const real = execFileGitRunner({ timeoutMs: 1000 });
    const res = await real.run(["rev-parse", "--is-inside-work-tree"], "/no/such/dir/xyz");
    expect(res.code).not.toBe(0);
  });
});

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasGit())("git helpers (real repo)", () => {
  it("reads real commit stats and working-tree diffs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aac-git-"));
    const run = (args: string[]) =>
      execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    try {
      run(["init", "-q"]);
      run(["config", "user.email", "test@example.com"]);
      run(["config", "user.name", "Test"]);
      run(["config", "commit.gpgsign", "false"]);
      writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\n");
      run(["add", "a.txt"]);
      run(["commit", "-q", "-m", "feat: initial"]);

      const runner = execFileGitRunner({ timeoutMs: 3000 });
      expect(await isWorkTree(runner, dir)).toBe(true);
      expect(typeof (await currentBranch(runner, dir))).toBe("string");

      const commit = await lastCommit(runner, dir);
      expect(commit?.message).toBe("feat: initial");
      expect(commit?.files.some((f) => f.path === "a.txt")).toBe(true);
      expect(commit?.linesAdded).toBe(3);

      // Edit the file but don't commit → working-tree numstat reflects it.
      writeFileSync(join(dir, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
      const ns = await numstatFile(runner, dir, "a.txt");
      expect(ns.added).toBe(2);
      expect(ns.deleted).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
