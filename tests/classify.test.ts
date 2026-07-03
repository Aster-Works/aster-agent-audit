import { describe, it, expect } from "vitest";
import {
  classifyCommand,
  isTestCommand,
  isCommitCommand,
  parseTestResult,
} from "@core/classify";

describe("command classification", () => {
  it("detects common test runners", () => {
    for (const c of [
      "pnpm test",
      "npm run test",
      "yarn test",
      "npx vitest run",
      "vitest",
      "jest --ci",
      "pytest -q",
      "go test ./...",
      "cargo test",
      "bundle exec rspec",
      "dotnet test",
    ]) {
      expect(isTestCommand(c), c).toBe(true);
      expect(classifyCommand(c)).toBe("test_result");
    }
  });

  it("does not misclassify non-test commands as tests", () => {
    for (const c of ['echo "run the test suite"', "git commit -m 'add test helper'", "node build.js", "ls test/"]) {
      expect(isTestCommand(c), c).toBe(false);
    }
  });

  it("detects real git commits but not dry runs or config", () => {
    expect(isCommitCommand('git commit -m "feat: x"')).toBe(true);
    expect(isCommitCommand("git add -A && git commit -m wip")).toBe(true);
    expect(isCommitCommand('git -C /repo commit -m "x"')).toBe(true);
    expect(isCommitCommand('git -c user.name=Bot commit -m "x"')).toBe(true);
    expect(classifyCommand('git commit -m "x"')).toBe("git_event");
    expect(isCommitCommand("git commit --dry-run")).toBe(false);
    expect(isCommitCommand("git config commit.gpgsign true")).toBe(false);
    expect(isCommitCommand("git status")).toBe(false);
  });

  it("does not treat push/log/checkout that merely mention 'commit' as a commit", () => {
    // Regression: the subcommand must be `commit`, not just the word appearing.
    expect(isCommitCommand("git push origin feature/commit-fixes")).toBe(false);
    expect(isCommitCommand("git log --oneline | grep commit")).toBe(false);
    expect(isCommitCommand("git checkout commit-history-branch")).toBe(false);
    expect(isCommitCommand("git diff > commit.txt")).toBe(false);
    expect(classifyCommand("git push origin feature/commit-fixes")).toBeUndefined();
  });

  it("a commit that is also worded with test is still a commit, not a test", () => {
    // commit message contains 'test' but command is a commit
    expect(classifyCommand("git commit -m 'add vitest config'")).toBe("git_event");
  });

  it("parses pass/fail from exit code and output", () => {
    expect(parseTestResult(0).ok).toBe(true);
    expect(parseTestResult(1).ok).toBe(false);
    const r = parseTestResult(0, "Tests  41 passed (41)");
    expect(r.passed).toBe(41);
    const f = parseTestResult(1, "Tests: 3 failed, 38 passed");
    expect(f.failed).toBe(3);
    expect(f.passed).toBe(38);
    expect(f.ok).toBe(false);
  });
});
