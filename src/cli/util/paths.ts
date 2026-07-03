/** Filesystem locations and the web-asset resolver for the CLI. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG_DIR, DEFAULT_DB_PATH } from "../../db/index";

export const CONFIG_DIR = DEFAULT_CONFIG_DIR;
export const DB_PATH = DEFAULT_DB_PATH;
export const SPOOL_DIR = join(CONFIG_DIR, "spool");
export const BACKUP_DIR = join(CONFIG_DIR, "backups");
export const HOOKS_DIR = join(CONFIG_DIR, "hooks");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const HOST = "127.0.0.1";
export const PORT = 48321;

/**
 * Locate the built dashboard (dist/web/index.html). Walks up from this module
 * so it works both under tsx (src/cli) and from the bundled dist-cli output.
 */
export function findWebDir(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "dist", "web");
    if (existsSync(join(candidate, "index.html"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
