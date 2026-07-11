import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPolicy, mergePolicies, validatePolicy } from "../src/core/policy";
import { loadPolicyChain } from "../src/server/mcp-scan";

describe("validatePolicy (schema v1)", () => {
  it("an empty document is a valid empty policy", () => {
    const v = validatePolicy({});
    expect(v.errors).toEqual([]);
    expect(v.policy).toEqual({});
  });

  it("every legacy three-field policy.json is a valid v1 policy", () => {
    const v = validatePolicy({ allowedMcpHosts: ["*.example.com"], ignoreRules: ["AAC-MCP-005"], failOn: "high" });
    expect(v.errors).toEqual([]);
    expect(v.policy.ignoreRules).toEqual(["AAC-MCP-005"]);
  });

  it("accepts ignoredRules as an alias and warns when both are present", () => {
    const alias = validatePolicy({ ignoredRules: ["AAC-MCP-005"] });
    expect(alias.errors).toEqual([]);
    expect(alias.policy.ignoreRules).toEqual(["AAC-MCP-005"]);

    const both = validatePolicy({ ignoreRules: ["AAC-MCP-001"], ignoredRules: ["AAC-MCP-002"] });
    expect(both.policy.ignoreRules).toEqual(["AAC-MCP-001"]);
    expect(both.warnings.some((w) => w.includes("both"))).toBe(true);
  });

  it("rejects a schemaVersion from the future with a clear message", () => {
    const v = validatePolicy({ schemaVersion: 2 });
    expect(v.errors[0]).toContain("newer than this version supports");
  });

  it("field-by-field errors, not a generic failure", () => {
    const v = validatePolicy({ allowedMcpHosts: "example.com", failOn: "loud", rules: [] });
    expect(v.errors).toHaveLength(3);
    expect(v.errors.join("\n")).toContain("allowedMcpHosts");
    expect(v.errors.join("\n")).toContain("failOn");
    expect(v.errors.join("\n")).toContain("rules");
  });

  it("warns on unknown rule ids, reserved fields, unsafe failOn, and disabling a critical rule", () => {
    const v = validatePolicy({
      failOn: "never",
      ignoreRules: ["AAA-NOPE-999"],
      retentionDays: 90,
      rules: { "AAC-SECRET-001": { enabled: false } },
    });
    expect(v.errors).toEqual([]);
    const all = v.warnings.join("\n");
    expect(all).toContain('unknown rule id "AAA-NOPE-999"');
    expect(all).toContain("retentionDays is reserved and NOT enforced");
    expect(all).toContain('failOn "never"');
    expect(all).toContain("disables a critical-severity rule");
  });
});

describe("applyPolicy with v1 rules{}", () => {
  const findings = [
    { ruleId: "AAC-SHELL-002", severity: "high" as const },
    { ruleId: "AAC-MCP-005", severity: "medium" as const },
  ];

  it("enabled:false suppresses, severity overrides rewrite — by EITHER id generation", () => {
    const out = applyPolicy(findings, {
      rules: { "AAA-SHELL-002": { enabled: false }, "AAA-MCP-005": { severity: "low" } },
    });
    expect(out).toEqual([{ ruleId: "AAC-MCP-005", severity: "low" }]);
  });

  it("ignoreRules written with the NEW id still hides a finding stored with the legacy id", () => {
    const out = applyPolicy(findings, { ignoreRules: ["AAA-SHELL-002"] });
    expect(out.map((f) => f.ruleId)).toEqual(["AAC-MCP-005"]);
  });
});

describe("policy chain (user < repo-local)", () => {
  it("repo-local overrides per field; broken files are reported and skipped", () => {
    const home = mkdtempSync(join(tmpdir(), "aaa-policy-"));
    const configDir = join(home, "data");
    const repo = join(home, "repo");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(repo, ".aster-audit"), { recursive: true });

    writeFileSync(join(configDir, "policy.json"), JSON.stringify({ failOn: "high", allowedMcpHosts: ["*.corp.dev"] }));
    writeFileSync(join(repo, ".aster-audit", "policy.json"), JSON.stringify({ failOn: "critical" }));

    const loaded = loadPolicyChain(configDir, repo);
    expect(loaded.errors).toEqual([]);
    expect(loaded.sources.map((s) => s.scope)).toEqual(["user", "repo"]);
    expect(loaded.policy.failOn).toBe("critical"); // repo wins
    expect(loaded.policy.allowedMcpHosts).toEqual(["*.corp.dev"]); // user survives

    // Broken repo file → error reported, user policy still applies untouched.
    writeFileSync(join(repo, ".aster-audit", "policy.json"), "{not json");
    const broken = loadPolicyChain(configDir, repo);
    expect(broken.errors.some((e) => e.includes("not valid JSON"))).toBe(true);
    expect(broken.policy.failOn).toBe("high");

    rmSync(home, { recursive: true, force: true });
  });

  it("mergePolicies: rules merge per id, arrays replace", () => {
    const merged = mergePolicies(
      { rules: { A: { enabled: false }, B: { severity: "low" } }, allowedMcpHosts: ["a.com"] },
      { rules: { B: { severity: "high" } }, allowedMcpHosts: ["b.com"] }
    );
    expect(merged.rules).toEqual({ A: { enabled: false }, B: { severity: "high" } });
    expect(merged.allowedMcpHosts).toEqual(["b.com"]);
  });
});
