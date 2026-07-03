import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexImporter } from "../src/server/codex-import";

function rollout(session: string, lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

const META = { type: "session_meta", payload: { type: "session_meta", session_id: "s1", cwd: "/repo" } };
const CALL = { timestamp: "2026-07-04T00:00:03Z", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: JSON.stringify({ cmd: "ls", workdir: "/repo" }) } };
const OUT = { timestamp: "2026-07-04T00:00:04Z", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "Process exited with code 0\n" } };

describe("createCodexImporter", () => {
  let root: string;
  let stateFile: string;
  let ingested: Array<{ agent: string; id?: string }>;
  const collector = {
    ingest: (agent: string, _payload: unknown, opts?: { id?: string }) => {
      ingested.push({ agent, id: opts?.id });
    },
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aac-codex-"));
    stateFile = join(root, "state.json");
    ingested = [];
    mkdirSync(join(root, "2026", "07", "04"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("imports rollout events once and is idempotent on re-scan", () => {
    const file = join(root, "2026", "07", "04", "rollout-2026-07-04T00-00-00-s1.jsonl");
    writeFileSync(file, rollout("s1", [META, CALL, OUT]));
    const imp = createCodexImporter({ collector, root, stateFile, retentionDays: 0 });

    const n1 = imp.pollOnce();
    expect(n1).toBeGreaterThan(0);
    expect(ingested.every((e) => e.agent === "codex")).toBe(true);

    // Second scan of an unchanged file ingests nothing.
    const n2 = imp.pollOnce();
    expect(n2).toBe(0);
  });

  it("imports only the appended lines when a rollout grows", () => {
    const file = join(root, "2026", "07", "04", "rollout-2026-07-04T00-00-00-s1.jsonl");
    writeFileSync(file, rollout("s1", [META]));
    const imp = createCodexImporter({ collector, root, stateFile, retentionDays: 0 });
    imp.pollOnce();
    const afterFirst = ingested.length;

    // Codex appends a completed tool call.
    appendFileSync(file, JSON.stringify(CALL) + "\n" + JSON.stringify(OUT) + "\n");
    const n = imp.pollOnce();
    expect(n).toBe(2); // pre + post only, not the whole file again
    expect(ingested.length).toBe(afterFirst + 2);
  });

  it("ignores non-rollout files", () => {
    writeFileSync(join(root, "2026", "07", "04", "notes.jsonl"), rollout("x", [META, CALL, OUT]));
    const imp = createCodexImporter({ collector, root, stateFile, retentionDays: 0 });
    expect(imp.pollOnce()).toBe(0);
  });
});
