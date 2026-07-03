import { describe, it, expect } from "vitest";
import { parseCodexRollout } from "../src/core/codex-rollout";

// Fixture mirrors the real rollout shape: session_meta, response_item
// (function_call / function_call_output / custom_tool_call), and event_msg
// (patch_apply_end / user_message / task_complete / mcp_tool_call_end).
const LINES = [
  { type: "session_meta", payload: { type: "session_meta", session_id: "sess-abc", cwd: "/repo" } },
  { timestamp: "2026-07-04T00:00:01Z", type: "turn_context", payload: { type: "turn_context", cwd: "/repo", model: "gpt-5.5" } },
  { timestamp: "2026-07-04T00:00:02Z", type: "event_msg", payload: { type: "user_message", message: "please build it" } },
  { timestamp: "2026-07-04T00:00:03Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: JSON.stringify({ cmd: "npm test", workdir: "/repo" }) } },
  { timestamp: "2026-07-04T00:00:05Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "Wall time: 1.0 seconds\nProcess exited with code 1\n" } },
  { timestamp: "2026-07-04T00:00:06Z", type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "p1", input: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch" } },
  { timestamp: "2026-07-04T00:00:07Z", type: "event_msg", payload: { type: "patch_apply_end", call_id: "p1", success: true, changes: { "src/a.ts": {}, "src/b.ts": {} } } },
  // mcp_tool_call_end must be skipped (same call already came as a function_call)
  { timestamp: "2026-07-04T00:00:08Z", type: "response_item", payload: { type: "function_call", name: "mcp__x__do", call_id: "m1", arguments: "{}" } },
  { timestamp: "2026-07-04T00:00:09Z", type: "response_item", payload: { type: "function_call_output", call_id: "m1", output: "Wall time: 0.1 seconds\n" } },
  { timestamp: "2026-07-04T00:00:10Z", type: "event_msg", payload: { type: "mcp_tool_call_end", call_id: "m1", invocation: { server: "x", tool: "do" }, duration: { secs: 0, nanos: 1 } } },
  { timestamp: "2026-07-04T00:00:11Z", type: "event_msg", payload: { type: "task_complete", turn_id: "t1" } },
];
const TEXT = LINES.map((l) => JSON.stringify(l)).join("\n") + "\n";

describe("parseCodexRollout", () => {
  it("maps rollout items to synthetic hook payloads", () => {
    const { events } = parseCodexRollout(TEXT, "file-key");
    const kinds = events.map((e) => (e.payload as any).hook_event_name);
    expect(kinds).toContain("SessionStart");
    expect(kinds).toContain("UserPromptSubmit");
    expect(kinds.filter((k) => k === "Stop")).toHaveLength(1);

    // exec_command pre + post, with exit code and command carried to the post.
    const post = events.find(
      (e) => (e.payload as any).hook_event_name === "PostToolUse" && (e.payload as any).tool_name === "exec_command"
    )!;
    expect((post.payload as any).tool_response.exit_code).toBe(1);
    expect((post.payload as any).tool_input.command).toBe("npm test");
  });

  it("emits one apply_patch post per changed file, no double-count", () => {
    const { events } = parseCodexRollout(TEXT, "file-key");
    const patchPosts = events.filter(
      (e) => (e.payload as any).hook_event_name === "PostToolUse" && (e.payload as any).tool_name === "apply_patch"
    );
    expect(patchPosts.map((e) => (e.payload as any).tool_input.file_path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("skips mcp_tool_call_end (already counted as a function_call)", () => {
    const { events } = parseCodexRollout(TEXT, "file-key");
    const mcp = events.filter((e) => (e.payload as any).tool_name === "mcp__x__do");
    // exactly one pre + one post, not three
    expect(mcp).toHaveLength(2);
  });

  it("is idempotent: re-parsing from the returned offset yields nothing new", () => {
    const first = parseCodexRollout(TEXT, "file-key");
    const second = parseCodexRollout(TEXT, "file-key", first.processedLines);
    expect(second.events).toHaveLength(0);
  });

  it("produces deterministic ids across parses", () => {
    const a = parseCodexRollout(TEXT, "file-key").events.map((e) => e.id);
    const b = parseCodexRollout(TEXT, "file-key").events.map((e) => e.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // no collisions
  });

  it("does not process an incomplete trailing line until it is newline-terminated", () => {
    const partial = JSON.stringify(LINES[0]) + "\n" + '{"type":"response_item","payload":{"type":"func';
    const { events, processedLines } = parseCodexRollout(partial, "k");
    expect(processedLines).toBe(1); // only the complete session_meta line
    expect(events).toHaveLength(1);
  });
});
