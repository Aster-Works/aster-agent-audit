/**
 * Collector: the safe ingestion pipeline. For each incoming hook payload it
 * normalizes → redacts (inside normalize) → detects risk → persists → broadcasts.
 * Incoming commands are NEVER executed. Secrets are redacted before they reach
 * the DB. A malformed payload degrades to a best-effort event, never a throw.
 */
import type { AgentName, FileChange, NormalizedAgentEvent, RiskFinding } from "../core/types";
import { normalizeHookEvent } from "../core/normalize";
import { detectEventRisks } from "../core/risk";
import { fingerprint } from "../core/redaction";
import type { AgentConsoleDb } from "../db/index";

export type LiveMessage = {
  kind: "event";
  event: NormalizedAgentEvent;
  risk: RiskFinding[];
};

export type IngestResult = {
  ok: true;
  eventId: string;
  sessionId: string;
  risk: number;
  redactions: number;
};

export type Enricher = (event: NormalizedAgentEvent) => Promise<void>;

export function createCollector(
  db: AgentConsoleDb,
  emit?: (msg: LiveMessage) => void,
  enrich?: Enricher
) {
  function ingest(agentHint: AgentName, payload: unknown): IngestResult {
    const { event, secretKinds, files } = normalizeHookEvent(agentHint, payload);
    const findings = detectEventRisks(
      event,
      event.input?.value as Record<string, unknown> | undefined,
      secretKinds
    );
    if (findings.length) event.risk = findings;

    db.upsertSession({
      id: event.sessionId,
      agent: event.agent,
      startedAt: event.timestamp,
      repoPath: event.repoPath,
      cwd: event.cwd,
      model: event.model,
      summary: event.type === "user_prompt" ? event.title : undefined,
    });

    db.insertEvent(event);

    for (const f of findings) {
      db.insertRisk(f, {
        eventId: event.id,
        sessionId: event.sessionId,
        agent: event.agent,
        repoPath: event.repoPath,
        timestamp: event.timestamp,
      });
    }

    // Record a file_change for write-style tool calls (lightweight; git
    // enrichment with real diff stats is Phase 5).
    const isWrite = /write|edit|create|append|multiedit/i.test(event.toolName ?? "");
    if (isWrite && files.length && event.repoPath) {
      for (const filePath of files) {
        const fc: FileChange = {
          id: `fc_${fingerprint(event.id + filePath)}`,
          sessionId: event.sessionId,
          eventId: event.id,
          repoPath: event.repoPath,
          filePath,
          changeType: "modified",
          linesAdded: 0,
          linesDeleted: 0,
          agent: event.agent,
          timestamp: event.timestamp,
        };
        db.insertFileChange(fc);
      }
    }

    db.recomputeSession(event.sessionId);

    emit?.({ kind: "event", event, risk: findings });

    // Git enrichment runs off the request path so it never blocks the agent.
    if (enrich) void enrich(event).catch(() => {});

    return {
      ok: true,
      eventId: event.id,
      sessionId: event.sessionId,
      risk: findings.length,
      redactions: secretKinds.length,
    };
  }

  return { ingest };
}
