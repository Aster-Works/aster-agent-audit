/**
 * Local server (02 §4). Binds to 127.0.0.1 only, accepts JSON only, enforces a
 * body-size limit, never executes incoming commands, and redacts before
 * persistence (inside the collector). Serves:
 *   POST /events            collector endpoint
 *   GET  /health            health probe
 *   GET  /api/*             dashboard data
 *   GET  /api/live          SSE live stream
 *   GET  *                  static dashboard (when webDir is provided)
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { AgentName, CollectorStatus } from "../core/types";
import { openDb, type AgentConsoleDb, DEFAULT_DB_PATH } from "../db/index";
import { createCollector, type LiveMessage } from "./collector";
import { assembleDataset } from "./dataset";
import { createEnricher, limitConcurrency } from "./enrich";
import { execFileGitRunner, type GitRunner } from "./git";

export const HOST = "127.0.0.1";
export const PORT = 48321;
const MAX_BODY = 512 * 1024; // 512 KB

export type ServerOptions = {
  db?: AgentConsoleDb;
  dbPath?: string;
  host?: string;
  port?: number;
  /** absolute path to built dashboard assets (dist/web); optional */
  webDir?: string;
  /** inject a git runner (tests pass a fake); defaults to the real git binary */
  gitRunner?: GitRunner;
  /** disable git enrichment entirely (e.g. unit tests) */
  enrich?: boolean;
};

export function createServer(opts: ServerOptions = {}) {
  const db = opts.db ?? openDb(opts.dbPath ?? DEFAULT_DB_PATH);
  const host = opts.host ?? HOST;
  const port = opts.port ?? PORT;

  const clients = new Set<(data: string) => void>();
  function broadcast(msg: LiveMessage) {
    const data = JSON.stringify(msg);
    for (const send of clients) send(data);
  }
  const gitRunner = opts.gitRunner ?? execFileGitRunner();
  const enricher =
    opts.enrich === false ? undefined : limitConcurrency(createEnricher(db, gitRunner, broadcast));
  const collector = createCollector(db, broadcast, enricher);

  function status(): CollectorStatus {
    return {
      mode: "live",
      online: true,
      host,
      port,
      dbPath: opts.dbPath ?? DEFAULT_DB_PATH,
      spooledEvents: 0,
    };
  }

  const app = new Hono();

  // Reject non-local Host headers (defense in depth against DNS rebinding).
  app.use("*", async (c, next) => {
    const hostHeader = c.req.header("host") ?? "";
    const h = hostHeader.split(":")[0];
    if (h && h !== "127.0.0.1" && h !== "localhost" && h !== "[::1]" && h !== "::1") {
      return c.json({ ok: false, error: "non-local host rejected" }, 403);
    }
    return next();
  });

  app.get("/health", (c) =>
    c.json({ ok: true, host, port, db: opts.dbPath ?? DEFAULT_DB_PATH, counts: db.counts() })
  );

  // Collector endpoint — JSON only, size-limited, never executes anything.
  app.post("/events", async (c) => {
    const len = Number(c.req.header("content-length") ?? "0");
    if (len > MAX_BODY) return c.json({ ok: false, error: "payload too large" }, 413);
    const ct = c.req.header("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return c.json({ ok: false, error: "JSON only" }, 415);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    const { agent, payload } = (body ?? {}) as { agent?: AgentName; payload?: unknown };
    if (!payload || typeof payload !== "object") {
      return c.json({ ok: false, error: "missing payload" }, 400);
    }
    try {
      const result = collector.ingest((agent as AgentName) ?? "unknown", payload);
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500);
    }
  });

  // ---- Dashboard API ----
  app.get("/api/dataset", (c) => {
    const ds = assembleDataset(db, status());
    if (!ds) return c.json({ empty: true });
    return c.json(ds);
  });
  app.get("/api/overview", (c) => {
    const ds = assembleDataset(db, status());
    return ds ? c.json(ds.overview) : c.json({ empty: true });
  });
  app.get("/api/sessions", (c) => c.json(db.getSessions()));
  app.get("/api/sessions/:id", (c) => {
    const s = db.getSession(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "not found" }, 404);
  });
  app.get("/api/sessions/:id/events", (c) => c.json(db.getEvents(c.req.param("id"))));
  app.get("/api/risk-findings", (c) => c.json(db.getRisk()));
  app.get("/api/repo-activity", (c) => {
    const ds = assembleDataset(db, status());
    return ds ? c.json(ds.repoActivity) : c.json({ empty: true });
  });
  app.get("/api/settings", (c) =>
    c.json({ status: status(), dbPath: opts.dbPath ?? DEFAULT_DB_PATH })
  );

  // ---- SSE live stream ----
  app.get("/api/live", (c) =>
    streamSSE(c, async (stream) => {
      const send = (data: string) => {
        stream.writeSSE({ data }).catch(() => {});
      };
      clients.add(send);
      let alive = true;
      stream.onAbort(() => {
        alive = false;
        clients.delete(send);
      });
      await stream.writeSSE({ data: JSON.stringify({ kind: "hello", counts: db.counts() }) });
      while (alive) {
        await stream.sleep(15000);
        if (!alive) break;
        await stream.writeSSE({ data: JSON.stringify({ kind: "ping" }) }).catch(() => {
          alive = false;
        });
      }
    })
  );

  // ---- Static dashboard (optional) ----
  if (opts.webDir && existsSync(opts.webDir)) {
    const webDir = opts.webDir;
    const rel = "./" + relative(process.cwd(), webDir).replace(/\\/g, "/");
    app.use("/assets/*", serveStatic({ root: rel }));
    app.get("*", (c) => {
      try {
        const html = readFileSync(join(webDir, "index.html"), "utf8");
        return c.html(html);
      } catch {
        return c.text("dashboard not built", 404);
      }
    });
  }

  let server: ServerType | undefined;
  function start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve) => {
      server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
        resolve({ host, port: info.port });
      });
    });
  }
  function close() {
    server?.close();
    db.close();
  }

  return { app, db, collector, broadcast, status, start, close };
}
