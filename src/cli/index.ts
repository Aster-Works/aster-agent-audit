#!/usr/bin/env node
/**
 * aster-agent CLI (Phase 3).
 *
 *   aster-agent dashboard      start the local console and open the browser
 *   aster-agent doctor         check local health
 *   aster-agent init [--dry-run]   set up local files and detect agents
 *
 * The server binds to 127.0.0.1 only and never executes incoming commands.
 */
import { Command } from "commander";
import { dashboard } from "./commands/dashboard";
import { doctor } from "./commands/doctor";
import { init } from "./commands/init";
import { scanCmd } from "./commands/scan";
import { hooksStatusCmd, hooksUninstallCmd, installHooksCmd } from "./commands/hooks";

const program = new Command();

program
  .name("aster-agent")
  .description("Local-first AI coding agent safety, work audit, and outcome console")
  .version("0.1.0");

const port = (v: string) => Number.parseInt(v, 10);

program
  .command("dashboard")
  .description("Start the local server, serve the dashboard, and open the browser")
  .option("-p, --port <number>", "port to bind on 127.0.0.1", port)
  .option("--db <path>", "path to the SQLite database")
  .option("--no-open", "do not open the browser automatically")
  .action((opts) => dashboard({ port: opts.port, db: opts.db, open: opts.open }));

program
  .command("doctor")
  .description("Check Node version, storage, collector health, and hook status")
  .option("-p, --port <number>", "collector port to probe", port)
  .option("--db <path>", "path to the SQLite database")
  .action((opts) => doctor({ port: opts.port, db: opts.db }));

program
  .command("init")
  .description("Create local files and detect Claude Code / Codex config")
  .option("--dry-run", "detect possible hook config but do not modify or create anything")
  .option("--install-hooks", "install collector hooks into detected agents (backs up first)")
  .option("-y, --yes", "skip the confirmation prompt when installing hooks")
  .action((opts) => init({ dryRun: opts.dryRun, installHooks: opts.installHooks, yes: opts.yes }));

program
  .command("scan")
  .description("Scan local MCP configuration for security risks (read-only, never executes)")
  .argument("[dir]", "project directory to scan (defaults to the current directory)")
  .action((dir) => scanCmd(dir));

const hooks = program.command("hooks").description("Manage Claude Code / Codex collector hooks");
hooks
  .command("status")
  .description("Show whether collector hooks are installed")
  .action(() => hooksStatusCmd());
hooks
  .command("install")
  .description("Install collector hooks into detected agents (backs up existing config)")
  .option("--dry-run", "preview without modifying anything")
  .option("-y, --yes", "skip the confirmation prompt")
  .action((opts) => installHooksCmd({ dryRun: opts.dryRun, yes: opts.yes }));
hooks
  .command("uninstall")
  .description("Remove collector hooks (backs up before changing)")
  .action(() => hooksUninstallCmd());

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
