/**
 * Parse a Codex rollout transcript (~/.codex/sessions/<date>/rollout-*.jsonl)
 * into synthetic hook payloads that the normal collector pipeline can ingest.
 *
 * Codex does NOT push tool-level events over its single `notify` slot — the
 * rich record of what it did (commands, exit codes, patched files, MCP calls)
 * lives only in the rollout log. We read that log instead of wiring a hook, so
 * Codex collection needs zero config changes and can't clobber other `notify`
 * consumers (e.g. Codex Computer Use). Token/cost still come from usage.ts.
 *
 * Pure & filesystem-free so it is unit-testable. Deterministic event ids
 * (fileKey + line index) make re-parsing idempotent under `insert or replace`.
 * Nothing here executes anything; command/output text is redacted downstream in
 * normalizeHookEvent before it reaches the DB.
 */
import { fingerprint } from "./redaction";

/** A synthetic hook event ready for collector.ingest("codex", payload, {id}). */
export type CodexSyntheticEvent = {
  id: string;
  payload: Record<string, unknown>;
};

export type CodexParseResult = {
  events: CodexSyntheticEvent[];
  /** number of complete lines consumed; use as `fromLine` on the next parse */
  processedLines: number;
};

const MAX_OUTPUT_CHARS = 2000;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** exec_command / apply_patch outputs report the exit status in plain text. */
function parseExitCode(output: string): number | undefined {
  const m =
    output.match(/exited with code (\d+)/i) || output.match(/Exit code:\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

/** Codex tool outputs report execution time as `Wall time: N seconds`. */
function parseWallMs(output: string): number | undefined {
  const m = output.match(/Wall time:\s*([\d.]+)\s*seconds/i);
  if (!m) return undefined;
  const s = Number(m[1]);
  return Number.isFinite(s) ? Math.round(s * 1000) : undefined;
}

function outputText(output: unknown): string {
  const s = typeof output === "string" ? output : JSON.stringify(output ?? "");
  return s.length > MAX_OUTPUT_CHARS ? s.slice(0, MAX_OUTPUT_CHARS) + "…" : s;
}

/**
 * @param text     full rollout file contents
 * @param fileKey  stable key for the file (its path) — seeds deterministic ids
 * @param fromLine only emit events for source lines >= fromLine (dedup); the
 *                 call→output correlation still scans from the top.
 */
export function parseCodexRollout(text: string, fileKey: string, fromLine = 0): CodexParseResult {
  const lines = text.split("\n");
  // Drop a possibly-incomplete trailing line: process only lines proven complete
  // by a following newline. "a\nb\n" → ["a","b",""]; "a\nb" → ["a","b"].
  const complete = lines.slice(0, Math.max(0, lines.length - 1));

  const events: CodexSyntheticEvent[] = [];
  const calls = new Map<string, { name: string; command: string; ts: string }>();

  let sessionId = "";
  let cwd = "";

  const mkId = (line: number, kind: string, sub = 0) =>
    "evt_cdx_" + fingerprint(`${fileKey}:${line}:${kind}:${sub}`);

  const emit = (line: number, kind: string, payload: Record<string, unknown>, sub = 0) => {
    if (line < fromLine) return;
    events.push({ id: mkId(line, kind, sub), payload });
  };

  for (let i = 0; i < complete.length; i++) {
    const raw = complete[i];
    if (!raw.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = str(o.timestamp) || undefined;
    const p = asObj(o.payload);
    const kind = str(p.type);

    if (o.type === "session_meta") {
      sessionId = str(p.session_id) || str(p.id) || sessionId;
      cwd = str(p.cwd) || cwd;
      emit(i, "start", {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd,
        timestamp: str(p.timestamp) || ts,
      });
      continue;
    }
    if (o.type === "turn_context") {
      cwd = str(p.cwd) || cwd;
      continue;
    }

    // A single response_item line.
    if (o.type === "response_item") {
      const callId = str(p.call_id) || str(p.id);
      if (kind === "function_call") {
        let cmd = "";
        try {
          cmd = str(asObj(JSON.parse(str(p.arguments))).cmd);
        } catch {
          /* non-exec tool (e.g. list_directory) has no cmd */
        }
        const name = str(p.name) || "tool";
        if (callId) calls.set(callId, { name, command: cmd, ts: ts ?? "" });
        emit(i, "pre", {
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          cwd,
          tool_name: name,
          tool_input: cmd ? { command: cmd } : {},
          timestamp: ts,
        });
      } else if (kind === "function_call_output") {
        const call = callId ? calls.get(callId) : undefined;
        const out = outputText(p.output);
        emit(i, "post", {
          hook_event_name: "PostToolUse",
          session_id: sessionId,
          cwd,
          tool_name: call?.name ?? "tool",
          tool_input: call?.command ? { command: call.command } : {},
          tool_response: { exit_code: parseExitCode(out), duration_ms: parseWallMs(out), output: out },
          timestamp: ts,
        });
      } else if (kind === "custom_tool_call" && str(p.name) === "apply_patch") {
        // Emit only the PRE here (latency start); the authoritative file list +
        // success come from the paired `patch_apply_end` event below.
        if (callId) calls.set(callId, { name: "apply_patch", command: "", ts: ts ?? "" });
        emit(i, "pre", {
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          cwd,
          tool_name: "apply_patch",
          tool_input: {},
          timestamp: ts,
        });
      }
      continue;
    }

    if (o.type === "event_msg") {
      if (kind === "patch_apply_end") {
        const files = Object.keys(asObj(p.changes));
        const exit = p.success === false ? 1 : 0;
        const list = files.length ? files : [""];
        list.forEach((f, sub) => {
          emit(
            i,
            "patch",
            {
              hook_event_name: "PostToolUse",
              session_id: sessionId,
              cwd,
              tool_name: "apply_patch",
              tool_input: f ? { file_path: f } : {},
              tool_response: { exit_code: exit },
              timestamp: ts,
            },
            sub
          );
        });
      } else if (kind === "user_message") {
        const promptText = str(p.message) || str(p.text);
        if (promptText) {
          emit(i, "prompt", {
            hook_event_name: "UserPromptSubmit",
            session_id: sessionId,
            cwd,
            prompt: promptText,
            timestamp: ts,
          });
        }
      } else if (kind === "task_complete") {
        emit(i, "stop", {
          hook_event_name: "Stop",
          session_id: sessionId,
          cwd,
          timestamp: ts,
        });
      }
      // mcp_tool_call_end is intentionally skipped: the same call already
      // appears as a response_item/function_call (same call_id), so counting
      // both would double every MCP tool call.
      continue;
    }
  }

  return { events, processedLines: complete.length };
}
