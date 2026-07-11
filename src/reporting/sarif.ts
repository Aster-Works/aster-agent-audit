/**
 * SARIF 2.1.0 output for the MCP scan (Phase 5).
 *
 * Emits the minimal, valid subset CI systems (GitHub code scanning, etc.)
 * ingest: one run, the tool's rule metadata from the registry (new AAA-* ids;
 * the finding's original id is preserved so a rule can be looked up under
 * either generation), and one result per finding pointing at the config file
 * it came from. Nothing is invented: no fake fix objects, no fabricated
 * line numbers (MCP findings are file-scoped; line info would be a guess).
 */
import type { RiskFinding, RiskSeverity } from "../core/types";
import { resolveRule } from "../core/rules/registry";
import { REPO_URL } from "../core/branding";

const LEVEL: Record<RiskSeverity, "error" | "warning" | "note"> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "note",
  info: "note",
};

export type SarifLog = {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{
          id: string;
          name: string;
          shortDescription: { text: string };
          helpUri?: string;
          properties?: Record<string, unknown>;
        }>;
      };
    };
    results: Array<{
      ruleId: string;
      level: "error" | "warning" | "note";
      message: { text: string };
      locations: Array<{
        physicalLocation: { artifactLocation: { uri: string } };
      }>;
      partialFingerprints?: Record<string, string>;
    }>;
  }>;
};

export function toSarif(
  findings: Array<RiskFinding & { sourceFile?: string }>,
  opts: { toolVersion: string }
): SarifLog {
  // Rule metadata for every distinct rule that actually fired.
  const ruleIds = [...new Set(findings.map((f) => f.ruleId))];
  const rules = ruleIds.map((id) => {
    const def = resolveRule(id);
    return {
      id: def?.id ?? id,
      name: (def?.title ?? id).replace(/[^A-Za-z0-9]+/g, ""),
      shortDescription: { text: def?.title ?? id },
      properties: def
        ? { legacyIds: def.legacyIds, category: def.category, confidence: def.confidence, ruleVersion: def.version }
        : undefined,
    };
  });

  return {
    $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "aster-audit",
            version: opts.toolVersion,
            informationUri: REPO_URL,
            rules,
          },
        },
        results: findings.map((f) => ({
          ruleId: resolveRule(f.ruleId)?.id ?? f.ruleId,
          level: LEVEL[f.severity],
          message: { text: `${f.title}. ${f.description} Recommended: ${f.recommendedAction}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.sourceFile ? `file://${f.sourceFile}` : "unknown" },
              },
            },
          ],
          partialFingerprints: { asterAuditFindingId: f.id },
        })),
      },
    ],
  };
}
