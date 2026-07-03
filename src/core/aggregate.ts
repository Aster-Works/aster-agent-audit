/**
 * Pure aggregation used by BOTH the dashboard (demo path) and the server (live
 * path). Keeping it in core guarantees demo and live compute identically.
 */
import type {
  ActivityPoint,
  AgentName,
  AgentRollup,
  AgentSession,
  FileChange,
  NormalizedAgentEvent,
  OverviewSnapshot,
  RiskCategory,
} from "./types";
import { RISK_CATEGORIES } from "./types";
import type {
  GitCommitNode,
  HeatCell,
  HotFile,
  RepoActivity,
  RiskRow,
  TreemapNode,
} from "./views";

// --- deterministic noise (sparklines / heatmaps) ---------------------------

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Real per-agent activity: event counts bucketed across the data's time span. */
export function activitySpark(
  events: NormalizedAgentEvent[],
  agent: AgentName,
  n = 14
): number[] {
  const ts = events
    .filter((e) => e.agent === agent)
    .map((e) => Date.parse(e.timestamp))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  const buckets = new Array<number>(n).fill(0);
  if (ts.length === 0) return buckets;
  const min = ts[0];
  const span = Math.max(1, ts[ts.length - 1] - min);
  for (const t of ts) {
    let i = Math.floor(((t - min) / span) * n);
    if (i >= n) i = n - 1;
    if (i < 0) i = 0;
    buckets[i] += 1;
  }
  return buckets;
}

// --- helpers ---------------------------------------------------------------

function repoName(p?: string): string {
  if (!p) return "unknown";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function hourBucket(iso: string): number {
  // Local wall-clock hour: server-side (live) uses the machine timezone, which
  // for this local-first tool is the user's own timezone.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : d.getHours();
}

function countToolCalls(
  session: AgentSession,
  events: NormalizedAgentEvent[] | undefined
): number {
  if (events && events.length) {
    const n = events.filter((e) => e.type === "pre_tool_use").length;
    if (n > 0) return n;
  }
  const files = session.filesChanged ?? 0;
  const tests = (session.testsPassed ?? 0) + (session.testsFailed ?? 0);
  return Math.max(1, Math.round(files * 2.5 + tests / 6 + (session.commits ?? 0)));
}

// --- overview --------------------------------------------------------------

export function buildOverview(
  sessions: AgentSession[],
  risk: RiskRow[],
  _fileChanges: FileChange[],
  eventsBySession: Record<string, NormalizedAgentEvent[]>,
  range = { from: "", to: "", label: "Today" }
): OverviewSnapshot {
  const agents: AgentName[] = ["claude-code", "codex"];
  const allEvents = Object.values(eventsBySession).flat();

  const perAgent: AgentRollup[] = agents.map((agent) => {
    const own = sessions.filter((s) => s.agent === agent);
    const sum = (f: (s: AgentSession) => number | undefined) =>
      own.reduce((acc, s) => acc + (f(s) ?? 0), 0);
    const testsPassed = sum((s) => s.testsPassed);
    const testsFailed = sum((s) => s.testsFailed);
    const toolCalls = own.reduce(
      (acc, s) => acc + countToolCalls(s, eventsBySession[s.id]),
      0
    );
    const completed = own.filter((s) => s.status === "completed").length;
    const successRate = own.length > 0 ? completed / own.length : 0;
    return {
      agent,
      sessions: own.length,
      tokens: sum((s) => s.totalTokens),
      costUsd: Math.round(sum((s) => s.estimatedCostUsd) * 100) / 100,
      filesChanged: sum((s) => s.filesChanged),
      toolCalls,
      commits: sum((s) => s.commits),
      testsPassed,
      testsFailed,
      riskFindings: risk.filter((r) => r.agent === agent).length,
      successRate,
      spark: activitySpark(allEvents, agent),
    };
  });

  const totals = {
    sessions: sessions.length,
    tokens: perAgent.reduce((a, r) => a + r.tokens, 0),
    costUsd: Math.round(perAgent.reduce((a, r) => a + r.costUsd, 0) * 100) / 100,
    filesChanged: perAgent.reduce((a, r) => a + r.filesChanged, 0),
    toolCalls: perAgent.reduce((a, r) => a + r.toolCalls, 0),
    riskFindings: risk.length,
    testsPassing: perAgent.reduce((a, r) => a + r.testsPassed, 0),
    testsFailing: perAgent.reduce((a, r) => a + r.testsFailed, 0),
    commits: perAgent.reduce((a, r) => a + r.commits, 0),
  };

  const hours = sessions.map((s) => hourBucket(s.startedAt));
  const minH = hours.length ? Math.min(...hours) : 6;
  const maxH = hours.length ? Math.max(...hours) : 12;
  const activitySeries: ActivityPoint[] = [];
  for (let h = minH; h <= maxH; h++) {
    const inHour = (iso: string) => hourBucket(iso) === h;
    const claude = sessions.filter((s) => s.agent === "claude-code" && inHour(s.startedAt)).length;
    const codex = sessions.filter((s) => s.agent === "codex" && inHour(s.startedAt)).length;
    const riskN = risk.filter((r) => inHour(r.timestamp)).length;
    activitySeries.push({
      t: `${String(h).padStart(2, "0")}:00`,
      label: `${String(h).padStart(2, "0")}:00`,
      claude,
      codex,
      risk: riskN,
    });
  }

  const repoMap = new Map<string, number>();
  for (const s of sessions) {
    const name = repoName(s.repoPath);
    repoMap.set(name, (repoMap.get(name) ?? 0) + (s.estimatedCostUsd ?? 0));
  }
  const costByRepo = [...repoMap.entries()]
    .map(([repo, costUsd]) => ({ repo, costUsd: Math.round(costUsd * 100) / 100 }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const riskByCategory: { category: RiskCategory; count: number }[] = RISK_CATEGORIES.map(
    (category) => ({ category, count: risk.filter((r) => r.category === category).length })
  );

  return {
    generatedAt: range.to || range.from || "",
    range,
    totals,
    perAgent,
    activitySeries,
    costByRepo,
    riskByCategory,
  };
}

// --- repo activity ---------------------------------------------------------

const SEV_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const RANK_SEV = ["info", "low", "medium", "high", "critical"] as const;

function topDir(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? filePath;
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

export function buildRepoActivity(
  repo: string,
  fileChanges: FileChange[],
  sessions: AgentSession[],
  gitCommits: GitCommitNode[],
  risk: RiskRow[]
): RepoActivity {
  const churn = fileChanges.reduce((a, f) => a + f.linesAdded + f.linesDeleted, 0);
  const files = new Set(fileChanges.map((f) => f.filePath));

  // hot files
  const byFile = new Map<string, HotFile>();
  for (const f of fileChanges) {
    const cur =
      byFile.get(f.filePath) ??
      ({ filePath: f.filePath, churn: 0, linesAdded: 0, linesDeleted: 0, edits: 0, agents: [] } as HotFile);
    cur.linesAdded += f.linesAdded;
    cur.linesDeleted += f.linesDeleted;
    cur.churn += f.linesAdded + f.linesDeleted;
    cur.edits += 1;
    if (!cur.agents.includes(f.agent)) cur.agents.push(f.agent);
    byFile.set(f.filePath, cur);
  }
  const hotFiles = [...byFile.values()].sort((a, b) => b.churn - a.churn).slice(0, 12);

  // treemap by top dir
  const byDir = new Map<string, { churn: number; files: Set<string>; rank: number }>();
  for (const f of fileChanges) {
    const dir = topDir(f.filePath);
    const cur = byDir.get(dir) ?? { churn: 0, files: new Set<string>(), rank: 0 };
    cur.churn += f.linesAdded + f.linesDeleted;
    cur.files.add(f.filePath);
    byDir.set(dir, cur);
  }
  const treemap: TreemapNode[] = [...byDir.entries()]
    .map(([path, v]) => ({
      name: path,
      path,
      churn: v.churn,
      files: v.files.size,
      risk: RANK_SEV[v.rank] as TreemapNode["risk"],
    }))
    .sort((a, b) => b.churn - a.churn);

  // contribution by agent
  const contribMap = new Map<AgentName, number>();
  for (const f of fileChanges) {
    contribMap.set(f.agent, (contribMap.get(f.agent) ?? 0) + f.linesAdded + f.linesDeleted);
  }
  const contribution = [...contribMap.entries()].map(([agent, c]) => ({ agent, churn: c }));

  const testsPassing = sessions.reduce((a, s) => a + (s.testsPassed ?? 0), 0);
  const testsFailing = sessions.reduce((a, s) => a + (s.testsFailed ?? 0), 0);
  const highRisk = risk.filter((r) => SEV_RANK[r.severity] >= 3).length;

  return {
    repo,
    filesChanged: files.size,
    churn,
    commits: gitCommits.length,
    prDrafts: gitCommits.filter((c) => c.isPrDraft).length,
    testsPassing,
    testsFailing,
    highRiskFilesTouched: highRisk,
    treemap,
    hotFiles,
    gitTimeline: gitCommits,
    heatmap: buildHeatmapFrom(fileChanges),
    contribution,
  };
}

function buildHeatmapFrom(fileChanges: FileChange[]): HeatCell[] {
  const weeks = 18;
  const cells: HeatCell[] = [];
  const counts = new Map<string, number>();
  for (const f of fileChanges) {
    const day = f.timestamp.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - (weeks * 7 - 1));
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = d.toISOString().slice(0, 10);
    cells.push({
      day: i,
      week: Math.floor(i / 7),
      weekday: i % 7,
      date,
      value: counts.get(date) ?? 0,
    });
  }
  return cells;
}
