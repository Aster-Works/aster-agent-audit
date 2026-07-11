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
import { existsSync, readFileSync } from "node:fs";
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
import {
  applyPolicy,
  mergePolicies,
  validatePolicy,
  type ConsolePolicy,
  type PolicySource,
  type PolicyV1,
} from "../core/policy";
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

export type LoadedPolicy = {
  policy: PolicyV1;
  sources: PolicySource[];
  errors: string[];
  warnings: string[];
};

/**
 * Load the policy chain with full validation:
 *   user level   `${configDir}/policy.json`
 *   repo local   `${repoDir}/.aster-audit/policy.json` (overrides per field)
 * A file with validation ERRORS is skipped (reported, never half-applied);
 * warnings are surfaced but the file is used.
 */
export function loadPolicyChain(configDir = DEFAULT_CONFIG_DIR, repoDir?: string): LoadedPolicy {
  const out: LoadedPolicy = { policy: {}, sources: [], errors: [], warnings: [] };

  const readOne = (path: string, scope: PolicySource["scope"]): PolicyV1 | undefined => {
    if (!existsSync(path)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      out.errors.push(`${path}: not valid JSON (${(err as Error).message})`);
      return undefined;
    }
    const v = validatePolicy(raw);
    out.warnings.push(...v.warnings.map((w) => `${path}: ${w}`));
    if (v.errors.length) {
      out.errors.push(...v.errors.map((e) => `${path}: ${e}`));
      return undefined; // never half-apply a broken file
    }
    out.sources.push({ path, scope });
    return v.policy;
  };

  const user = readOne(join(configDir, "policy.json"), "user") ?? {};
  const repo = repoDir ? readOne(join(repoDir, ".aster-audit", "policy.json"), "repo") : undefined;
  out.policy = mergePolicies(user, repo);
  return out;
}

/**
 * Load `${configDir}/policy.json`. Missing or malformed → empty policy.
 * Kept for existing callers; loadPolicyChain carries errors/warnings/sources.
 */
export function loadPolicy(configDir = DEFAULT_CONFIG_DIR): ConsolePolicy {
  return loadPolicyChain(configDir).policy;
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
