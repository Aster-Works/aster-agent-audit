/**
 * `aster-audit policy validate [dir]` — validate the policy chain and exit
 * non-zero on errors (CI-friendly).
 * `aster-audit policy test [dir]` — show what the effective policy actually
 * DOES: which files were loaded, in what order, which rules end up
 * suppressed or severity-overridden, and where the scan gate sits.
 *
 * Neither command modifies anything.
 */
import pc from "picocolors";
import { resolveRule, ruleRegistry } from "../../core/rules/registry";
import { loadPolicyChain } from "../../server/mcp-scan";
import { CONFIG_DIR } from "../util/paths";
import { brand, check, heading, line, sym } from "../util/ui";

export function policyValidateCmd(dir?: string): void {
  brand();
  heading("Policy validation");
  const loaded = loadPolicyChain(CONFIG_DIR, dir ?? process.cwd());

  if (loaded.sources.length === 0 && loaded.errors.length === 0) {
    check("warn", "No policy files found", "running on built-in defaults (failOn high, nothing ignored)");
  }
  for (const s of loaded.sources) check(true, `Loaded (${s.scope})`, s.path);
  for (const w of loaded.warnings) line(`  ${sym.warn} ${w}`);
  for (const e of loaded.errors) line(`  ${sym.fail} ${e}`);

  heading("Result");
  if (loaded.errors.length) {
    line(`  ${pc.red(`${loaded.errors.length} error(s)`)} — files with errors are NOT applied.`);
    process.exitCode = 1;
  } else {
    line(`  ${pc.green("Policy chain is valid.")}${loaded.warnings.length ? pc.dim(`  (${loaded.warnings.length} warning(s) above)`) : ""}`);
  }
  line("");
}

export function policyTestCmd(dir?: string): void {
  brand();
  heading("Effective policy");
  const loaded = loadPolicyChain(CONFIG_DIR, dir ?? process.cwd());
  const p = loaded.policy;

  if (loaded.errors.length) {
    for (const e of loaded.errors) line(`  ${sym.fail} ${e}`);
    line(`  ${pc.dim("Files with errors are skipped; the effective policy below excludes them.")}`);
  }
  for (const s of loaded.sources) line(`  ${sym.bullet} ${s.scope.padEnd(4)} ${pc.dim(s.path)}`);
  if (loaded.sources.length === 0) line(`  ${sym.bullet} ${pc.dim("no policy files — built-in defaults")}`);
  line("");

  line(`  failOn            ${pc.bold(p.failOn ?? "high (default)")}`);
  line(`  allowedMcpHosts   ${p.allowedMcpHosts?.length ? p.allowedMcpHosts.join(", ") : pc.dim("none")}`);

  const suppressed: string[] = [];
  const overridden: string[] = [];
  for (const id of p.ignoreRules ?? []) suppressed.push(id);
  for (const [id, o] of Object.entries(p.rules ?? {})) {
    if (o.enabled === false) suppressed.push(id);
    else if (o.severity) overridden.push(`${id} → ${o.severity}`);
  }
  line(`  suppressed rules  ${suppressed.length ? "" : pc.dim("none")}`);
  for (const id of suppressed) {
    const def = resolveRule(id);
    line(`    ${sym.warn} ${id}${def ? pc.dim(`  ${def.title} (default ${def.defaultSeverity})`) : pc.dim("  (unknown rule id)")}`);
  }
  line(`  severity overrides ${overridden.length ? "" : pc.dim("none")}`);
  for (const s of overridden) line(`    ${sym.bullet} ${s}`);

  const total = ruleRegistry().length;
  line("");
  line(`  ${pc.dim(`${total - suppressed.length}/${total} shipped rules active.`)}`);
  line("");
}
