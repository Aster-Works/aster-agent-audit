/**
 * Filesystem layer for the MCP config scan (Phase 6). Discovers known MCP
 * config locations, reads and parses them (read-only, never executes), and runs
 * the pure scanner in `src/core/mcp.ts`. Results are cached briefly so repeated
 * dashboard API calls don't re-read disk on every request.
 *
 * Discovery paths mirror AsterGuard's `src/core/discovery.ts` (JSON configs
 * only). Codex uses TOML (`~/.codex/config.toml`) which AsterGuard also does not
 * parse — that is deferred, not silently dropped (see `note` in the summary is
 * out of scope; documented in HANDOFF.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentName, RiskFinding } from "../core/types";
import type { McpScanSummary, McpServer } from "../core/views";
import {
  extractServers,
  scanMcpServers,
  scoreFindings,
  type ScannedServerInput,
} from "../core/mcp";
import { applyPolicy, type ConsolePolicy } from "../core/policy";
import { DEFAULT_CONFIG_DIR } from "../db/index";

type Discovery = { rel: string; agent: AgentName; scope: "project" | "user" };

// JSON MCP config locations. `agent` is best-effort attribution for the map.
const PROJECT_CONFIGS: Discovery[] = [
  { rel: ".mcp.json", agent: "claude-code", scope: "project" },
  { rel: ".cursor/mcp.json", agent: "cursor", scope: "project" },
  { rel: ".vscode/mcp.json", agent: "unknown", scope: "project" },
  { rel: ".claude/settings.json", agent: "claude-code", scope: "project" },
  { rel: ".claude/settings.local.json", agent: "claude-code", scope: "project" },
];

const USER_CONFIGS: Discovery[] = [
  { rel: ".claude.json", agent: "claude-code", scope: "user" },
  { rel: ".claude/settings.json", agent: "claude-code", scope: "user" },
  { rel: ".cursor/mcp.json", agent: "cursor", scope: "user" },
  { rel: ".codeium/windsurf/mcp_config.json", agent: "unknown", scope: "user" },
  { rel: ".gemini/settings.json", agent: "gemini-cli", scope: "user" },
  {
    rel: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    agent: "unknown",
    scope: "user",
  },
];

export type DiscoveredConfig = { path: string; agent: AgentName };

/** Existing MCP config files under cwd (project) and home (user). */
export function discoverMcpConfigs(cwd = process.cwd(), home = homedir()): DiscoveredConfig[] {
  const out: DiscoveredConfig[] = [];
  const seen = new Set<string>();
  const add = (base: string, d: Discovery) => {
    const path = join(base, d.rel);
    if (seen.has(path) || !existsSync(path)) return;
    seen.add(path);
    out.push({ path, agent: d.agent });
  };
  for (const d of PROJECT_CONFIGS) add(cwd, d);
  for (const d of USER_CONFIGS) add(home, d);
  return out;
}

/** Load `${configDir}/policy.json`. Missing or malformed → empty policy. */
export function loadPolicy(configDir = DEFAULT_CONFIG_DIR): ConsolePolicy {
  const path = join(configDir, "policy.json");
  try {
    if (!existsSync(path)) return {};
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const policy: ConsolePolicy = {};
    if (Array.isArray(raw.allowedMcpHosts)) {
      policy.allowedMcpHosts = raw.allowedMcpHosts.filter((h): h is string => typeof h === "string");
    }
    if (Array.isArray(raw.ignoreRules)) {
      policy.ignoreRules = raw.ignoreRules.filter((r): r is string => typeof r === "string");
    }
    if (typeof raw.failOn === "string") policy.failOn = raw.failOn as ConsolePolicy["failOn"];
    return policy;
  } catch {
    return {};
  }
}

/**
 * Persist a rule id into `${configDir}/policy.json`'s ignoreRules so that rule's
 * findings (MCP config *and* event) stop surfacing on the Risk Radar. Advisory
 * only — the raw DB record is untouched (see policy.ts). Invalidates the scan
 * cache so the change is visible immediately. Returns the new ignore list.
 */
export function addIgnoreRule(ruleId: string, configDir = DEFAULT_CONFIG_DIR): string[] {
  const path = join(configDir, "policy.json");
  let raw: Record<string, unknown> = {};
  try {
    if (existsSync(path)) raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const existing = Array.isArray(raw.ignoreRules)
    ? (raw.ignoreRules as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  // Guard against junk ids; a rule id looks like AAC-SHELL-002 / AAC-MCP-004.
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(ruleId)) return existing;
  const next = existing.includes(ruleId) ? existing : [...existing, ruleId];
  raw.ignoreRules = next;
  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path, JSON.stringify(raw, null, 2));
  } catch {
    /* non-fatal: return the intended list even if the write failed */
  }
  invalidateMcpCache();
  return next;
}

export type McpEnvironmentScan = {
  servers: McpServer[];
  findings: RiskFinding[];
  summary: McpScanSummary;
  policy: ConsolePolicy;
};

export type ScanOptions = {
  cwd?: string;
  home?: string;
  configDir?: string;
  policy?: ConsolePolicy;
  /** override discovery with an explicit file list (tests / `scan <dir>`) */
  files?: DiscoveredConfig[];
};

function runScan(opts: ScanOptions): McpEnvironmentScan {
  const policy = opts.policy ?? loadPolicy(opts.configDir);
  const files = opts.files ?? discoverMcpConfigs(opts.cwd, opts.home);

  const inputs: ScannedServerInput[] = [];
  const scannedFiles: string[] = [];
  for (const { path, agent } of files) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue; // unreadable / invalid JSON — skip, never throw
    }
    const servers = extractServers(json);
    if (servers.length === 0) continue;
    scannedFiles.push(path.split("/").pop() || path);
    for (const server of servers) inputs.push({ server, agent, sourceFile: path });
  }

  const scan = scanMcpServers(inputs, policy.allowedMcpHosts ?? []);
  const findings = applyPolicy(scan.findings, policy);
  const { score, grade } = scoreFindings(findings);

  return {
    servers: scan.servers,
    findings,
    policy,
    summary: {
      serverCount: scan.servers.length,
      configFiles: [...new Set(scannedFiles)],
      score,
      grade,
      findings: findings.length,
    },
  };
}

// Short-lived cache: the dashboard hits assembleDataset on several endpoints and
// live-refreshes; re-reading a handful of small JSON files each time is wasteful.
// ponytail: process-lifetime memo with a 30s TTL, keyed by cwd. Time comes from
// Date.now() in a plain server process (not a workflow) — that's fine here.
let cache: { at: number; key: string; result: McpEnvironmentScan } | null = null;
const TTL_MS = 30_000;

/** Drop the cached scan so a policy change (e.g. a new ignore rule) is immediate. */
export function invalidateMcpCache(): void {
  cache = null;
}

export function scanMcpEnvironment(opts: ScanOptions = {}): McpEnvironmentScan {
  // Explicit file lists / injected policy bypass the cache (tests, scan <dir>).
  if (opts.files || opts.policy) return runScan(opts);
  const key = `${opts.cwd ?? process.cwd()}|${opts.home ?? homedir()}|${opts.configDir ?? DEFAULT_CONFIG_DIR}`;
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < TTL_MS) return cache.result;
  const result = runScan(opts);
  cache = { at: now, key, result };
  return result;
}
