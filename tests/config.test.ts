import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../src/server/config";

describe("console config", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "aac-cfg-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults retention to 30 on a missing file", () => {
    expect(loadConfig(dir).retentionDays).toBe(30);
  });

  it("clamps a bad retention and preserves unknown fields", () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ retentionDays: -5, cloudSync: false, host: "127.0.0.1" }));
    const c = loadConfig(dir);
    expect(c.retentionDays).toBe(30); // negative → default
    saveConfig({ retentionDays: 9999 }, dir);
    expect(loadConfig(dir).retentionDays).toBe(3650); // upper clamp
    expect((loadConfig(dir) as { cloudSync?: boolean }).cloudSync).toBe(false); // preserved
  });

  it("keeps only well-formed pricing tuples for known families", () => {
    const next = saveConfig(
      {
        pricing: {
          "gpt-5": [1, 2, 3, 4],
          "claude-opus": [10, 20, 1, 5],
          bogus: [1, 2, 3, 4] as never, // unknown family → dropped
          "claude-haiku": [1, 2, 3] as never, // wrong arity → dropped
        },
      },
      dir
    );
    expect(next.pricing).toEqual({ "gpt-5": [1, 2, 3, 4], "claude-opus": [10, 20, 1, 5] });
    // merge: a later save updates one family without clobbering the other
    const merged = saveConfig({ pricing: { "gpt-5": [5, 5, 5, 5] } }, dir);
    expect(merged.pricing).toMatchObject({ "gpt-5": [5, 5, 5, 5], "claude-opus": [10, 20, 1, 5] });
  });

  it("rejects negative or non-finite rates", () => {
    const next = saveConfig({ pricing: { "gpt-5": [-1, 2, 3, 4] as never } }, dir);
    expect(next.pricing).toBeUndefined();
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).pricing).toBeUndefined();
  });
});
