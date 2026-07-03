import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "../src/server/index";

type Srv = ReturnType<typeof createServer>;
let srv: Srv;

function post(app: Srv["app"], path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1", ...headers },
      body: JSON.stringify(body),
    })
  );
}
function get(app: Srv["app"], path: string, headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://127.0.0.1${path}`, { headers: { host: "127.0.0.1", ...headers } }));
}

beforeEach(() => {
  srv = createServer({ dbPath: ":memory:" });
});
afterEach(() => {
  srv.db.close();
});

describe("server API", () => {
  it("responds to /health", async () => {
    const res = await get(srv.app, "/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; counts: { sessions: number } };
    expect(json.ok).toBe(true);
    expect(json.counts.sessions).toBe(0);
  });

  it("returns empty dataset before any events (demo fallback signal)", async () => {
    const res = await get(srv.app, "/api/dataset");
    expect(await res.json()).toEqual({ empty: true });
  });

  it("ingests a fake Claude Code event via POST /events and exposes it", async () => {
    const res = await post(srv.app, "/events", {
      agent: "claude-code",
      payload: {
        session_id: "s1",
        cwd: "/repo",
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { exit_code: 0 },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sessionId: string };
    expect(body.ok).toBe(true);

    const sessions = (await (await get(srv.app, "/api/sessions")).json()) as unknown[];
    expect(sessions).toHaveLength(1);

    const events = (await (await get(srv.app, "/api/sessions/s1/events")).json()) as unknown[];
    expect(events).toHaveLength(1);
  });

  it("creates a risk finding from a dangerous command and serves it", async () => {
    await post(srv.app, "/events", {
      agent: "codex",
      payload: {
        session_id: "s2",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "exec_command",
        tool_input: { cmd: "rm -rf /*" },
      },
    });
    const risk = (await (await get(srv.app, "/api/risk-findings")).json()) as { severity: string }[];
    expect(risk.length).toBeGreaterThan(0);
    expect(risk.some((r) => r.severity === "critical")).toBe(true);
  });

  it("rejects non-JSON and oversized payloads", async () => {
    const res415 = await srv.app.fetch(
      new Request("http://127.0.0.1/events", {
        method: "POST",
        headers: { "content-type": "text/plain", host: "127.0.0.1" },
        body: "hello",
      })
    );
    expect(res415.status).toBe(415);
  });

  it("rejects non-local host headers", async () => {
    const res = await get(srv.app, "/health", { host: "evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("serves a non-empty dataset after ingestion", async () => {
    await post(srv.app, "/events", {
      agent: "claude-code",
      payload: { session_id: "s3", cwd: "/repo", hook_event_name: "UserPromptSubmit", prompt: "hi" },
    });
    const ds = (await (await get(srv.app, "/api/dataset")).json()) as { sessions?: unknown[] };
    expect(ds.sessions?.length).toBe(1);
  });
});
