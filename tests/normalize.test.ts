import { describe, it, expect } from "vitest";
import { normalizeHookEvent } from "@core/normalize";

describe("normalize", () => {
  it("maps a Claude Code PostToolUse Bash event", () => {
    const { event } = normalizeHookEvent("claude-code", {
      session_id: "abc",
      cwd: "/repo",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_response: { exit_code: 0 },
    });
    expect(event.agent).toBe("claude-code");
    expect(event.type).toBe("post_tool_use");
    expect(event.sessionId).toBe("abc");
    expect(event.toolName).toBe("Bash");
    expect(event.metrics?.exitCode).toBe(0);
  });

  it("maps a Codex exec_command event with a turn id", () => {
    const { event } = normalizeHookEvent("codex", {
      session_id: "xyz",
      turn_id: "turn-1",
      cwd: "/repo",
      model: "gpt-5-codex",
      hook_event_name: "PostToolUse",
      tool_name: "exec_command",
      tool_input: { cmd: "pnpm test" },
      tool_response: { exit_code: 0 },
    });
    expect(event.agent).toBe("codex");
    expect(event.turnId).toBe("turn-1");
    expect(event.model).toBe("gpt-5-codex");
  });

  it("maps event names to normalized types", () => {
    const t = (name: string) =>
      normalizeHookEvent("claude-code", { session_id: "s", hook_event_name: name }).event.type;
    expect(t("SessionStart")).toBe("session_start");
    expect(t("UserPromptSubmit")).toBe("user_prompt");
    expect(t("PreToolUse")).toBe("pre_tool_use");
    expect(t("Stop")).toBe("session_stop");
  });

  it("redacts secrets in tool input and reports secret kinds", () => {
    const { event, secretKinds } = normalizeHookEvent("claude-code", {
      session_id: "s",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "export ANTHROPIC_API_KEY=sk-ant-api03-AAAABBBBCCCCDDDD3f9a" },
    });
    const inputJson = JSON.stringify(event.input);
    expect(inputJson).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDD3f9a");
    expect(secretKinds.length).toBeGreaterThan(0);
  });

  it("never throws on a malformed payload", () => {
    expect(() => normalizeHookEvent("unknown", null)).not.toThrow();
    expect(() => normalizeHookEvent("unknown", { nonsense: [1, 2, 3] })).not.toThrow();
    const { event } = normalizeHookEvent("unknown", 42);
    expect(event.sessionId).toBeTruthy();
  });

  it("reclassifies a test command result as test_result", () => {
    const { event } = normalizeHookEvent("claude-code", {
      session_id: "s",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "pnpm test" },
      tool_response: { exit_code: 0 },
    });
    expect(event.type).toBe("test_result");
  });

  it("reclassifies a successful commit as git_event with a Commit title", () => {
    const { event } = normalizeHookEvent("codex", {
      session_id: "s",
      hook_event_name: "PostToolUse",
      tool_name: "exec_command",
      tool_input: { command: 'git add -A && git commit -m "feat: orchestration"' },
      tool_response: { exit_code: 0 },
    });
    expect(event.type).toBe("git_event");
    expect(event.title).toBe("Commit: feat: orchestration");
  });

  it("does not treat a dry-run or failed commit as a git_event", () => {
    const dry = normalizeHookEvent("claude-code", {
      session_id: "s", hook_event_name: "PostToolUse", tool_name: "Bash",
      tool_input: { command: "git commit --dry-run" }, tool_response: { exit_code: 0 },
    }).event;
    expect(dry.type).toBe("post_tool_use");

    const failed = normalizeHookEvent("claude-code", {
      session_id: "s", hook_event_name: "PostToolUse", tool_name: "Bash",
      tool_input: { command: 'git commit -m "x"' }, tool_response: { exit_code: 1 },
    }).event;
    expect(failed.type).toBe("post_tool_use");
  });

  it("builds a user-prompt title from the prompt", () => {
    const { event } = normalizeHookEvent("claude-code", {
      session_id: "s",
      hook_event_name: "UserPromptSubmit",
      prompt: "Implement session orchestration for the collector",
    });
    expect(event.type).toBe("user_prompt");
    expect(event.title).toContain("Implement session orchestration");
  });
});
