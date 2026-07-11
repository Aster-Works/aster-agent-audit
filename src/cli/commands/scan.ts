/**
 * `aster-audit scan [dir]` — scan local MCP configuration for security risks
 * (Phase 6). Read-only: discovers and inspects config files as text, never
 * executes anything. Exits non-zero when findings meet the policy's failOn
 * threshold, so it works as a CI / pre-flight gate.
 */
import { readFileSync, writeFileSync } from "node:fs";
import pc from "picocolors";
import { scanMcpEnvironment } from "../../server/mcp-scan";
import { toSarif } from "../../reporting/sarif";
import { hasBlockingFindings } from "../../core/policy";
import { CONFIG_DIR } from "../util/paths";
import { brand, heading, line, sym } from "../util/ui";
import type { RiskSeverity } from "../../core/types";

// Stamped by tsup; "dev" under tsx.
declare const __AAC_VERSION__: string;
const VERSION = typeof __AAC_VERSION__ === "string" ? __AAC_VERSION__ : "dev";

const SEV_COLOR: Record<RiskSeverity, (s: string) => string> = {
  critical: (s) => pc.red(pc.bold(s)),
  high: (s) => pc.red(s),
  medium: (s) => pc.yellow(s),
  low: (s) => pc.cyan(s),
  info: (s) => pc.dim(s),
};

const GRADE_COLOR: Record<string, (s: string) => string> = {
  A: pc.green,
  B: pc.green,
  C: pc.yellow,
  D: pc.red,
  F: (s) => pc.red(pc.bold(s)),
};

export type ScanCmdOptions = {
  format?: "text" | "json" | "sarif";
  /** Compare against a baseline file: only findings NOT in it gate the exit code. */
  baseline?: string;
  /** Write the current findings to the baseline file and exit 0. */
  updateBaseline?: string;
};

type BaselineFile = { version: 1; createdAt: string; findingIds: string[] };

export async function scanCmd(dir?: string, opts: ScanCmdOptions = {}): Promise<void> {
  const cwd = dir ?? process.cwd();
  const scan = scanMcpEnvironment({ cwd, configDir: CONFIG_DIR, fresh: true });

  // Baseline handling: finding ids are stable fingerprints of
  // rule+file+server+evidence, so they survive re-scans unchanged.
  if (opts.updateBaseline) {
    const doc: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      findingIds: scan.findings.map((f) => f.id).sort(),
    };
    writeFileSync(opts.updateBaseline, JSON.stringify(doc, null, 2) + "\n");
    console.error(`baseline written: ${opts.updateBaseline} (${doc.findingIds.length} finding(s))`);
    return;
  }
  let baselineIds: Set<string> | undefined;
  if (opts.baseline) {
    try {
      const doc = JSON.parse(readFileSync(opts.baseline, "utf8")) as BaselineFile;
      if (doc.version !== 1 || !Array.isArray(doc.findingIds)) throw new Error("unrecognized baseline shape");
      baselineIds = new Set(doc.findingIds);
    } catch (err) {
      console.error(
        `cannot read baseline ${opts.baseline}: ${(err as Error).message}\n` +
          `create one with: aster-audit scan --update-baseline ${opts.baseline}`
      );
      process.exitCode = 2;
      return;
    }
  }
  const newFindings = baselineIds ? scan.findings.filter((f) => !baselineIds.has(f.id)) : scan.findings;
  const gated = newFindings; // what the failOn threshold applies to

  if (opts.format === "sarif") {
    console.log(JSON.stringify(toSarif(scan.findings, { toolVersion: VERSION }), null, 2));
    if (hasBlockingFindings(gated, scan.policy)) process.exitCode = 1;
    return;
  }
  if (opts.format === "json") {
    console.log(
      JSON.stringify(
        {
          summary: scan.summary,
          servers: scan.servers,
          findings: scan.findings,
          baseline: opts.baseline ? { file: opts.baseline, known: baselineIds!.size, new: newFindings.length } : undefined,
        },
        null,
        2
      )
    );
    if (hasBlockingFindings(gated, scan.policy)) process.exitCode = 1;
    return;
  }

  brand();
  heading("MCP configuration scan");
  if (scan.summary.configFiles.length === 0) {
    line(`  ${sym.info} No MCP config files found under ${pc.dim(cwd)} or your home directory.`);
    line("");
    return;
  }
  line(`  ${sym.bullet} Scanned ${scan.summary.configFiles.join(", ")}`);
  line(
    `  ${sym.bullet} ${scan.summary.serverCount} server(s) · ${scan.findings.length} finding(s) · posture ` +
      `${(GRADE_COLOR[scan.summary.grade] ?? pc.white)(`${scan.summary.grade} (${scan.summary.score}/100)`)}`
  );

  heading("Servers");
  for (const s of scan.servers) {
    const mark = s.risk === "info" ? sym.ok : s.risk === "medium" || s.risk === "low" ? sym.warn : sym.fail;
    line(
      `  ${mark} ${pc.bold(s.name)} ${pc.dim(`[${s.transport}]`)} ${pc.dim(s.permissions.join(", "))}` +
        `  ${SEV_COLOR[s.risk](s.risk)}`
    );
    line(`      ${pc.dim(s.note)}`);
  }

  if (scan.findings.length > 0) {
    heading("Findings");
    const sorted = [...scan.findings].sort((a, b) => sevRank(b.severity) - sevRank(a.severity));
    for (const f of sorted) {
      line(`  ${SEV_COLOR[f.severity](f.severity.toUpperCase().padEnd(8))} ${pc.dim(f.ruleId)}  ${f.title}`);
      if (f.redactedEvidence) line(`      ${pc.dim("evidence:")} ${truncate(f.redactedEvidence, 100)}`);
      line(`      ${sym.arrow} ${pc.dim(f.recommendedAction)}`);
    }
  }

  if (baselineIds) {
    heading("Baseline");
    line(
      `  ${sym.bullet} ${baselineIds.size} known finding(s) in ${opts.baseline} · ` +
        (newFindings.length ? pc.yellow(`${newFindings.length} NEW`) : pc.green("no new findings"))
    );
  }

  const blocked = hasBlockingFindings(gated, scan.policy);
  heading("Result");
  if (scan.findings.length === 0) {
    line(`  ${pc.green("No MCP risks detected.")}`);
  } else if (blocked) {
    const threshold = scan.policy.failOn ?? "high";
    line(
      `  ${pc.red(`${baselineIds ? "New findings" : "Findings"} at or above '${threshold}'.`)} ` +
        pc.dim("Review the recommendations above.")
    );
    process.exitCode = 1;
  } else {
    line(`  ${pc.yellow("Findings recorded below the failOn threshold.")} ${pc.dim("Review when convenient.")}`);
  }
  line("");
}

function sevRank(s: RiskSeverity): number {
  return ["info", "low", "medium", "high", "critical"].indexOf(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
