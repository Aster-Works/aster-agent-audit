/**
 * Hook installer (Phase 4). Safety guarantees:
 *  - The agent's existing config is ALWAYS backed up before any change.
 *  - Changes are additive and fenced/marked so they can be cleanly removed.
 *  - Nothing is written in dry-run mode.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { BACKUP_DIR, HOOKS_DIR, PORT, HOST } from "../util/paths";
import { detectAgents, type AgentDetection } from "../util/detect";
import { hookScript } from "./script";

const ENDPOINT = `http://${HOST}:${PORT}/events`;
const MARKER = "aster-agent-console";
const CLAUDE_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop"] as const;
const FENCE_START = "# >>> aster-agent-console (managed) >>>";
const FENCE_END = "# <<< aster-agent-console (managed) <<<";

export type HookAction = {
  agent: string;
  label: string;
  action: "installed" | "already" | "skipped" | "would-install" | "removed" | "not-installed";
  detail: string;
  backup?: string;
};

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function backup(file: string): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = join(BACKUP_DIR, `${basename(file)}.${stamp()}.bak`);
  copyFileSync(file, dest);
  return dest;
}

function writeHookFile(agent: string): string {
  mkdirSync(HOOKS_DIR, { recursive: true });
  const path = join(HOOKS_DIR, `${agent}-hook.mjs`);
  writeFileSync(path, hookScript(agent, ENDPOINT), { mode: 0o755 });
  return path;
}

function quote(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

// ---- Claude Code (settings.json hooks) ------------------------------------

function installClaude(det: AgentDetection, dryRun: boolean): HookAction {
  const target = det.configPaths.find((p) => p.exists) ?? det.configPaths[0];
  const file = target.path;

  if (det.hookInstalled) {
    return { agent: "claude-code", label: "Claude Code", action: "already", detail: file };
  }
  if (dryRun) {
    return { agent: "claude-code", label: "Claude Code", action: "would-install", detail: file };
  }

  let settings: Record<string, unknown> = {};
  let backupPath: string | undefined;
  if (existsSync(file)) {
    backupPath = backup(file);
    try {
      settings = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  } else {
    mkdirSync(join(file, ".."), { recursive: true });
  }

  const hookPath = writeHookFile("claude-code");
  const command = `node ${quote(hookPath)}`;
  const hooks = (settings.hooks ??= {}) as Record<string, unknown[]>;

  for (const event of CLAUDE_EVENTS) {
    const arr = (hooks[event] ??= []) as Array<{ matcher?: string; hooks?: Array<{ type: string; command: string }> }>;
    const present = arr.some((g) => g.hooks?.some((h) => h.command?.includes(MARKER)));
    if (!present) {
      const isTool = event === "PreToolUse" || event === "PostToolUse";
      arr.push({ ...(isTool ? { matcher: "*" } : {}), hooks: [{ type: "command", command }] });
    }
  }

  writeFileSync(file, JSON.stringify(settings, null, 2));
  return { agent: "claude-code", label: "Claude Code", action: "installed", detail: file, backup: backupPath };
}

// ---- Codex (config.toml notify, fenced + reversible) ----------------------

function installCodex(det: AgentDetection, dryRun: boolean): HookAction {
  const target = det.configPaths.find((p) => p.exists && p.path.endsWith("config.toml")) ?? det.configPaths[0];
  const file = target.path;

  if (det.hookInstalled) {
    return { agent: "codex", label: "Codex", action: "already", detail: file };
  }
  if (dryRun) {
    return { agent: "codex", label: "Codex", action: "would-install", detail: file };
  }

  let backupPath: string | undefined;
  let body = "";
  if (existsSync(file)) {
    backupPath = backup(file);
    body = readFileSync(file, "utf8");
  } else {
    mkdirSync(join(file, ".."), { recursive: true });
  }

  const hookPath = writeHookFile("codex");
  // `notify` runs a program with the event JSON; our hook also reads argv.
  const block = [
    FENCE_START,
    "# Forwards Codex events to the local Aster Agent Console collector.",
    "# Remove this block (or run `aster-agent hooks uninstall`) to disable.",
    `notify = ["node", ${JSON.stringify(hookPath)}]`,
    FENCE_END,
    "",
  ].join("\n");

  // Comment out any existing top-level notify so ours takes effect (reversible via backup).
  body = body.replace(/^(\s*notify\s*=.*)$/gm, "# [aster-agent] disabled: $1");
  const next = (body.trimEnd() + "\n\n" + block).trimStart();
  writeFileSync(file, next);
  return { agent: "codex", label: "Codex", action: "installed", detail: file, backup: backupPath };
}

// ---- Public API -----------------------------------------------------------

export function installHooks(dryRun = false, cwd = process.cwd()): HookAction[] {
  const agents = detectAgents(cwd);
  const out: HookAction[] = [];
  for (const det of agents) {
    if (!det.present) {
      out.push({ agent: det.agent, label: det.label, action: "skipped", detail: "not detected" });
      continue;
    }
    out.push(det.agent === "claude-code" ? installClaude(det, dryRun) : installCodex(det, dryRun));
  }
  return out;
}

export function uninstallHooks(cwd = process.cwd()): HookAction[] {
  const agents = detectAgents(cwd);
  const out: HookAction[] = [];
  for (const det of agents) {
    const target = det.configPaths.find((p) => p.exists);
    if (!target || !det.hookInstalled) {
      out.push({ agent: det.agent, label: det.label, action: "not-installed", detail: target?.path ?? "—" });
      continue;
    }
    const file = target.path;
    const backupPath = backup(file);
    if (det.agent === "claude-code") {
      try {
        const settings = JSON.parse(readFileSync(file, "utf8")) as { hooks?: Record<string, unknown[]> };
        const hooks = settings.hooks ?? {};
        for (const event of Object.keys(hooks)) {
          hooks[event] = (hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>).filter(
            (g) => !g.hooks?.some((h) => h.command?.includes(MARKER))
          );
          if ((hooks[event] as unknown[]).length === 0) delete hooks[event];
        }
        writeFileSync(file, JSON.stringify(settings, null, 2));
      } catch {
        /* leave backup in place */
      }
    } else {
      let body = readFileSync(file, "utf8");
      const fence = new RegExp(`\\n?${escapeRe(FENCE_START)}[\\s\\S]*?${escapeRe(FENCE_END)}\\n?`, "g");
      body = body.replace(fence, "\n");
      body = body.replace(/^# \[aster-agent\] disabled: (.*)$/gm, "$1");
      writeFileSync(file, body);
    }
    out.push({ agent: det.agent, label: det.label, action: "removed", detail: file, backup: backupPath });
  }
  return out;
}

export function hooksStatus(cwd = process.cwd()): {
  agent: string;
  label: string;
  present: boolean;
  installed: boolean;
  configPath?: string;
}[] {
  return detectAgents(cwd).map((d) => ({
    agent: d.agent,
    label: d.label,
    present: d.present,
    installed: d.hookInstalled,
    configPath: d.configPaths.find((p) => p.exists)?.path,
  }));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
