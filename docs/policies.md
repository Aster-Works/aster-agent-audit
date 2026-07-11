# `policy.json` reference

`policy.json` tunes **what the tool surfaces and what exit code it returns** — it
never changes what is collected or detected. The database and the scan always keep
the full, honest record; policy only filters the *display* and the *gate*. See
"Policy filters the view, not the record" in
[docs/limitations.md](limitations.md) and the module header of
`src/core/policy.ts` for the same guarantee stated in code.

This page is the field-by-field schema reference. For the narrower "how policy
affects the MCP scan specifically" walkthrough (including the posture-grade
interaction), see [docs/mcp-security.md](mcp-security.md).

## Where policy files live

Two locations, loaded and merged in this order (`loadPolicyChain` in
`src/server/mcp-scan.ts`):

| Scope | Path | Precedence |
|---|---|---|
| User | `~/.aster-agent-audit/policy.json` | base |
| Repo-local | `<repo>/.aster-audit/policy.json` | overrides the user policy per field |

Both are optional. No files at all means an empty policy — the tool runs on
built-in defaults (`failOn: "high"`, nothing ignored, no host allowlist).

## Precedence

`mergePolicies(user, repo)` in `src/core/policy.ts`:

- **Scalar fields** (`schemaVersion`, `name`, `failOn`) — repo-local replaces user
  outright, field by field.
- **Array fields** (`allowedMcpHosts`, `ignoreRules`) — repo-local **replaces**,
  it does not union. A repo policy that sets its own `allowedMcpHosts` means
  exactly that list, not "the user's list plus mine."
- **`rules`** (the per-rule override map) — merges **per rule id**, with
  repo-local's entry for a given id winning over the user's entry for the same id.
  Ids present only in the user policy still apply.

A repository can tighten or loosen its own gate without touching the developer's
personal `~/.aster-agent-audit/policy.json`.

## Fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `schemaVersion` | integer | — | Must be an integer ≤ 1 (this version supports schema v1 only; a higher number is a hard error, not a warning). Omitting it is fine — every pre-versioning policy file is a valid v1 policy. |
| `name` | string | — | Free-text label for the policy file itself (e.g. `"team-default"`). Not otherwise interpreted. |
| `allowedMcpHosts` | string[] | `[]` | Hosts vetted for **AAA-MCP-005** (remote MCP server, unverified origin). `example.com` matches exactly; `*.example.com` matches any subdomain **and** the apex (`hostAllowed()` in `src/core/policy.ts`). Matching hosts produce no finding. |
| `ignoreRules` | string[] | `[]` | Rule ids suppressed everywhere — display, exit code, and posture grade. Accepts either the current `AAA-*` id or the legacy `AAC-*` id (both resolve to the same rule via the registry's alias table — see [docs/security-rules.md](security-rules.md)). |
| `ignoredRules` | string[] | — | **Alias of `ignoreRules`** (kept for a brief-era name). If both are present, `ignoreRules` wins and a warning is emitted. |
| `failOn` | `"critical" \| "high" \| "medium" \| "low" \| "info" \| "never"` | `"high"` | Severity at/above which `aster-audit scan` and CI checks exit non-zero. `"never"` disables the gate entirely (and is flagged with a warning, since it silently turns off enforcement). |
| `rules` | object keyed by rule id | `{}` | Per-rule override: `{ "enabled"?: boolean, "severity"?: RiskSeverity }`. `enabled: false` suppresses the rule the same as listing it in `ignoreRules`. `severity` rewrites the severity a matching finding is reported at (does not change detection, only the label). |

### Reserved fields (accepted, validated, **not yet enforced**)

`forbiddenCommands`, `sensitivePaths`, `allowedAgents`, `requireRedaction`,
`retentionDays` are recognized by the schema and pass validation, but currently do
nothing. `policy validate` prints an explicit warning naming each one it sees,
rather than silently accepting a field that looks load-bearing but isn't.
`retentionDays` specifically overlaps with the existing `config.json` / Settings
retention control — it is reserved here so the schema has a home for it once the
two are unified, not duplicated as a second source of truth today.

Any field not in the tables above (known or reserved) is treated as unknown and
ignored, with a warning naming it — never a silent drop.

## Example

```json
{
  "schemaVersion": 1,
  "name": "team-default",
  "allowedMcpHosts": ["*.example.com", "mcp.internal.corp"],
  "ignoreRules": ["AAA-MCP-005"],
  "failOn": "high",
  "rules": {
    "AAA-SHELL-009": { "severity": "medium" },
    "AAA-GIT-002": { "enabled": false }
  }
}
```

## Validation and warnings

A file with **errors** (malformed JSON, wrong field type, unsupported
`schemaVersion`, etc.) is **skipped entirely, never half-applied** — the effective
policy falls back to whatever the remaining chain resolves to (or built-in
defaults if nothing else loads). A file with only **warnings** is still used.

Warnings you'll see:

- **Unknown rule id** — `ignoreRules` or `rules` references an id that matches no
  shipped rule (current or legacy). Usually a typo.
- **`failOn: "never"`** — the scan gate is off; CI will pass regardless of findings.
- **Disabling a critical-severity rule** — `rules["<id>"].enabled: false` where the
  rule's default severity is `critical`. Not blocked, just called out, in case it
  wasn't deliberate.
- **Both `ignoreRules` and `ignoredRules` present** — `ignoreRules` wins.
- **Reserved or unknown field present** — named explicitly (see above).

## CLI

```bash
aster-audit policy validate [dir]   # load the chain, print errors/warnings, exit 1 on error
aster-audit policy test [dir]       # show the EFFECTIVE policy: sources, suppressed rules,
                                     # severity overrides, and where the scan gate sits
```

Neither command modifies anything. `policy validate` is the CI-friendly one — wire
it into a pre-flight step so a broken `policy.json` fails fast instead of silently
falling back to defaults. `policy test` is the human-friendly one — it resolves
the full chain (both scopes) and tells you, in plain terms, which rules end up
suppressed or re-severitized and how many of the shipped rules are still active
(`N/21 shipped rules active` — see [docs/security-rules.md](security-rules.md) for
the full rule count).
