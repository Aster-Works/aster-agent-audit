/**
 * Import spooled events written by hooks while the collector was offline.
 * Each line is a redacted `{ agent, payload }` record. After import the spool
 * file is archived so it is not replayed twice.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { createCollector } from "./collector";

type Collector = ReturnType<typeof createCollector>;

export function importSpool(collector: Collector, spoolDir: string): number {
  const file = join(spoolDir, "spool.jsonl");
  if (!existsSync(file)) return 0;

  let imported = 0;
  try {
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as { agent?: string; payload?: unknown };
        collector.ingest((rec.agent as never) ?? "unknown", rec.payload ?? {});
        imported++;
      } catch {
        /* skip malformed line */
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    renameSync(file, join(spoolDir, `imported-${stamp}.jsonl`));
  } catch {
    /* spool unreadable — ignore */
  }
  return imported;
}
