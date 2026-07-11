/**
 * `aster-audit report --type <evidence|security> [--format html] [--out <file>]`
 *
 * Report types land incrementally:
 *   evidence — machine-readable bundle (events + chain hashes + findings + policy)
 *   security — MCP security posture; `--format html` renders a self-contained,
 *              print-ready page (use the browser's Print to PDF)
 * Anything else FAILS LOUDLY — a report command that pretends to succeed
 * would be worse than none.
 */
import { writeFileSync } from "node:fs";
import pc from "picocolors";
import { buildEvidenceBundle } from "../../server/evidence";
import { loadPolicyChain, scanMcpEnvironment } from "../../server/mcp-scan";
import { securityReportHtml } from "../../reporting/html";
import { openDb } from "../../db/index";
import { CONFIG_DIR, DB_PATH } from "../util/paths";
import { line } from "../util/ui";

// Stamped by tsup; "dev" under tsx.
declare const __AAC_VERSION__: string;
const VERSION = typeof __AAC_VERSION__ === "string" ? __AAC_VERSION__ : "dev";

const IMPLEMENTED = ["evidence", "security"] as const;

export function reportCmd(opts: { type?: string; format?: string; session?: string; out?: string; db?: string }): void {
  const type = opts.type ?? "evidence";
  if (!(IMPLEMENTED as readonly string[]).includes(type)) {
    console.error(
      `report --type ${type} is not implemented yet (available: ${IMPLEMENTED.join(", ")}). ` +
        `Nothing was generated.`
    );
    process.exitCode = 2;
    return;
  }

  if (type === "security") {
    const scan = scanMcpEnvironment({ configDir: CONFIG_DIR, fresh: true });
    const body =
      opts.format === "html"
        ? securityReportHtml(scan, { toolVersion: VERSION })
        : JSON.stringify({ summary: scan.summary, servers: scan.servers, findings: scan.findings }, null, 2);
    if (opts.out) {
      writeFileSync(opts.out, body);
      line(`${pc.green("✔")} Security report written to ${opts.out} ${pc.dim(`(${scan.findings.length} finding(s))`)}`);
    } else {
      console.log(body);
    }
    return;
  }

  const db = openDb(opts.db ?? DB_PATH);
  try {
    const chain = loadPolicyChain(CONFIG_DIR, process.cwd());
    const bundle = buildEvidenceBundle(db, {
      productVersion: VERSION,
      sessionId: opts.session,
      policy: { effective: chain.policy, sources: chain.sources },
    });
    const json = JSON.stringify(bundle, null, 2);
    if (opts.out) {
      writeFileSync(opts.out, json);
      line(
        `${pc.green("✔")} Evidence bundle written to ${opts.out} ` +
          pc.dim(`(${bundle.counts.sessions} sessions, ${bundle.counts.events} events, ${bundle.counts.findings} findings)`)
      );
    } else {
      console.log(json);
    }
  } finally {
    db.close();
  }
}
