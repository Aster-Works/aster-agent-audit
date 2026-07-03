/**
 * Derived view-models consumed by the dashboard screens and returned by the
 * Phase 2 dashboard API. Kept separate from the canonical event schema
 * (`types.ts`) so the wire contract for the UI is explicit.
 */
import type {
  AgentName,
  AgentSession,
  CollectorStatus,
  FileChange,
  NormalizedAgentEvent,
  OverviewSnapshot,
  RiskCategory,
  RiskSeverity,
} from "./types";

/** A risk finding flattened with its session/agent/time context (Risk Radar). */
export type RiskRow = {
  id: string;
  ruleId: string;
  severity: RiskSeverity;
  category: RiskCategory;
  title: string;
  description: string;
  redactedEvidence?: string;
  recommendedAction: string;
  agent: AgentName;
  sessionId: string;
  eventId?: string;
  repoPath?: string;
  timestamp: string;
  status: "open" | "acknowledged" | "resolved";
};

export type HotFile = {
  filePath: string;
  churn: number;
  linesAdded: number;
  linesDeleted: number;
  edits: number;
  agents: AgentName[];
  maxRisk?: RiskSeverity;
};

export type TreemapNode = {
  name: string;
  path: string;
  churn: number;
  files: number;
  risk?: RiskSeverity;
};

export type GitCommitNode = {
  sha: string;
  message: string;
  agent: AgentName;
  branch: string;
  timestamp: string;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  testsPassed?: number;
  testsFailed?: number;
  isPrDraft?: boolean;
};

export type HeatCell = {
  /** day index 0..(weeks*7-1) */
  day: number;
  week: number;
  weekday: number;
  date: string;
  value: number;
};

export type RepoActivity = {
  repo: string;
  filesChanged: number;
  churn: number;
  commits: number;
  prDrafts: number;
  testsPassing: number;
  testsFailing: number;
  highRiskFilesTouched: number;
  treemap: TreemapNode[];
  hotFiles: HotFile[];
  gitTimeline: GitCommitNode[];
  heatmap: HeatCell[];
  contribution: { agent: AgentName; churn: number }[];
};

/** AsterGuard-style A–F posture grade for the scanned MCP configuration. */
export type Grade = "A" | "B" | "C" | "D" | "F";

/** Summary of the local MCP config scan surfaced in the Risk Radar header. */
export type McpScanSummary = {
  serverCount: number;
  /** basenames of the config files that were scanned */
  configFiles: string[];
  score: number;
  grade: Grade;
  findings: number;
};

export type McpPermission = "read" | "write" | "network" | "exec" | "secrets";

export type McpServer = {
  id: string;
  name: string;
  agent: AgentName;
  transport: "stdio" | "http" | "sse";
  permissions: McpPermission[];
  risk: RiskSeverity;
  note: string;
};

export type PolicyEvent = {
  id: string;
  timestamp: string;
  severity: RiskSeverity;
  category: RiskCategory;
  title: string;
  outcome: "allowed" | "flagged" | "blocked";
};

/** Everything a dashboard render needs, from either demo or live source. */
export type Dataset = {
  status: CollectorStatus;
  overview: OverviewSnapshot;
  sessions: AgentSession[];
  eventsBySession: Record<string, NormalizedAgentEvent[]>;
  fileChanges: FileChange[];
  risk: RiskRow[];
  repoActivity: RepoActivity;
  mcpServers: McpServer[];
  policyEvents: PolicyEvent[];
  /** Local MCP config scan posture (Phase 6). Optional for back-compat. */
  mcpScan?: McpScanSummary;
};
