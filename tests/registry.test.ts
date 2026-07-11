import { describe, it, expect } from "vitest";
import { modernId, resolveRule, ruleRegistry } from "../src/core/rules/registry";
import { riskRuleCatalog } from "../src/core/risk";
import { mcpRuleCatalog } from "../src/core/mcp";
import { ADAPTERS, getAdapter } from "../src/core/adapters/index";
import { normalizeHookEvent } from "../src/core/normalize";

describe("rules registry", () => {
  it("covers EVERY live rule (command catalog + inline + MCP catalog) exactly once", () => {
    const reg = ruleRegistry();
    const ids = reg.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates

    const expected =
      riskRuleCatalog().length + 3 /* AAC-SECRET-001/004, AAC-FILE-005 inline */ + mcpRuleCatalog().length;
    expect(reg).toHaveLength(expected);

    for (const r of [...riskRuleCatalog(), ...mcpRuleCatalog()]) {
      const hit = resolveRule(r.ruleId);
      expect(hit, r.ruleId).toBeDefined();
      // Titles derive from the live catalogs — they cannot drift.
      expect(hit!.title).toBe(r.title);
    }
  });

  it("maps legacy AAC-* ids to AAA-* and resolves BOTH directions", () => {
    expect(modernId("AAC-SHELL-002")).toBe("AAA-SHELL-002");
    const byLegacy = resolveRule("AAC-MCP-005");
    const byModern = resolveRule("AAA-MCP-005");
    expect(byLegacy).toBeDefined();
    expect(byLegacy).toBe(byModern);
    expect(byLegacy!.legacyIds).toContain("AAC-MCP-005");
  });

  it("every rule declares version, confidence, and an honest detection method", () => {
    for (const r of ruleRegistry()) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(["low", "medium", "high"]).toContain(r.confidence);
      // MCP rules are static-config; everything else is runtime-event.
      expect(r.detectionMethod).toBe(r.id.startsWith("AAA-MCP-") ? "static-config" : "runtime-event");
    }
  });

  it("unknown ids resolve to undefined (no invented rules)", () => {
    expect(resolveRule("AAA-NOPE-999")).toBeUndefined();
  });
});

describe("agent adapters", () => {
  it("registers exactly the agents we can actually read (no fake adapters)", () => {
    expect(ADAPTERS.map((a) => a.id).sort()).toEqual(["claude-code", "codex"]);
    expect(getAdapter("claude-code").mode).toBe("push"); // hook POSTs to us
    expect(getAdapter("codex").mode).toBe("poll"); // we tail rollout logs
  });

  it("adapter.normalize is equivalent to the pre-boundary pipeline", () => {
    const payload = {
      hook_event_name: "PreToolUse",
      session_id: "s-adapter",
      tool_name: "Bash",
      tool_input: { command: "export API_KEY=sk-ant-abcdefghijklmnopqrstu123 && ls" },
      cwd: "/tmp/repo",
    };
    // Redaction ids (counter+time) and receivedAt (stamped per call) are
    // volatile by design — strip them; everything else must match exactly.
    const stripVolatile = (v: unknown): unknown =>
      JSON.parse(
        JSON.stringify(v)
          .replace(/"id":"red_[0-9a-f]+"/g, '"id":"red_X"')
          .replace(/"receivedAt":"[^"]+"/g, '"receivedAt":"T"')
          .replace(/"timestamp":"[^"]+"/g, '"timestamp":"T"')
      );
    for (const agent of ["claude-code", "codex"] as const) {
      const viaAdapter = getAdapter(agent).normalize(payload, { id: "e-fixed" });
      const direct = normalizeHookEvent(agent, payload, { id: "e-fixed" });
      expect(stripVolatile(viaAdapter)).toEqual(stripVolatile(direct));
      // and redaction still happened before anything is returned
      expect(JSON.stringify(viaAdapter.event.input)).not.toContain("sk-ant-abcdefghijklmnopqrstu123");
    }
  });
});
