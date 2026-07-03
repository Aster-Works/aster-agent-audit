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
