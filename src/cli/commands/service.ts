/**
 * `aster-agent service install|uninstall|status` — run the collector as a
 * macOS launchd background agent so events are collected even when no dashboard
 * is open. On non-macOS, points the user at their own supervisor + `serve`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { CONFIG_DIR, PORT, HOST } from "../util/paths";
import { brand, check, heading, line, sym } from "../util/ui";

const LABEL = "com.asterworks.agent-console";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_PATH = join(CONFIG_DIR, "service.log");

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!
  );
}

/** Build the launchd plist. Pure + exported so it can be unit-tested. */
export function buildPlist(nodePath: string, cliPath: string, logPath: string): string {
  const args = [nodePath, cliPath, "serve"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

/** Resolve the real CLI entry (dist-cli/index.js) through the npm bin symlink. */
function cliEntry(): string {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
}

function ensureMac(): boolean {
  if (process.platform === "darwin") return true;
  line(`  ${sym.warn} The background service uses macOS launchd and is macOS-only.`);
  line(`  ${pc.dim("Elsewhere, run `aster-agent serve` under your own supervisor (systemd, pm2, …).")}`);
  return false;
}

export function serviceInstall(): void {
  brand();
  heading("Install background collector");
  if (!ensureMac()) return;

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Reload cleanly if it was already installed.
  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "ignore" });
  } catch {
    /* not loaded */
  }
  writeFileSync(PLIST_PATH, buildPlist(process.execPath, cliEntry(), LOG_PATH));
  try {
    execFileSync("launchctl", ["load", "-w", PLIST_PATH], { stdio: "ignore" });
    check(true, "launchd agent loaded", PLIST_PATH);
    line(`  ${sym.bullet} The collector runs in the background and starts at login.`);
    line(`  ${sym.bullet} Retains 30 days of history; older data is pruned automatically.`);
    line(`  ${sym.bullet} Logs: ${pc.dim(LOG_PATH)}`);
    line(`  ${sym.arrow} ${pc.dim("`aster-agent dashboard` reuses the running collector.")}`);
  } catch (err) {
    check(false, "launchctl load failed", String((err as Error).message));
    process.exitCode = 1;
  }
  line("");
}

export function serviceUninstall(): void {
  brand();
  heading("Remove background collector");
  if (!ensureMac()) return;
  if (!existsSync(PLIST_PATH)) {
    check("warn", "Not installed", "no launchd agent found");
    line("");
    return;
  }
  try {
    execFileSync("launchctl", ["unload", "-w", PLIST_PATH], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  try {
    rmSync(PLIST_PATH);
    check(true, "launchd agent removed", PLIST_PATH);
  } catch (err) {
    check(false, "Could not remove plist", String((err as Error).message));
  }
  line("");
}

export async function serviceStatus(): Promise<void> {
  brand();
  heading("Background collector");
  const installed = existsSync(PLIST_PATH);
  check(
    installed ? true : "warn",
    "launchd agent",
    installed ? PLIST_PATH : "not installed (run `aster-agent service install`)"
  );
  if (process.platform === "darwin" && installed) {
    try {
      const out = execFileSync("launchctl", ["list", LABEL], { encoding: "utf8" });
      const m = out.match(/"PID"\s*=\s*(\d+)/);
      check(Boolean(m), "Running", m ? `pid ${m[1]}` : "loaded but not running");
    } catch {
      check("warn", "Running", "not loaded");
    }
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`http://${HOST}:${PORT}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    check(res.ok, "Collector reachable", `http://${HOST}:${PORT}`);
  } catch {
    check("warn", "Collector reachable", `not responding on ${HOST}:${PORT}`);
  }
  line("");
}
