# Reports and exports

Every export this tool produces is generated from the same local, redacted
SQLite record — nothing is re-fetched from a network source, and nothing in an
export contains a raw secret (redaction happens at ingest; see
[docs/privacy.md](privacy.md)). This page covers each output format: what's in
it, how to generate it, and how to wire it into CI where that applies.

| Output | Command | Format |
|---|---|---|
| Evidence bundle | `aster-audit report --type evidence` | JSON |
| Security report | `aster-audit report --type security [--format html]` | JSON or HTML |
| Security scan (CI) | `aster-audit scan --format sarif\|json` | SARIF 2.1.0 or JSON |
| Scan baseline | `aster-audit scan --baseline <file>` / `--update-baseline <file>` | JSON |
| Work report / findings export | Dashboard → Settings | JSON or CSV |

`aster-audit report --type activity` **is not implemented**. Only `evidence` and
`security` exist today (`IMPLEMENTED` in `src/cli/commands/report.ts`); any other
`--type` fails loudly with a non-zero exit and a "not implemented yet" message —
it does not silently produce an empty or partial file.

## Evidence bundle

```bash
aster-audit report --type evidence [--session <id>] [--out bundle.json]
```

One self-contained JSON document (`buildEvidenceBundle` in
`src/server/evidence.ts`), intended to be handed to a reviewer as a single file:

- **`meta`** — product name/version, integrity and DB schema versions, export
  timestamp, the session filter applied (if any), and an explicit redaction
  disclosure string.
- **`verification`** — the hash-chain verdict (`verified` / `broken` /
  `legacy-unverified`) for every included session, **computed at export time**.
  See [docs/audit-integrity.md](audit-integrity.md) for what that verdict does
  and does not prove.
- **`policy`** — the effective policy at export time, plus which files it came
  from (`policy.sources`) — see [docs/policies.md](policies.md).
- **`counts`** — session/event/finding counts, for a quick sanity check without
  parsing the whole body.
- **`events`** — every event exactly as stored, **with its chain hash and
  previous-hash** attached, so a reviewer can independently recompute the chain
  instead of trusting the `verification` field blindly.
- **`findings`** — the full risk-finding rows for the included sessions.

**Redaction note**: events are exported exactly as stored. Storage-time
redaction is best-effort and pattern-based (see [docs/privacy.md](privacy.md)) —
the bundle inherits that limitation, it does not add or remove redaction.

**The bundle itself is an unsigned plain file.** Nothing in the Community edition
signs it; protecting it after export (who can read it, whether it's tampered with
in transit) is the same problem as protecting any other file on your filesystem.
A signed evidence manifest is a Pro-candidate idea only — see
[docs/community-pro-team.md](community-pro-team.md) — and does not exist today.

## Security report

```bash
aster-audit report --type security                  # JSON to stdout
aster-audit report --type security --format html     # self-contained HTML page
aster-audit report --type security --out report.html --format html
```

Runs a fresh MCP scan (`scanMcpEnvironment` with `fresh: true` — always reads
current disk state, never the 30s dashboard cache) and renders it as either:

- **JSON** — `{ summary, servers, findings }`, the same shape the dashboard's
  Risk Radar consumes.
- **HTML** (`src/reporting/html.ts`) — a single self-contained page: inline CSS,
  no external assets, no scripts. Every interpolated value (server names,
  evidence strings, titles) is HTML-escaped, so a maliciously-named MCP server
  can't break or inject into the report.

**To get a PDF**: this tool deliberately does not embed a PDF renderer (that's
weight this local-first project refuses). Open the generated `.html` file in any
browser and use the browser's own **Print → Save as PDF**. The page's CSS is
already print-tuned for this.

## SARIF (CI code scanning)

```bash
aster-audit scan --format sarif > results.sarif
```

Emits SARIF 2.1.0 (`src/reporting/sarif.ts`) — one run, rule metadata sourced
from the same registry documented in [docs/security-rules.md](security-rules.md)
(current `AAA-*` id as the SARIF `ruleId`, with the legacy `AAC-*` id carried in
`properties.legacyIds` so old tooling can still match), and one result per
finding pointing at the config file it came from. No fabricated line numbers —
MCP findings are file-scoped, not line-scoped, and this format doesn't pretend
otherwise.

### GitHub code scanning example

```yaml
# .github/workflows/mcp-scan.yml
name: MCP security scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx @asterworks/agent-audit scan --format sarif > results.sarif
        continue-on-error: true   # upload even if the scan's own exit code is non-zero
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
```

`--format sarif` still sets the process exit code from `failOn` (see
[docs/policies.md](policies.md)) — `continue-on-error: true` on the scan step
lets the SARIF upload happen either way, while the step's own red/green still
reflects whether something crossed the threshold.

## Scan baselines

Baselines let CI fail only on **new** findings, not on a backlog you haven't
triaged yet. A finding id is a stable fingerprint of rule + file + server +
evidence, so it survives re-scans unchanged (`src/cli/commands/scan.ts`).

```bash
# Locally: snapshot today's findings as "known"
aster-audit scan --update-baseline .aster-audit/baseline.json

# Commit the baseline file, then in CI:
aster-audit scan --baseline .aster-audit/baseline.json
# exits non-zero only if a finding NOT in the baseline meets failOn
```

Suggested flow: `--update-baseline` locally (or in a bot commit) whenever the
team has reviewed and accepted the current findings, commit the resulting file,
and open a PR. From then on, `--baseline` in CI gates only on genuinely new
findings introduced by that PR — existing, already-triaged findings stay visible
in `aster-audit scan` output but don't fail the build a second time.

`--format json --baseline <file>` additionally reports `{ file, known, new }`
counts inside the `baseline` key of its JSON output, for scripting.

## Dashboard exports (Settings)

Two on-demand, browser-triggered downloads in the dashboard's Settings screen
(`ExportButtons` in `src/web/routes/Settings.tsx`), both disabled in demo mode
(only available once you're on live data):

- **Export work report (JSON)** — the full assembled dataset
  (`GET /api/dataset`: sessions, overview, everything the dashboard itself
  renders from) as a downloaded `aster-audit-report.json`.
- **Export findings (CSV)** — `GET /api/risk-findings` flattened to
  `ruleId,severity,category,title,agent,sessionId,timestamp` columns, downloaded
  as `aster-audit-findings.csv`. Values are CSV-quoted when they contain a
  comma, quote, or newline.

Both are client-side, on-demand downloads to your machine — no server-side
report generation, no scheduling. Nothing is uploaded anywhere; see "Trust by
default" in the top-level [README](../README.md).
