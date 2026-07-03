import { describe, it, expect } from "vitest";
import { getDemoDataset } from "../src/web/data/source";
import { buildInsights } from "../src/web/lib/insights";
import { openDb } from "../src/db/index";

describe("buildInsights", () => {
  const ds = getDemoDataset();

  it("computes model cost, tool usage, and risk interception from demo data", () => {
    const ins = buildInsights(ds);
    expect(ins.models.length).toBeGreaterThan(0);
    expect(ins.models[0].costUsd).toBeGreaterThanOrEqual(ins.models[ins.models.length - 1].costUsd); // sorted desc
    expect(ins.toolUsage.length).toBeGreaterThan(0);
    expect(ins.risk.rate).toBeGreaterThanOrEqual(0);
    expect(ins.risk.rate).toBeLessThanOrEqual(1);
  });

  it("derives cache hit rate from the token breakdown", () => {
    const withBreakdown = {
      ...ds,
      sessions: ds.sessions.map((s) => ({
        ...s,
        inputTokens: 100,
        cachedInputTokens: 900,
        outputTokens: 50,
        cacheWriteTokens: 10,
      })),
    };
    const ins = buildInsights(withBreakdown);
    expect(ins.tokens.hasBreakdown).toBe(true);
    expect(ins.tokens.cacheHitRate).toBeCloseTo(0.9, 3); // 900 / (900 + 100)
    expect(ins.tokens.total).toBeGreaterThan(0);
  });

  it("reports no breakdown when sessions lack usage detail", () => {
    const ins = buildInsights({ ...ds, sessions: ds.sessions.map((s) => ({ ...s, inputTokens: undefined, outputTokens: undefined, cachedInputTokens: undefined, cacheWriteTokens: undefined })) });
    expect(ins.tokens.hasBreakdown).toBe(false);
  });
});

describe("buildInsights — latency / failures / file types / daily / outcomes", () => {
  const base = getDemoDataset();
  const ev = (over: Record<string, unknown>) => ({
    id: Math.random().toString(36).slice(2),
    agent: "codex",
    source: "import",
    title: "t",
    receivedAt: "2026-07-04T00:00:00Z",
    ...over,
  });

  it("A. latency prefers an explicit duration and pairs pre/post otherwise", () => {
    const events = [
      // explicit duration (Codex wall time)
      ev({ type: "user_prompt", sessionId: "s1", timestamp: "2026-07-04T00:00:00.000Z" }),
      ev({ type: "pre_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:03.000Z" }),
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:99.000Z", metrics: { durationMs: 5000 } }),
      // pairing (no explicit duration): 2s apart
      ev({ type: "pre_tool_use", sessionId: "s1", toolName: "read", timestamp: "2026-07-04T00:01:00.000Z" }),
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "read", timestamp: "2026-07-04T00:01:02.000Z" }),
    ];
    const ins = buildInsights({ ...base, eventsBySession: { s1: events as never } });
    const exec = ins.latency.tools.find((t) => t.name === "exec")!;
    const read = ins.latency.tools.find((t) => t.name === "read")!;
    expect(exec.medianMs).toBe(5000);
    expect(read.medianMs).toBe(2000);
    expect(ins.latency.thinkingMs).toBe(3000); // prompt → first tool
    expect(ins.latency.sampled).toBe(2);
  });

  it("A. explicit-duration calls don't desync the pairing queue", () => {
    // Same tool: one explicit-duration post, then a paired post. The explicit
    // one must NOT consume a queued pre, or the paired one mispairs.
    const events = [
      ev({ type: "pre_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:05.000Z" }),
      ev({ type: "pre_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:06.000Z" }),
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:10.000Z", metrics: { durationMs: 100 } }),
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:11.000Z" }),
    ];
    const ins = buildInsights({ ...base, eventsBySession: { s1: events as never } });
    // 100 (explicit) + 6000 (pre@5s→post@11s), NOT 100 + 5000 (the desync bug)
    expect(ins.latency.tools.find((t) => t.name === "exec")!.count).toBe(2);
    expect(ins.latency.medianMs).toBe(3050); // median(100, 6000)
  });

  it("B. failure rate counts real command runs only (not tests/commits)", () => {
    const events = [
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:01Z", metrics: { exitCode: 0 } }),
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:02Z", metrics: { exitCode: 2 } }),
      ev({ type: "post_tool_use", sessionId: "s1", toolName: "read", timestamp: "2026-07-04T00:00:03Z" }), // no exit code → ignored
      ev({ type: "test_result", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:04Z", metrics: { exitCode: 1 } }), // red test → excluded
      ev({ type: "git_event", sessionId: "s1", toolName: "exec", timestamp: "2026-07-04T00:00:05Z", metrics: { exitCode: 0 } }), // commit → excluded
    ];
    const ins = buildInsights({ ...base, eventsBySession: { s1: events as never } });
    expect(ins.failures.withExit).toBe(2); // only the two post_tool_use commands
    expect(ins.failures.failed).toBe(1);
    expect(ins.failures.rate).toBeCloseTo(0.5, 5);
    expect(ins.failures.tools[0]).toMatchObject({ name: "exec", total: 2, failed: 1 });
  });

  it("C. file types are grouped by extension", () => {
    const fc = (filePath: string) => ({ id: filePath, sessionId: "s1", repoPath: "/r", filePath, changeType: "modified", linesAdded: 0, linesDeleted: 0, agent: "codex", timestamp: "2026-07-04T00:00:00Z" });
    const ins = buildInsights({ ...base, fileChanges: [fc("/r/a.ts"), fc("/r/b.ts"), fc("/r/README.md"), fc("/r/Makefile")] as never });
    expect(ins.fileTypes.find((f) => f.ext === ".ts")!.count).toBe(2);
    expect(ins.fileTypes.find((f) => f.ext === ".md")!.count).toBe(1);
    expect(ins.fileTypes.find((f) => f.ext === "(no ext)")!.count).toBe(1);
  });

  it("D+E. daily rollup and outcomes come from sessions", () => {
    const s = (over: Record<string, unknown>) => ({ id: Math.random().toString(36).slice(2), agent: "codex", startedAt: "2026-07-04T09:00:00Z", status: "completed", filesChanged: 0, commits: 0, testsPassed: 0, testsFailed: 0, riskCount: 0, ...over });
    // Identical startedAt on the two same-day sessions keeps this tz-robust.
    const sessions = [
      s({ startedAt: "2026-07-04T09:00:00Z", totalTokens: 100, estimatedCostUsd: 1, status: "completed" }),
      s({ startedAt: "2026-07-04T09:00:00Z", totalTokens: 200, estimatedCostUsd: 2, status: "failed" }),
      s({ startedAt: "2026-07-01T09:00:00Z", totalTokens: 50, estimatedCostUsd: 0.5, status: "active" }),
    ];
    const ins = buildInsights({ ...base, sessions: sessions as never });
    expect(ins.outcomes).toMatchObject({ completed: 1, failed: 1, active: 1, total: 3 });
    expect(ins.outcomes.completionRate).toBeCloseTo(1 / 3, 5);
    // two sessions land on the same day → one bucket with summed tokens
    expect(ins.daily).toHaveLength(2);
    const busy = ins.daily.find((d) => d.sessions === 2)!;
    expect(busy.tokens).toBe(300);
    expect(ins.daily[0].date < ins.daily[1].date).toBe(true); // chronological
  });
});

describe("updateSessionUsage persists the token breakdown", () => {
  it("writes and reads back input/output/cache columns (with migration on a fresh db)", () => {
    const db = openDb(":memory:");
    db.upsertSession({ id: "s1", agent: "claude-code", startedAt: new Date().toISOString() });
    db.updateSessionUsage("s1", {
      totalTokens: 1000,
      costUsd: 1.23,
      model: "claude-opus-4-8",
      inputTokens: 100,
      outputTokens: 200,
      cachedInputTokens: 650,
      cacheWriteTokens: 50,
    });
    const s = db.getSession("s1")!;
    expect(s.totalTokens).toBe(1000);
    expect(s.inputTokens).toBe(100);
    expect(s.cachedInputTokens).toBe(650);
    expect(s.cacheWriteTokens).toBe(50);
    expect(s.model).toBe("claude-opus-4-8");
    db.close();
  });
});
