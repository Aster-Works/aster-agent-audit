# Community, Pro, Team

**Pro and Team do not exist yet.** Nothing in this section is for sale, nothing has a
ship date, and nothing here is a promise. This page exists so that (a) anyone reading
the source knows exactly where the commercial seam is and is not, and (b) if a Pro or
Team edition ever ships, its scope was decided in the open, ahead of time, instead of
being carved out of features people already had for free.

**No feature gates exist in this repository.** `src/extension/index.ts` defines an
`EditionProvider` interface and ships exactly one implementation —
`communityProvider` — whose `has()` always returns `false` and whose `license()`
always returns `{ state: "community" }`. There is no second provider, no hidden flag,
and no code path that checks a license to unlock something already built. See
[docs/commercial-architecture.md](commercial-architecture.md) for how a future paid
edition would actually plug into this seam.

## The rule: no bait-and-switch

**A capability that ships free in Community never moves behind a paywall later.**
If a future release adds a genuinely new capability, it can launch as Pro/Team-only
from day one — but nothing that already works for free today gets pulled back and
resold. This page is the reference for that promise: compare it against a future
release before upgrading trust in the vendor.

## Community (this repository, MIT, free)

Everything in this repository, with no gate, no trial period, and no feature removed
based on usage. As of `@asterworks/agent-audit` 0.2.0, that includes:

- Local dashboard (sessions, timeline, risk radar, insights, repo activity, activity log, settings)
- Claude Code + Codex hook/rollout collection, SQLite storage, SSE live updates
- The full runtime risk engine (`AAA-SHELL-*`, `AAA-GIT-*`, `AAA-SECRET-*`, `AAA-FILE-*`) — see [docs/security-rules.md](security-rules.md)
- The full MCP security scan (`AAA-MCP-001`..`009`), posture grading, and inventory diffing — see [docs/mcp-security.md](mcp-security.md)
- Policy configuration (`policy.json`, user + repo-local, schema v1) — see [docs/policies.md](policies.md)
- Audit-trail hash chaining and `aster-audit verify` — see [docs/audit-integrity.md](audit-integrity.md)
- Evidence bundle export, security report (JSON + HTML/Print-to-PDF), SARIF 2.1.0, scan baselines, JSON/CSV dashboard exports — see [docs/reports.md](reports.md)
- CI-friendly exit codes on `scan` and `policy validate`

**Community is not a crippled trial.** It is the whole product for a single
user on a single machine. There is no artificial cap on sessions, findings, retention
period, or scan frequency baked in to steer you toward a paid tier.

## Pro (candidate scope — does not exist)

Ideas under consideration for a possible future single-user paid tier, aimed at
people who want more automation or a stronger evidentiary artifact than the free
scan-on-demand model gives them. None of these are built. None are promised.

- Custom data retention (beyond the fixed 30-day window Community prunes to — see [docs/limitations.md](limitations.md))
- Scheduled scans/reports (cron-style, unattended — Community requires an explicit CLI invocation)
- Advanced policy packs (curated, maintained rule bundles beyond hand-written `policy.json`)
- Signed evidence manifest (an externally-signed attestation over an evidence bundle — Community's bundle is a plain, unsigned file; see the "Not a signature" note in [docs/audit-integrity.md](audit-integrity.md))
- Encrypted backup/export of the local database

Explicitly **not** Pro candidates, because they already ship free: SARIF output,
scan baselines, the HTML security report, and CI exit codes are already in
Community and stay there.

## Team (candidate scope — does not exist)

Ideas under consideration for a possible future multi-user/multi-machine tier —
things that need a server component this local-first tool deliberately does not
have today (see "Cloud & team features" in [docs/privacy.md](privacy.md) and
[docs/limitations.md](limitations.md)).

- Multi-workspace / fleet aggregation across several developers' machines
- Central policy distribution (push one `policy.json` to a team instead of each developer maintaining their own)
- RBAC / SSO for a shared dashboard
- SIEM / webhook forwarding of findings

## Where the boundary actually lives in code

`Capability` in `src/extension/index.ts` is the authoritative list of names a future
provider could light up: `scheduled-reports`, `policy-packs`,
`signed-evidence-manifest`, `multi-workspace`, `central-policy`,
`fleet-aggregation`. That list is a type, not a plan — it exists so any future
commercial package has a fixed vocabulary to register against, not so a date can be
attached to it. If a capability you want isn't on that list, it isn't being
considered yet either.
