/**
 * Print-ready HTML security report (Phase 5). Self-contained: inline CSS,
 * no scripts, no external assets — open it in any browser and use the
 * browser's own Print to PDF. Deliberately NOT a PDF generator: a browser
 * dependency for PDF rendering is exactly the kind of weight this project
 * refuses (brief §4.7).
 *
 * Every interpolated value is HTML-escaped; findings carry redacted evidence
 * that may contain arbitrary text, and a report that can be broken by a
 * crafted server name is a report you cannot trust.
 */
import type { McpEnvironmentScan } from "../server/mcp-scan";
import { PRODUCT_NAME } from "../core/branding";
import { resolveRule } from "../core/rules/registry";

export function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

export function securityReportHtml(
  scan: McpEnvironmentScan,
  opts: { toolVersion: string; generatedAt?: string }
): string {
  const at = opts.generatedAt ?? new Date().toISOString();
  const sorted = [...scan.findings].sort(
    (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
  );

  const findingRows = sorted
    .map((f) => {
      const def = resolveRule(f.ruleId);
      return `<tr>
  <td class="sev sev-${esc(f.severity)}">${esc(f.severity)}</td>
  <td class="mono">${esc(def?.id ?? f.ruleId)}${def && def.legacyIds[0] !== def.id ? `<br><span class="dim">${esc(def.legacyIds[0])}</span>` : ""}</td>
  <td><strong>${esc(f.title)}</strong><br>${esc(f.description)}${
        f.redactedEvidence ? `<br><code>${esc(f.redactedEvidence)}</code>` : ""
      }<br><em>${esc(f.recommendedAction)}</em></td>
  <td class="mono dim">${esc(f.sourceFile?.split("/").pop() ?? "—")}</td>
</tr>`;
    })
    .join("\n");

  const serverRows = scan.servers
    .map(
      (s) => `<tr>
  <td><strong>${esc(s.name)}</strong></td>
  <td>${esc(s.agent)}</td>
  <td class="mono">${esc(s.transport)}</td>
  <td>${s.permissions.map((p) => `<span class="chip">${esc(p)}</span>`).join(" ")}</td>
  <td class="sev sev-${esc(s.risk)}">${esc(s.risk)}</td>
</tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(PRODUCT_NAME)} — MCP Security Report</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.5 -apple-system, "Segoe UI", sans-serif; color: #1a202c; margin: 40px auto; max-width: 900px; padding: 0 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #edf2f7; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #718096; }
  code { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 3px; padding: 1px 4px; font-size: 12px; word-break: break-all; }
  .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  .dim { color: #a0aec0; }
  .chip { display: inline-block; background: #edf2f7; border-radius: 3px; padding: 0 6px; font-size: 11px; }
  .sev { font-weight: 600; text-transform: uppercase; font-size: 11px; }
  .sev-critical { color: #c53030; } .sev-high { color: #dd6b20; } .sev-medium { color: #b7791f; }
  .sev-low { color: #2b6cb0; } .sev-info { color: #718096; }
  .meta { color: #718096; font-size: 12px; }
  .grade { font-size: 28px; font-weight: 700; }
  footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #a0aec0; font-size: 11px; }
  @media print { body { margin: 0 auto; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${esc(PRODUCT_NAME)} — MCP Security Report</h1>
<p class="meta">Generated ${esc(at)} · tool ${esc(opts.toolVersion)} · static configuration analysis (read-only; nothing was executed)</p>

<h2>Posture</h2>
<p><span class="grade sev-${scan.summary.grade === "A" || scan.summary.grade === "B" ? "low" : scan.summary.grade === "C" ? "medium" : "critical"}">${esc(scan.summary.grade)}</span>
&nbsp; ${esc(scan.summary.score)}/100 · ${esc(scan.summary.serverCount)} server(s) · ${esc(scan.findings.length)} finding(s)
· files: ${scan.summary.configFiles.map((f) => `<span class="mono">${esc(f)}</span>`).join(", ") || "none"}</p>

<h2>Servers</h2>
<table><thead><tr><th>Name</th><th>Agent</th><th>Transport</th><th>Inferred permissions</th><th>Risk</th></tr></thead>
<tbody>${serverRows || `<tr><td colspan="5" class="dim">No MCP servers found.</td></tr>`}</tbody></table>

<h2>Findings</h2>
<table><thead><tr><th>Severity</th><th>Rule</th><th>Finding</th><th>Source</th></tr></thead>
<tbody>${findingRows || `<tr><td colspan="4" class="dim">No findings.</td></tr>`}</tbody></table>

<footer>
Static configuration analysis only — a clean scan is not a proof of safety, and inferred permissions are
not authoritative. Evidence shown is redacted (best-effort). Rules and detection methods:
see docs/mcp-security.md. Print this page with your browser to produce a PDF.
</footer>
</body>
</html>
`;
}
