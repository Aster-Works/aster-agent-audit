import { mkdirSync, existsSync } from "node:fs";
import pc from "picocolors";
import { createServer } from "../../server/index";
import { openDb } from "../../db/index";
import { importSpool } from "../../server/spool";
import { CONFIG_DIR, DB_PATH, SPOOL_DIR, PORT, HOST, findWebDir } from "../util/paths";
import { brand, line, sym } from "../util/ui";

export type DashboardOptions = {
  port?: number;
  db?: string;
  open?: boolean;
};

export async function dashboard(opts: DashboardOptions = {}): Promise<void> {
  const port = opts.port ?? PORT;
  const dbPath = opts.db ?? DB_PATH;

  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  // Open the DB up front so a clear error is shown if it is unreadable.
  const db = openDb(dbPath);

  const webDir = findWebDir();
  const srv = createServer({ db, dbPath, host: HOST, port, webDir });

  let started: { host: string; port: number };
  try {
    started = await srv.start();
  } catch (err) {
    line(`${sym.fail} Could not start the local server on ${HOST}:${port}`);
    line(pc.dim(String((err as Error).message)));
    line(pc.dim("Another instance may already be running. Try --port <n>."));
    db.close();
    process.exitCode = 1;
    return;
  }

  // Replay any events hooks spooled while the collector was offline.
  const imported = importSpool(srv.collector, SPOOL_DIR);

  const url = `http://${started.host}:${started.port}`;
  brand();
  line("");
  line(`  ${sym.ok} Collector running   ${pc.cyan(url)}`);
  if (imported > 0) {
    line(`  ${sym.ok} Imported spool      ${pc.dim(`${imported} offline event(s)`)}`);
  }
  line(`  ${sym.bullet ?? "•"} Database            ${pc.dim(dbPath)}`);
  if (webDir) {
    line(`  ${sym.ok} Dashboard           ${pc.dim(webDir)}`);
  } else {
    line(`  ${sym.warn} Dashboard not built ${pc.dim("run `pnpm build` to serve the UI")}`);
  }
  line(`  ${pc.dim("Bound to 127.0.0.1 only · no cloud · Ctrl+C to stop")}`);
  line("");

  if (opts.open !== false && webDir) {
    const { openBrowser } = await import("../util/browser");
    openBrowser(url);
    line(`  ${sym.arrow} Opening ${pc.cyan(url)} in your browser…`);
  }

  // Keep the process alive; the server holds the event loop open.
  const shutdown = () => {
    line("\n" + pc.dim("Shutting down…"));
    srv.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
