# Architecture

How data moves from an agent's tool call to a rendered dashboard row, and where
each stage lives in the source tree. This is the current, as-built shape — for
the decisions and tradeoffs that produced it, see `REFACTOR_PLAN.md` §2; this
page transcribes and updates that plan's target diagram against what actually
shipped.

## Data flow

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ Claude Code               │ push   │ Codex rollout logs            │ poll
│ hooks → POST /events       │───┐    │ ~/.codex/sessions/**/*.jsonl   │───┐
│ (or spool if collector down)│  │    │ tailed every 5s                │  │
└─────────────────────────┘  │    └──────────────────────────────┘  │
                              │                                       │
                              ▼                                       ▼
                    ┌────────────────────────────────────────────────────┐
                    │ Agent adapter boundary — src/core/adapters/index.ts  │
                    │ Claude Code = "push" (nothing to iterate, the hook   │
                    │ POSTs); Codex = "poll" (rollout tail synthesizes     │
                    │ hook-shaped payloads). Everything downstream is      │
                    │ agent-agnostic.                                      │
                    └───────────────────────┬────────────────────────────┘
                                             ▼
                    ┌────────────────────────────────────────────────────┐
                    │ normalize() — src/core/normalize.ts                  │
                    │ untrusted payload → canonical NormalizedAgentEvent   │
                    │ (Zod-validated; unknown fields dropped, never        │
                    │ trusted)                                             │
                    │        │                                             │
                    │        ▼ redactJson/redactString BEFORE storage      │
                    │ redaction — src/core/redaction.ts                    │
                    │ pattern-based secret masking, pure TS (browser-safe) │
                    └───────────────────────┬────────────────────────────┘
                                             ▼
                    ┌────────────────────────────────────────────────────┐
                    │ Collector — src/server/collector.ts                  │
                    │ normalize → redact (inside normalize) → risk detect  │
                    │ → persist → broadcast. Never executes incoming       │
                    │ commands.                                            │
                    │        │                                             │
                    │        ▼                                             │
                    │ Risk engine — src/core/risk.ts (runtime rules)       │
                    │ + src/core/mcp.ts (static MCP config rules)          │
                    │ registry/id-mapping — src/core/rules/registry.ts     │
                    └───────────────────────┬────────────────────────────┘
                                             ▼
                    ┌────────────────────────────────────────────────────┐
                    │ SQLite — src/db/index.ts (better-sqlite3, WAL)       │
                    │ tables: sessions, events, risk_findings,             │
                    │ file_changes, finding_status_history, mcp_inventory  │
                    │ PRAGMA user_version migrations (see below)           │
                    │ chain hash computed at insert — src/core/integrity/  │
                    └───────────────────────┬────────────────────────────┘
                                             ▼
                    ┌────────────────────────────────────────────────────┐
                    │ Enrichment (async, off the request path)             │
                    │ git — src/server/git.ts, src/server/enrich.ts        │
                    │   (real diffs, commit association; read-only,        │
                    │    execFile with an argument array, never a shell)   │
                    │ usage/cost — src/server/usage.ts                     │
                    │   (token counts from transcripts, numbers only)      │
                    └───────────────────────┬────────────────────────────┘
                                             ▼
                    ┌────────────────────────────────────────────────────┐
                    │ API / SSE — src/server/index.ts (Hono)               │
                    │ GET  /api/*        dashboard data (REST)             │
                    │ GET  /api/live     Server-Sent Events, live push     │
                    │ POST /events       collector ingest endpoint         │
                    │ binds 127.0.0.1 only, Host-header guard, 512KB cap   │
                    └───────────────────────┬────────────────────────────┘
                                             ▼
                    ┌────────────────────────────────────────────────────┐
                    │ Dashboard — src/web/ (Vite + React, HashRouter)      │
                    │ zustand store (src/web/app/store.ts) holds the       │
                    │ full dataset; demo/live switch — src/web/data/       │
                    │ source.ts; client-side re-aggregation on filter      │
                    │ change — src/web/data/filter.ts                     │
                    │ 8 routes — src/web/routes/*.tsx                     │
                    └────────────────────────────────────────────────────┘
```

## Layer by layer

### 1. Adapter boundary — `src/core/adapters/index.ts`

The line between agent-specific knowledge and the canonical pipeline. The two
shipped agents collect **differently on purpose**, and the interface names that
instead of hiding it behind a fake uniform "collect()" call:

- **Claude Code is push.** Its own hook process POSTs each event to
  `POST /events` as it happens. There is nothing for the adapter to iterate.
- **Codex is poll.** It has no per-tool hook (only a turn-complete `notify`
  slot, which can't carry per-tool-call detail), so `src/server/codex-import.ts`
  tails `~/.codex/sessions/**/rollout-*.jsonl` every 5 seconds and synthesizes
  hook-shaped payloads through the same pipeline. Reads are guarded to paths
  that canonicalize inside `~/.codex/sessions`; a per-file line offset makes
  re-scans idempotent.

Everything past this boundary — normalize, redact, risk, storage, enrichment,
UI — is agent-agnostic.

### 2. Normalize + redact — `src/core/normalize.ts`, `src/core/redaction.ts`

`normalize()` Zod-validates an untrusted hook payload into the canonical
`NormalizedAgentEvent` shape; a malformed payload degrades to a best-effort
event rather than throwing. Redaction runs **inside** normalize, before
anything reaches storage — `redactJson`/`redactString` mask known secret
patterns. `redaction.ts` is pure TypeScript with no Node built-ins, so the same
logic is safe to import into the browser bundle too.

### 3. Risk detection — `src/core/risk.ts`, `src/core/mcp.ts`, `src/core/rules/registry.ts`

Two non-overlapping rule engines, unified by one registry:

- `risk.ts` — runtime rules over ingested events (dangerous shell commands,
  destructive git operations, secret/file access). Commands are **inspected as
  text only, never executed.**
- `mcp.ts` — static analysis of on-disk MCP server configs (JSON + Codex TOML).
  Pure and filesystem-free itself; the discovery/read layer is
  `src/server/mcp-scan.ts`.
- `rules/registry.ts` — one queryable catalog deriving its entries from both
  rule tables (so titles/severities can't drift from the code that actually
  detects), with the `AAA-*`/`AAC-*` id mapping. Full table:
  [docs/security-rules.md](security-rules.md).

### 4. Storage — `src/db/index.ts`

SQLite via `better-sqlite3`, WAL mode, synchronous, local-only. Six tables:
`sessions`, `events`, `risk_findings`, `file_changes`,
`finding_status_history` (append-only status audit trail for findings),
`mcp_inventory` (fingerprinted MCP server snapshots for change detection).

Schema evolves through `PRAGMA user_version` migrations, re-runnable and
column-probed so an interrupted migration doesn't corrupt state:

| Version | Adds |
|---|---|
| (pre-versioning baseline) | Base schema (idempotent `create table if not exists`) + a column probe adding `input_tokens`/`output_tokens`/`cached_input_tokens`/`cache_write_tokens` to `sessions` |
| v2 | Audit-integrity columns on `events`: `prev_hash`, `hash` (the chain), `chain_seq` (explicit insert order — `rowid` is unusable because `insert or replace` re-inserts at a new rowid). Existing rows keep `NULL` and verify as `legacy-unverified`. |
| v3 | `finding_status_history` (append-only lifecycle: open → acknowledged/resolved/accepted-risk/false-positive, with `note` and timestamp per transition) and `mcp_inventory` (env-var **names** only, never values, keyed by `name, source_file`, with a content `fingerprint` for change detection) |

Chain hashing itself is computed at insert time in
`src/core/integrity/index.ts` — see [docs/audit-integrity.md](audit-integrity.md)
for what the hash chain does and does not guarantee.

### 5. Enrichment — `src/server/enrich.ts`, `src/server/git.ts`, `src/server/usage.ts`

Runs **after** the synchronous ingest, off the request path, so it never blocks
the agent:

- **Git** (`enrich.ts` + `git.ts`) — real per-file line counts, committed-file
  detection, commit association. Read-only git only (`rev-parse`, `diff`,
  `show`), invoked via `execFile` with an argument array (never a shell
  string), inside a validated/canonicalized work tree, with a hard timeout and
  output cap. Commit messages and paths come from git as raw text, so they are
  redacted before storage — enrichment must not become a bypass around
  `normalize`'s redaction.
- **Usage/cost** (`usage.ts`) — token counts are not in hook payloads at all;
  they're read from each agent's own transcript
  (`~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`),
  **numbers only** — no prompt/response content is ever read, stored, or
  forwarded. Cost is token counts × an editable local rate table, labeled as an
  estimate in the UI.

### 6. API / SSE — `src/server/index.ts`

Hono server, binds `127.0.0.1` only, Host-header guard against DNS rebinding,
512KB request body cap, JSON-only, never executes incoming content.
`POST /events` is the collector ingest endpoint; `GET /api/*` serves the
dashboard's REST reads; `GET /api/live` streams live updates over SSE so the
dashboard reflects new events without polling.

### 7. Dashboard — `src/web/`

Vite + React SPA, `HashRouter`, 8 routes under `src/web/routes/`: Overview,
Insights, RiskRadar, RepoActivity, Activity (the searchable activity log),
SessionReplay, Agents, Settings. A zustand store
(`src/web/app/store.ts`) holds the entire assembled dataset in memory for the
current source mode; `src/web/data/source.ts` switches between the
deterministic demo dataset and `fetchLiveDataset()` against the local API;
`src/web/data/filter.ts` re-aggregates the in-memory dataset client-side on
every top-bar filter change (agent / repo / date / search), reusing the same
core aggregation (`src/core/aggregate.ts`) the live and demo paths both build
on.

## Where the commercial seam sits

`src/extension/` is a thin, additive layer that plugs in *beside* this
pipeline — it does not sit inline in it. See
[docs/commercial-architecture.md](commercial-architecture.md) for what that
seam is and [docs/community-pro-team.md](community-pro-team.md) for what, if
anything, would use it.

## Related pages

- [docs/threat-model.md](threat-model.md) — trust boundaries and what's
  explicitly out of scope.
- [docs/audit-integrity.md](audit-integrity.md) — the hash-chain layer in
  storage, in depth.
- [docs/mcp-security.md](mcp-security.md) — the static-config rule engine, in
  depth.
- [docs/limitations.md](limitations.md) — honest boundaries of every layer
  above, in one place.
