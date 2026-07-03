import { describe, it, expect } from "vitest";
import { getDemoDataset } from "../src/web/data/source";
import { applyFilters, repoOptions } from "../src/web/data/filter";

describe("applyFilters (top-bar filters)", () => {
  const ds = getDemoDataset();

  it("filters by agent and re-aggregates the overview", () => {
    const r = applyFilters(ds, { agentFilter: "claude-code", repo: "all", dateRange: "30d", search: "" });
    expect(r.sessions.length).toBeGreaterThan(0);
    expect(r.sessions.length).toBeLessThan(ds.sessions.length);
    expect(r.sessions.every((s) => s.agent === "claude-code")).toBe(true);
    expect(r.overview.totals.sessions).toBe(r.sessions.length);
    expect(r.overview.perAgent.find((a) => a.agent === "codex")?.sessions).toBe(0);
  });

  it("repoOptions lists real repo basenames and the repo filter narrows sessions", () => {
    const repos = repoOptions(ds);
    expect(repos.length).toBeGreaterThan(0);
    const r = applyFilters(ds, { agentFilter: "all", repo: repos[0], dateRange: "30d", search: "" });
    expect(r.sessions.length).toBeGreaterThan(0);
    expect(r.sessions.every((s) => (s.repoPath?.split("/").pop() ?? "unknown") === repos[0])).toBe(true);
  });

  it("a stale/unknown repo value is ignored (treated as all)", () => {
    const r = applyFilters(ds, { agentFilter: "all", repo: "no-such-repo", dateRange: "30d", search: "" });
    expect(r.sessions.length).toBe(ds.sessions.length);
  });

  it("date range never adds sessions", () => {
    const r = applyFilters(ds, { agentFilter: "all", repo: "all", dateRange: "today", search: "" });
    expect(r.sessions.length).toBeLessThanOrEqual(ds.sessions.length);
  });
});
