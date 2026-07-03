/**
 * Assemble the full dashboard Dataset from the DB using the same core
 * aggregation the demo path uses. When there is real session activity it also
 * runs the local MCP config scan (Phase 6) and merges its findings into the Risk
 * Radar. Returns null on an empty DB so the client can fall back to demo data
 * (07 acceptance: "Demo mode still works when DB is empty").
 */
import { basename } from "node:path";
import type { CollectorStatus } from "../core/types";
import type { Dataset, PolicyEvent, RiskRow } from "../core/views";
import { buildOverview, buildRepoActivity } from "../core/aggregate";
import { applyPolicy } from "../core/policy";
import { scanMcpEnvironment } from "./mcp-scan";
import type { AgentConsoleDb } from "../db/index";

export function assembleDataset(db: AgentConsoleDb, status: CollectorStatus): Dataset | null {
  const sessions = db.getSessions();
  // Empty DB → null so the client falls back to demo (07 acceptance). The MCP
  // config scan augments an *active* dataset; the `scan`/`doctor` CLI covers the
  // no-sessions-yet pre-flight case headlessly.
  if (sessions.length === 0) return null;

  const mcp = scanMcpEnvironment();
  const scanTs = new Date().toISOString();
  // MCP findings live in memory (config scan = current state, not event history).
  const mcpRows: RiskRow[] = mcp.findings.map((f) => ({
    id: f.id,
    ruleId: f.ruleId,
    severity: f.severity,
    category: f.category,
    title: f.title,
    description: f.description,
    redactedEvidence: f.redactedEvidence,
    recommendedAction: f.recommendedAction,
    agent: "unknown",
    sessionId: "mcp-config-scan",
    timestamp: scanTs,
    status: "open",
  }));

  // ignoreRules also hides matching event findings, not just MCP ones.
  // Resolved findings are dismissed by the user → excluded from the radar.
  const dbRisk = applyPolicy(
    db.getRisk().filter((r) => r.status !== "resolved"),
    mcp.policy
  );
  const risk = [...mcpRows, ...dbRisk];

  const fileChanges = db.getFileChanges();
  const eventsBySession = db.getEventsBySession();
  const gitCommits = db.getGitCommits();

  const today = new Date().toISOString().slice(0, 10);
  const overview = buildOverview(sessions, risk, fileChanges, eventsBySession, {
    from: `${today}T00:00:00`,
    to: `${today}T23:59:59`,
    label: "Today",
  });

  const repo = sessions[0]?.repoPath ? basename(sessions[0].repoPath!) : "repository";
  const repoActivity = buildRepoActivity(repo, fileChanges, sessions, gitCommits, dbRisk);

  // Derive a policy timeline from the highest-severity findings.
  const policyEvents: PolicyEvent[] = [...risk]
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity))
    .slice(0, 12)
    .map((r) => ({
      id: `pol_${r.id}`,
      timestamp: r.timestamp,
      severity: r.severity,
      category: r.category,
      title: r.title,
      outcome:
        r.severity === "critical" || r.severity === "high"
          ? "blocked"
          : r.severity === "medium"
          ? "flagged"
          : "allowed",
    }));

  return {
    status,
    overview,
    sessions,
    eventsBySession,
    fileChanges,
    risk,
    repoActivity,
    mcpServers: mcp.servers,
    policyEvents,
    mcpScan: mcp.summary,
  };
}

function sevRank(s: RiskRow["severity"]): number {
  return ["info", "low", "medium", "high", "critical"].indexOf(s);
}
