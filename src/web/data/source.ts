/**
 * Data source abstraction. Phase 1 returns the deterministic demo dataset.
 * Phase 2 adds a `live` source that fetches the collector API; screens consume
 * the same `Dataset` shape either way.
 */
import type { CollectorStatus } from "@core/types";
import type { Dataset } from "@core/views";
import {
  DEMO_TODAY,
  demoEventsBySession,
  demoFileChanges,
  demoMcpServers,
  demoPolicyEvents,
  demoRepoActivity,
  demoRisk,
  demoSessions,
} from "./demo";
import { buildOverview } from "@core/aggregate";

export const DEMO_STATUS: CollectorStatus = {
  mode: "demo",
  online: false,
  host: "127.0.0.1",
  port: 48321,
  dbPath: "~/.aster-agent-console/agent-console.db",
  spooledEvents: 0,
  lastEventAt: `${DEMO_TODAY}T11:14:30+09:00`,
};

/**
 * Fetch the live dataset from the local collector. Returns null when the DB is
 * empty (server responds `{ empty: true }`) or the collector is unreachable, so
 * the caller can fall back to demo data.
 */
export async function fetchLiveDataset(baseUrl = ""): Promise<Dataset | null> {
  try {
    const res = await fetch(`${baseUrl}/api/dataset`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Dataset | { empty: true };
    if ("empty" in json) return null;
    return json;
  } catch {
    return null;
  }
}

export function getDemoDataset(): Dataset {
  const overview = buildOverview(
    demoSessions,
    demoRisk,
    demoFileChanges,
    demoEventsBySession,
    {
      from: `${DEMO_TODAY}T00:00:00+09:00`,
      to: `${DEMO_TODAY}T23:59:59+09:00`,
      label: "Today",
    }
  );
  return {
    status: DEMO_STATUS,
    overview,
    sessions: demoSessions,
    eventsBySession: demoEventsBySession,
    fileChanges: demoFileChanges,
    risk: demoRisk,
    repoActivity: demoRepoActivity,
    mcpServers: demoMcpServers,
    policyEvents: demoPolicyEvents,
    mcpScan: {
      serverCount: demoMcpServers.length,
      configFiles: ["~/.claude.json", ".mcp.json"],
      score: 68,
      grade: "C",
      findings: demoMcpServers.filter((s) => s.risk !== "info" && s.risk !== "low").length,
    },
  };
}
