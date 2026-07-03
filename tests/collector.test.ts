import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type AgentConsoleDb } from "../src/db/index";
import { createCollector } from "../src/server/collector";

let db: AgentConsoleDb;

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => {
  db.close();
});

describe("collector + sqlite", () => {
  it("creates a session and event from a fake Claude Code event", () => {
    const collector = createCollector(db);
    const res = collector.ingest("claude-code", {
      session_id: "cc-1",
      cwd: "/repo",
      hook_event_name: "UserPromptSubmit",
      prompt: "Add a parser",
    });
    expect(res.ok).toBe(true);
    expect(db.counts().sessions).toBe(1);
    expect(db.counts().events).toBe(1);
    const session = db.getSession("cc-1");
    expect(session?.agent).toBe("claude-code");
    expect(session?.summary).toContain("Add a parser");
  });

  it("makes a fake Codex tool event visible in session events (Session Replay)", () => {
    const collector = createCollector(db);
    collector.ingest("codex", {
      session_id: "cx-1",
      turn_id: "t1",
      cwd: "/repo",
      hook_event_name: "PostToolUse",
      tool_name: "exec_command",
      tool_input: { cmd: "pnpm build" },
      tool_response: { exit_code: 0 },
    });
    const events = db.getEvents("cx-1");
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe("codex");
    expect(events[0].toolName).toBe("exec_command");
  });

  it("creates a Risk Radar finding from a dangerous shell command", () => {
    const collector = createCollector(db);
    const res = collector.ingest("codex", {
      session_id: "cx-2",
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      tool_name: "exec_command",
      tool_input: { cmd: "git push --force origin main" },
    });
    expect(res.risk).toBeGreaterThan(0);
    const risk = db.getRisk();
    expect(risk.some((r) => r.ruleId === "AAC-GIT-014")).toBe(true);
    const session = db.getSession("cx-2");
    expect(session?.riskCount).toBeGreaterThan(0);
    expect(session?.maxRiskSeverity).toBe("high");
  });

  it("redacts a secret BEFORE storage — no raw value lands in the DB", () => {
    const collector = createCollector(db);
    const rawSecret = "sk-ant-api03-RAWRAWRAWRAWRAWRAW9999zzzz";
    collector.ingest("claude-code", {
      session_id: "cc-3",
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: `export ANTHROPIC_API_KEY=${rawSecret}` },
    });
    // Scan every text column of every table for the raw secret.
    const dump = JSON.stringify([
      db.getEvents("cc-3"),
      db.getRisk(),
      db.getSessions(),
    ]);
    expect(dump).not.toContain(rawSecret);
    // The secret risk rule should still fire.
    expect(db.getRisk().some((r) => r.category === "secrets")).toBe(true);
  });

  it("counts a test_result with no exit code as a pass", () => {
    const collector = createCollector(db);
    collector.ingest("claude-code", {
      session_id: "cc-test",
      cwd: "/repo",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" }, // reclassified to test_result, no exit_code
    });
    const events = db.getEvents("cc-test");
    expect(events[0].type).toBe("test_result");
    expect(db.getSession("cc-test")?.testsPassed).toBe(1);
  });

  it("recomputes session aggregates (status completed on stop)", () => {
    const collector = createCollector(db);
    collector.ingest("claude-code", { session_id: "cc-4", hook_event_name: "SessionStart", cwd: "/repo" });
    collector.ingest("claude-code", { session_id: "cc-4", hook_event_name: "Stop", cwd: "/repo" });
    expect(db.getSession("cc-4")?.status).toBe("completed");
  });
});
