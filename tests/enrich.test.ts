import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type AgentConsoleDb } from "../src/db/index";
import { createEnricher, limitConcurrency } from "../src/server/enrich";
import { type GitRunner } from "../src/server/git";
import { fingerprint } from "@core/redaction";
import type { NormalizedAgentEvent } from "@core/types";

function fakeRunner(map: Record<string, { stdout: string; code?: number }>): GitRunner {
  return {
    async run(args) {
      const hit = map[args.join(" ")];
      return hit ? { stdout: hit.stdout, code: hit.code ?? 0 } : { stdout: "", code: 1 };
    },
  };
}

const TS = "2026-07-01T10:00:00.000Z";
let db: AgentConsoleDb;
let dir: string; // a REAL directory so the enricher's realpathSync guard passes

function baseEvent(p: Partial<NormalizedAgentEvent>): NormalizedAgentEvent {
  return {
    id: "evt",
    agent: "claude-code",
    source: "hook",
    type: "post_tool_use",
    sessionId: "s",
    repoPath: dir,
    cwd: dir,
    timestamp: TS,
    receivedAt: TS,
    title: "t",
    ...p,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  dir = mkdtempSync(join(tmpdir(), "aac-enrich-"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("git enrichment", () => {
  it("fills working-tree line counts for an edited file", async () => {
    const ev = baseEvent({ id: "evt_w1", sessionId: "s1", toolName: "Edit", title: "Edit src/a.ts", links: { files: ["src/a.ts"] } });
    db.upsertSession({ id: "s1", agent: "claude-code", startedAt: TS, repoPath: dir });
    db.insertEvent(ev);
    db.insertFileChange({
      id: `fc_${fingerprint(ev.id + "src/a.ts")}`,
      sessionId: "s1", eventId: ev.id, repoPath: dir, filePath: "src/a.ts",
      changeType: "modified", linesAdded: 0, linesDeleted: 0, agent: "claude-code", timestamp: TS,
    });
    db.recomputeSession("s1");

    const runner = fakeRunner({
      "rev-parse --is-inside-work-tree": { stdout: "true" },
      "-c core.quotePath=false diff --numstat HEAD -- src/a.ts": { stdout: "9\t2\tsrc/a.ts" },
    });
    await createEnricher(db, runner)(ev);

    const fc = db.getFileChanges().find((f) => f.filePath === "src/a.ts")!;
    expect(fc.linesAdded).toBe(9);
    expect(fc.linesDeleted).toBe(2);
  });

  it("associates a commit and supersedes the working-tree row", async () => {
    // A prior working-tree row for the same file should be replaced by the commit row.
    const writeEv = baseEvent({ id: "evt_w0", sessionId: "s2", toolName: "Edit", links: { files: ["src/x.ts"] } });
    db.upsertSession({ id: "s2", agent: "codex", startedAt: TS, repoPath: dir });
    db.insertEvent(writeEv);
    db.insertFileChange({
      id: `fc_${fingerprint("evt_w0src/x.ts")}`,
      sessionId: "s2", eventId: "evt_w0", repoPath: dir, filePath: "src/x.ts",
      changeType: "modified", linesAdded: 7, linesDeleted: 1, agent: "codex", timestamp: TS,
    });

    const ev = baseEvent({ id: "evt_g1", sessionId: "s2", agent: "codex", type: "git_event", toolName: "exec_command", title: "Git commit" });
    db.insertEvent(ev);
    db.recomputeSession("s2");

    const runner = fakeRunner({
      "rev-parse --is-inside-work-tree": { stdout: "true" },
      "-c core.quotePath=false show --numstat --format=%H%x00%s HEAD": { stdout: "deadbeef000 fix: guard nulls\n\n7\t1\tsrc/x.ts\n3\t0\tsrc/y.ts\n" },
      "rev-parse --abbrev-ref HEAD": { stdout: "feat/x" },
    });
    await createEnricher(db, runner)(ev);

    const commits = db.getGitCommits();
    expect(commits[0].sha).toBe("deadbee");
    expect(commits[0].branch).toBe("feat/x");

    // src/x.ts present exactly once (commit row superseded the working row).
    const xRows = db.getFileChanges().filter((f) => f.filePath === "src/x.ts");
    expect(xRows).toHaveLength(1);
    expect(xRows[0].linesAdded).toBe(7);

    const session = db.getSession("s2")!;
    expect(session.commits).toBe(1);
    expect(session.filesChanged).toBe(2); // distinct files: x.ts, y.ts
    expect(db.getEvents("s2").find((e) => e.id === "evt_g1")!.title).toBe("Commit: fix: guard nulls");
  });

  it("redacts a secret in the commit message before storing the title", async () => {
    const ev = baseEvent({ id: "evt_sec", sessionId: "s4", type: "git_event", title: "Git commit" });
    db.upsertSession({ id: "s4", agent: "claude-code", startedAt: TS, repoPath: dir });
    db.insertEvent(ev);
    const secret = "sk-ant-api03-AAAABBBBCCCCDDDD9999zzzz";
    const runner = fakeRunner({
      "rev-parse --is-inside-work-tree": { stdout: "true" },
      "-c core.quotePath=false show --numstat --format=%H%x00%s HEAD": { stdout: `c0ffee0000 rotate ${secret} now\n\n1\t0\t.env\n` },
      "rev-parse --abbrev-ref HEAD": { stdout: "main" },
    });
    await createEnricher(db, runner)(ev);

    const title = db.getEvents("s4").find((e) => e.id === "evt_sec")!.title;
    expect(title).not.toContain(secret);
    expect(title).toContain("Commit:");
    // git-graph message is derived from the stored title — also clean.
    expect(db.getGitCommits()[0].message).not.toContain(secret);
  });

  it("caps concurrent enrichment and still processes every event", async () => {
    let active = 0;
    let maxActive = 0;
    let done = 0;
    const slow = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 8));
      active--;
      done++;
    };
    const limited = limitConcurrency(slow, 2);
    for (let i = 0; i < 10; i++) limited(baseEvent({ id: `e${i}` }));
    await new Promise((r) => setTimeout(r, 250));
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(done).toBe(10);
  });

  it("is a no-op outside a git work tree", async () => {
    const ev = baseEvent({ id: "evt_n", sessionId: "s3", type: "git_event", title: "Git commit" });
    db.upsertSession({ id: "s3", agent: "claude-code", startedAt: TS, repoPath: dir });
    db.insertEvent(ev);
    const runner = fakeRunner({ "rev-parse --is-inside-work-tree": { stdout: "false" } });
    await createEnricher(db, runner)(ev);
    expect(db.getFileChanges()).toHaveLength(0);
    expect(db.getSession("s3")!.commits).toBe(0);
  });
});
