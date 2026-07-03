# Release & Publish Checklist (maintainers)

This is the runbook for cutting a **beta** release of `@asterworks/agent-console` (binary: `aster-agent`). It is a checklist, not a log — nothing here has been done yet. Publish, `git push`, and repo creation are **human-triggered, irreversible** steps: run them yourself, in order, after the pre-flight gates are green.

Repo uses **pnpm@9.15.0** and Node **>=20**. If `corepack pnpm` fails on signature-key verification, use `COREPACK_DEFAULT_TO_LATEST=0 pnpm install`.

---

## 1. Pre-flight (all must be green)

```bash
pnpm test            # vitest — 76 tests must pass
pnpm typecheck:all   # web (tsconfig.json) + server (tsconfig.server.json)
pnpm build:all       # produces dist/web (web) and dist-cli/ (CLI)
```

Then:

- [ ] Bump `version` in `package.json` (currently `0.1.0`).
- [ ] Update `CHANGELOG.md` with the notes for this version (the file already exists).

---

## 2. `package.json` readiness

Publish metadata is already in place (verify with `git diff` / a quick read):
`author`, `keywords`, `homepage`, `repository`, `bugs`, and
`publishConfig: { "access": "public" }` are set; `"files"` already includes
`dist`, `dist-cli`, `README.md`, `CHANGELOG.md`, and `LICENSE`
(`npm pack --dry-run` confirms a 10-file, ~256 kB tarball with no source or DB).

**The one remaining gate is deliberate:**

- [ ] **Flip the private gate**: the package is `"private": true`, which blocks
  `npm publish`. Set `"private": false` (or remove the key) **only when you
  actually intend to publish**.
- [ ] Confirm `dist` and `dist-cli` are freshly built (step 1) before packing.
- [ ] Point `repository`/`homepage`/`bugs` at the real repo URL once created (step 3) if the org/name differs from the pre-filled `Aster-Works/aster-agent-console`.

---

## 3. git + GitHub (irreversible — human-triggered)

The repo is **not yet git-initialized** (no `.git/`). Match the sibling `aster-guard` setup (Aster-Works org).

```bash
git init
git branch -M main   # ensure the branch is 'main' (git default varies by config)
git add -A
git commit -m "chore: initial commit for beta release"
```

Note: `.gitignore` already excludes `node_modules`, `dist`, `dist-cli`, `.env*`, `*.log`, and `.aster-agent-console` — confirm no local `.db`, spool, or backup files are staged before committing.

Then create the GitHub repo and push (do this yourself; verify the org/name first):

```bash
gh repo create Aster-Works/aster-agent-console --public --source=. --remote=origin
git push -u origin main
```

- [ ] Repo lives under the **Aster-Works** org, consistent with `aster-guard`.
- [ ] `repository`/`homepage`/`bugs` in `package.json` (step 2) match the pushed URL.

---

## 4. npm publish (irreversible — human-triggered)

Inspect the tarball contents **before** publishing:

```bash
npm publish --dry-run
```

Confirm the file list is `dist/web`, `dist-cli/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json` — no source, no `.db`, no secrets. Then publish:

```bash
npm publish --access public   # --access public required on first publish of a scoped package
```

- [ ] If `publishConfig.access=public` was set in step 2, `--access public` is redundant but harmless.
- [ ] Publishing under 2FA may need an **npm Automation token** (same as the `aster-guard` project). Set `NPM_TOKEN` in your environment / `~/.npmrc` if interactive 2FA is unavailable.

---

## 5. GitHub release

- [ ] Tag matches the published version (e.g. `v0.1.0`), CHANGELOG notes in the body:

```bash
git tag v$(node -p "require('./package.json').version")
git push --tags
gh release create v$(node -p "require('./package.json').version") --notes-file CHANGELOG.md
```

---

## 6. Post-publish smoke test

From a **clean directory** (not the repo), confirm the published beta runs end to end:

```bash
cd "$(mktemp -d)"
npx @asterworks/agent-console doctor
```

`doctor` checks Node version, local storage, collector health, and hook status. Also sanity-check the read-only scanner:

```bash
npx @asterworks/agent-console scan .
```

- [ ] `npx @asterworks/agent-console <cmd>` resolves the `aster-agent` binary and runs.
- [ ] No unexpected files written outside `~/.aster-agent-console/`.

---

## Reminders

- This is a **beta**. Redaction is best-effort defense-in-depth, not a guarantee; the MCP scan is static/heuristic (JSON MCP configs only — Codex's TOML `config.toml` is not parsed), not exhaustive. Don't overclaim in release notes.
- End-user install docs mention only `npm install -g` / `npx` — never pnpm/corepack (that's contributor-only).
- Steps 3 and 4 cannot be undone (git history is public, npm versions are immutable). Verify org, package name, and version before running them.
