/**
 * Normalize untrusted hook payloads (Claude Code / Codex) into the canonical
 * NormalizedAgentEvent (04 §8, §10). Unknown fields are not trusted; only known
 * fields are mapped. Input/output are redacted here, before they ever reach the
 * DB. AI internal reasoning is never parsed.
 */
import { z } from "zod";
import type {
  AgentEventType,
  AgentName,
  NormalizedAgentEvent,
  RedactionKind,
} from "./types";
import { redactJson, redactString } from "./redaction";
import { classifyCommand, parseTestResult } from "./classify";

const HookSchema = z
  .object({
    session_id: z.string().optional(),
    sessionId: z.string().optional(),
    turn_id: z.string().optional(),
    turnId: z.string().optional(),
    cwd: z.string().optional(),
    repo_path: z.string().optional(),
    transcript_path: z.string().optional(),
    hook_event_name: z.string().optional(),
    model: z.string().optional(),
    tool_name: z.string().optional(),
    toolName: z.string().optional(),
    tool_input: z.unknown().optional(),
    tool_response: z.unknown().optional(),
    prompt: z.string().optional(),
    message: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

const EVENT_NAME_MAP: Record<string, AgentEventType> = {
  sessionstart: "session_start",
  userpromptsubmit: "user_prompt",
  pretooluse: "pre_tool_use",
  posttooluse: "post_tool_use",
  stop: "session_stop",
  sessionend: "session_stop",
  subagentstop: "session_stop",
  notification: "error",
  error: "error",
};

let seq = 0;
function eventId(seed: string): string {
  seq = (seq + 1) % 1_000_000;
  let h = 0x811c9dc5;
  const s = seed + ":" + seq + ":" + Date.now();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "evt_" + (h >>> 0).toString(16).padStart(8, "0") + seq.toString(36);
}

function mapType(name: string | undefined, hasTool: boolean, hasPrompt: boolean): AgentEventType {
  if (name) {
    const key = name.toLowerCase().replace(/[_\s-]/g, "");
    if (EVENT_NAME_MAP[key]) return EVENT_NAME_MAP[key];
  }
  if (hasTool) return "post_tool_use";
  if (hasPrompt) return "user_prompt";
  return "session_start";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function summarizeCommand(input: Record<string, unknown>): string {
  return pick(input, ["command", "cmd", "script"]);
}

function buildTitle(
  type: AgentEventType,
  toolName: string,
  input: Record<string, unknown>,
  prompt: string
): string {
  const cmd = summarizeCommand(input);
  const file = pick(input, ["file_path", "path", "filePath", "target"]);
  switch (type) {
    case "session_start":
      return "Session started";
    case "session_stop":
      return "Session ended";
    case "user_prompt":
      return truncate(prompt || "User prompt", 90);
    case "pre_tool_use":
      if (cmd) return truncate(`Run ${cmd}`, 90);
      if (file) return truncate(`${toolName || "Tool"} ${file}`, 90);
      return `Call ${toolName || "tool"}`;
    case "post_tool_use":
      return `${toolName || "Tool"} complete`;
    case "test_result":
      return cmd ? truncate(`Test: ${cmd}`, 90) : "Test run";
    case "git_event": {
      const m = cmd.match(/-m\s+["']([^"']+)["']/);
      return m ? truncate(`Commit: ${m[1]}`, 90) : "Git commit";
    }
    default:
      return toolName ? `${toolName} event` : "Event";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export type NormalizeResult = {
  event: NormalizedAgentEvent;
  /** kinds of secrets found in tool input (drives the secrets risk rule) */
  secretKinds: RedactionKind[];
  /** repo-relative file paths touched, for file_change rows */
  files: string[];
};

export function normalizeHookEvent(
  agentHint: AgentName,
  payload: unknown
): NormalizeResult {
  const parsed = HookSchema.safeParse(payload);
  const data = parsed.success ? parsed.data : {};

  const agent: AgentName = agentHint ?? "unknown";
  const sessionId =
    data.session_id || data.sessionId || `sess_${eventId("s").slice(4)}`;
  const turnId = data.turn_id || data.turnId || undefined;
  const cwd = data.cwd || undefined;
  const repoPath = data.repo_path || cwd || undefined;
  const model = data.model || undefined;
  const toolName = data.tool_name || data.toolName || "";
  const rawInput = asRecord(data.tool_input);
  const rawOutput = asRecord(data.tool_response);
  const prompt = data.prompt || data.message || "";

  let type = mapType(
    data.hook_event_name,
    Boolean(toolName || Object.keys(rawInput).length),
    Boolean(prompt)
  );

  // Redact input/output before they are ever returned/stored.
  const redactedInput = redactJson({ ...rawInput, prompt: prompt || undefined }, "$.input");
  const redactedOutput = redactJson(rawOutput, "$.output");
  const secretKinds = redactedInput.redactions.map((r) => r.kind);

  // Build titles/summaries from REDACTED values so a secret can never leak
  // into a display string (titles are stored too).
  const safeInput = (redactedInput.value ?? {}) as Record<string, unknown>;
  const safePrompt = redactString(prompt).text;

  const now = new Date().toISOString();
  const timestamp = data.timestamp || now;

  const exitCode =
    typeof rawOutput.exit_code === "number"
      ? rawOutput.exit_code
      : typeof rawOutput.exitCode === "number"
      ? rawOutput.exitCode
      : undefined;

  // Phase 5: refine a completed command into a test_result / git_event so the
  // dashboard can audit tests and commits. Classify on the REDACTED command
  // (command keywords are not secrets). A commit only counts if it succeeded.
  const commandText = pick(safeInput, ["command", "cmd", "script"]);
  if (type === "post_tool_use" && commandText) {
    const refined = classifyCommand(commandText);
    if (refined === "test_result") type = "test_result";
    else if (refined === "git_event" && (exitCode == null || exitCode === 0)) type = "git_event";
  }

  // For test results, parse the redacted output so a runner that reports
  // failures but exits 0 is still recorded as failing.
  let derivedExit = exitCode;
  if (type === "test_result") {
    const outText = JSON.stringify(redactedOutput.value ?? {});
    const outcome = parseTestResult(exitCode, outText);
    derivedExit = outcome.ok ? 0 : exitCode ?? 1;
  }

  const file = pick(safeInput, ["file_path", "path", "filePath", "target"]);

  const event: NormalizedAgentEvent = {
    id: eventId(sessionId + type),
    agent,
    source: "hook",
    type,
    sessionId,
    turnId,
    repoPath,
    cwd,
    timestamp,
    receivedAt: now,
    model,
    toolName: toolName || undefined,
    title: buildTitle(type, toolName, safeInput, safePrompt),
    summary: type === "user_prompt" ? truncate(safePrompt, 160) : undefined,
    input: redactedInput.redactions.length || Object.keys(rawInput).length ? redactedInput : undefined,
    output: redactedOutput.redactions.length || Object.keys(rawOutput).length ? redactedOutput : undefined,
    metrics: derivedExit != null ? { exitCode: derivedExit } : undefined,
    links: file ? { files: [file] } : undefined,
  };

  return { event, secretKinds, files: file ? [file] : [] };
}
