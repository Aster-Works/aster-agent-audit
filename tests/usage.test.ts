import { describe, it, expect } from "vitest";
import { parseClaudeUsage, parseCodexUsage, estimateCost } from "../src/server/usage";

// Fixtures mirror the real transcript shapes (Claude per-turn usage; Codex
// cumulative info.total_token_usage).

const CLAUDE = [
  JSON.stringify({ type: "user", message: { role: "user" } }),
  JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 },
    },
  }),
  JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
    },
  }),
  "not json — must be skipped, not throw",
].join("\n");

const CODEX = [
  JSON.stringify({ type: "session_meta", payload: { id: "abc", cwd: "/tmp/x", model: "gpt-5.5" } }),
  JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100, total_tokens: 1100 } } },
  }),
  JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: 2000, cached_input_tokens: 800, output_tokens: 250, total_tokens: 2250 } } },
  }),
].join("\n");

describe("parseClaudeUsage", () => {
  it("sums per-turn usage and reads the model", () => {
    const u = parseClaudeUsage(CLAUDE)!;
    expect(u.inputTokens).toBe(110);
    expect(u.outputTokens).toBe(220);
    expect(u.cachedInputTokens).toBe(1100);
    expect(u.cacheWriteTokens).toBe(55);
    expect(u.totalTokens).toBe(1485);
    expect(u.model).toBe("claude-opus-4-8");
    // (110*15 + 220*75 + 1100*1.5 + 55*18.75) / 1e6
    expect(u.costUsd).toBeCloseTo(0.0208, 4);
  });
  it("returns null for empty / usage-free input", () => {
    expect(parseClaudeUsage("")).toBeNull();
    expect(parseClaudeUsage('{"type":"user"}')).toBeNull();
  });
});

describe("parseCodexUsage", () => {
  it("takes the LAST cumulative total (not a sum) and splits cached input", () => {
    const u = parseCodexUsage(CODEX)!;
    expect(u.totalTokens).toBe(2250); // last, not 1100+2250
    expect(u.inputTokens).toBe(1200); // 2000 - 800 cached
    expect(u.cachedInputTokens).toBe(800);
    expect(u.outputTokens).toBe(250);
    expect(u.model).toBe("gpt-5.5");
    // (1200*1.25 + 250*10 + 800*0.125) / 1e6
    expect(u.costUsd).toBeCloseTo(0.0041, 4);
  });
  it("returns null when there is no usage block", () => {
    expect(parseCodexUsage('{"type":"session_meta","payload":{}}')).toBeNull();
  });
});

describe("estimateCost", () => {
  it("prices by model family and is 0 for empty usage", () => {
    const base = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 1_000_000 };
    expect(estimateCost({ ...base, model: "claude-sonnet-5" })).toBeCloseTo(3, 4); // $3/1M input
    expect(estimateCost({ ...base, model: "claude-opus-4-8" })).toBeCloseTo(15, 4);
    expect(estimateCost({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, totalTokens: 0, model: "x" })).toBe(0);
  });
});
