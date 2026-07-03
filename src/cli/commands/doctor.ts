import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import pc from "picocolors";
import { openDb } from "../../db/index";
import { CONFIG_DIR, DB_PATH, PORT, HOST } from "../util/paths";
import { detectAgents } from "../util/detect";
import { scanMcpEnvironment } from "../../server/mcp-scan";
import { brand, check, heading, line } from "../util/ui";

async function probeServer(port: number): Promise<"running" | "down"> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${HOST}:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? "running" : "down";
  } catch {
    return "down";
  }
}

export async function doctor(opts: { port?: number; db?: string } = {}): Promise<void> {
  const port = opts.port ?? PORT;
  const dbPath = opts.db ?? DB_PATH;
  let problems = 0;

  brand();
  heading("Environment");
  const major = Number(process.versions.node.split(".")[0]);
  const nodeOk = major >= 20;
  check(nodeOk, "Node.js ≥ 20", `v${process.versions.node}`);
  if (!nodeOk) problems++;

  heading("Local storage");
  let dirOk = true;
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    accessSync(CONFIG_DIR, constants.W_OK);
    check(true, "Config directory writable", CONFIG_DIR);
  } catch {
    dirOk = false;
    problems++;
    check(false, "Config directory writable", CONFIG_DIR);
  }

  if (dirOk) {
    try {
      const db = openDb(dbPath);
      const c = db.counts();
      db.close();
      check(true, "Database readable", `${dbPath} · ${c.sessions} sessions, ${c.events} events`);
    } catch (err) {
      problems++;
      check(false, "Database readable", String((err as Error).message));
    }
  }

  heading("Collector");
  const state = await probeServer(port);
  if (state === "running") {
    check(true, "Local server", `running at http://${HOST}:${port}`);
  } else {
    check("warn", "Local server", `not running · start with 'aster-agent dashboard'`);
  }
  check(true, "Bind address", `${HOST} only (no external access)`);

  heading("Agent integrations");
  const agents = detectAgents();
  for (const a of agents) {
    if (!a.present) {
      check("warn", a.label, "not detected on this machine");
    } else if (a.hookInstalled) {
      check(true, a.label, "hook installed");
    } else {
      check("warn", a.label, "detected · hook not installed (run `aster-agent init`)");
    }
  }

  heading("MCP security posture");
  try {
    const scan = scanMcpEnvironment({ configDir: CONFIG_DIR });
    if (scan.summary.serverCount === 0) {
      check("warn", "MCP config scan", "no MCP servers found");
    } else {
      const clean = scan.findings.length === 0;
      check(
        clean ? true : "warn",
        "MCP config scan",
        `${scan.summary.serverCount} server(s) · ${scan.findings.length} finding(s) · grade ${scan.summary.grade}` +
          `  ${pc.dim("(aster-agent scan for detail)")}`
      );
    }
  } catch {
    check("warn", "MCP config scan", "could not read MCP configuration");
  }

  heading("Summary");
  if (problems === 0) {
    line(`  ${pc.green("All core checks passed.")} ${pc.dim("Run `aster-agent dashboard` to view your console.")}`);
  } else {
    line(`  ${pc.red(`${problems} issue(s) found.`)} ${pc.dim("See the checks above.")}`);
    process.exitCode = 1;
  }
  line("");
}
