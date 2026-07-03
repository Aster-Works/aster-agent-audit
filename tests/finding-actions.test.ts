import { describe, it, expect } from "vitest";
import { openDb } from "../src/db/index";
import type { NormalizedAgentEvent, RiskFinding } from "../src/core/types";

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
  return { db, findingId: "s1:risk_abc" }; // db stores id as `${sessionId}:${finding.id}`
}

describe("risk finding resolution (never deletes the record)", () => {
  it("resolve marks the finding resolved; reopen restores it", () => {
    const { db, findingId } = seed();
    expect(db.getRisk()[0].status).toBe("open");

    expect(db.setRiskStatus(findingId, "resolved")).toBe("s1");
    expect(db.getRisk()[0].status).toBe("resolved");
    // the underlying record is kept — resolving is not deleting
    expect(db.getEvents("s1")).toHaveLength(1);
    expect(db.getRisk()).toHaveLength(1);

    expect(db.setRiskStatus(findingId, "open")).toBe("s1");
    expect(db.getRisk()[0].status).toBe("open");
    db.close();
  });

  it("resolving a missing finding is a safe no-op", () => {
    const { db } = seed();
    expect(db.setRiskStatus("nope", "resolved")).toBeUndefined();
    expect(db.getRisk()[0].status).toBe("open"); // untouched
    db.close();
  });
});
