import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/index";
import { addIgnoreRule, loadPolicy } from "../src/server/mcp-scan";
import type { NormalizedAgentEvent, RiskFinding, FileChange } from "../src/core/types";

function seed() {
  const db = openDb(":memory:");
  db.upsertSession({ id: "s1", agent: "codex", startedAt: "2026-07-04T00:00:00Z" });
  const event: NormalizedAgentEvent = {
    id: "evt1",
    agent: "codex",
    source: "import",
    type: "post_tool_use",
    sessionId: "s1",
    repoPath: "/repo",
    timestamp: "2026-07-04T00:00:01Z",
    receivedAt: "2026-07-04T00:00:01Z",
    title: "cat .env",
  };
  db.insertEvent(event);
  const finding: RiskFinding = {
    id: "risk_abc",
    ruleId: "AAC-SECRET-001",
    severity: "high",
    category: "secrets",
    title: "Secret detected in tool input",
    description: "A secret was detected and redacted.",
    recommendedAction: "Rotate the secret.",
  };
  db.insertRisk(finding, { eventId: "evt1", sessionId: "s1", agent: "codex", repoPath: "/repo", timestamp: "2026-07-04T00:00:01Z" });
  const fc: FileChange = {
    id: "fc1", sessionId: "s1", eventId: "evt1", repoPath: "/repo", filePath: "/repo/.env",
    changeType: "modified", linesAdded: 0, linesDeleted: 0, agent: "codex", timestamp: "2026-07-04T00:00:01Z",
  };
  db.insertFileChange(fc);
  const findingId = "s1:risk_abc"; // db stores id as `${sessionId}:${finding.id}`
  return { db, findingId };
}

describe("risk finding actions", () => {
  it("resolve marks the finding resolved (kept, but dismissable)", () => {
    const { db, findingId } = seed();
    expect(db.getRisk()[0].status).toBe("open");
    const sid = db.setRiskStatus(findingId, "resolved");
    expect(sid).toBe("s1");
    expect(db.getRisk()[0].status).toBe("resolved");
    db.close();
  });

  it("delete removes just the finding and reports its event id", () => {
    const { db, findingId } = seed();
    const res = db.deleteRiskFinding(findingId);
    expect(res).toEqual({ sessionId: "s1", eventId: "evt1" });
    expect(db.getRisk()).toHaveLength(0);
    // the event itself is untouched by a plain finding delete
    expect(db.getEvents("s1")).toHaveLength(1);
    db.close();
  });

  it("purging the event removes the event, its finding, and its file changes", () => {
    const { db } = seed();
    const sid = db.deleteEvent("evt1");
    expect(sid).toBe("s1");
    expect(db.getEvents("s1")).toHaveLength(0);
    expect(db.getRisk()).toHaveLength(0);
    expect(db.getFileChanges()).toHaveLength(0);
    db.close();
  });

  it("acting on a missing finding is a safe no-op", () => {
    const { db } = seed();
    expect(db.setRiskStatus("nope", "resolved")).toBeUndefined();
    expect(db.deleteRiskFinding("nope")).toBeUndefined();
    expect(db.deleteEvent("nope")).toBeUndefined();
    expect(db.getRisk()).toHaveLength(1); // untouched
    db.close();
  });
});

describe("addIgnoreRule (mute a rule via policy.json)", () => {
  it("persists + dedupes rule ids and rejects junk", () => {
    const dir = mkdtempSync(join(tmpdir(), "aac-pol-"));
    try {
      expect(addIgnoreRule("AAC-MCP-004", dir)).toEqual(["AAC-MCP-004"]);
      expect(addIgnoreRule("AAC-MCP-004", dir)).toEqual(["AAC-MCP-004"]); // dedupe
      expect(addIgnoreRule("AAC-SHELL-002", dir)).toEqual(["AAC-MCP-004", "AAC-SHELL-002"]);
      expect(addIgnoreRule("bad id!!", dir)).toEqual(["AAC-MCP-004", "AAC-SHELL-002"]); // junk rejected
      expect(loadPolicy(dir).ignoreRules).toEqual(["AAC-MCP-004", "AAC-SHELL-002"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
