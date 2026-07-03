/**
 * Detect possible Claude Code / Codex configuration locations. Read-only: this
 * never modifies any file (used by `init --dry-run` and `doctor`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ConfigPath = {
  path: string;
  exists: boolean;
  scope: "user" | "project";
};

export type AgentDetection = {
  agent: "claude-code" | "codex";
  label: string;
  present: boolean;
  configPaths: ConfigPath[];
  /** an Aster Agent Console hook is already wired into this agent's config */
  hookInstalled: boolean;
};

function entry(path: string, scope: "user" | "project"): ConfigPath {
  return { path, exists: existsSync(path), scope };
}

function fileMentions(path: string, needle: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, "utf8").includes(needle);
  } catch {
    return false;
  }
}

export function detectAgents(cwd: string = process.cwd()): AgentDetection[] {
  const home = homedir();

  const claudePaths: ConfigPath[] = [
    entry(join(home, ".claude", "settings.json"), "user"),
    entry(join(cwd, ".claude", "settings.json"), "project"),
    entry(join(cwd, ".claude", "settings.local.json"), "project"),
  ];
  const codexPaths: ConfigPath[] = [
    entry(join(home, ".codex", "config.toml"), "user"),
    entry(join(home, ".codex", "hooks.toml"), "user"),
    entry(join(cwd, ".codex", "config.toml"), "project"),
  ];

  const claudeHook = claudePaths.some((p) => fileMentions(p.path, "aster-agent"));
  const codexHook = codexPaths.some((p) => fileMentions(p.path, "aster-agent"));

  return [
    {
      agent: "claude-code",
      label: "Claude Code",
      present: claudePaths.some((p) => p.exists) || existsSync(join(home, ".claude")),
      configPaths: claudePaths,
      hookInstalled: claudeHook,
    },
    {
      agent: "codex",
      label: "Codex",
      present: codexPaths.some((p) => p.exists) || existsSync(join(home, ".codex")),
      configPaths: codexPaths,
      hookInstalled: codexHook,
    },
  ];
}
