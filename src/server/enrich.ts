/**
 * Git enrichment (Phase 5). Runs AFTER the synchronous ingest, off the request
 * path, so it never blocks the agent. Turns the bare event stream into a work
 * audit: real per-file line counts, committed files, and commit association.
 *
 * Safety: only ever runs read-only git (via GitRunner) and only inside a
 * validated, canonicalized git work tree; otherwise it is a no-op. The commit
 * message and committed file paths come from git as raw text, so they are
 * REDACTED before being stored or broadcast — the enrichment path must not
 * become a secret-leak bypass around normalize's redaction.
 */
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { FileChange, NormalizedAgentEvent } from "../core/types";
import { fingerprint, redactString } from "../core/redaction";
import type { AgentConsoleDb } from "../db/index";
import type { LiveMessage } from "./collector";
import { isWorkTree, lastCommit, numstatFile, type GitRunner } from "./git";
import { findCodexRollout, readClaudeUsage, readCodexUsage, type Usage } from "./usage";

export type Enricher = (event: NormalizedAgentEvent) => Promise<void>;

const WRITE_TOOL = /write|edit|create|append|multiedit/i;

function isEnrichable(event: NormalizedAgentEvent): boolean {
  if (event.type === "git_event") return true;
  return WRITE_TOOL.test(event.toolName ?? "") && Boolean(event.links?.files?.length);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Resolve the repo dir from the (untrusted) payload: canonicalize symlinks and
 *  require an absolute, real directory. Returns undefined if it cannot. */
function resolveDir(event: NormalizedAgentEvent): string | undefined {
  const raw = event.repoPath ?? event.cwd;
  if (!raw) return undefined;
  try {
    const real = realpathSync(raw);
    return isAbsolute(real) ? real : undefined;
  } catch {
    return undefined;
  }
}

export function createEnricher(
  db: AgentConsoleDb,
  runner: GitRunner,
  emit?: (msg: LiveMessage) => void
): Enricher {
  // Caches so we don't re-walk/re-parse transcripts on every event: the codex
  // rollout path is resolved once per session, and usage is re-parsed only when
  // the transcript's mtime changes.
  const usageCache = new Map<string, { mtime: number; usage: Usage | null }>();
  const codexPath = new Map<string, string | null>();

  async function enrichUsage(event: NormalizedAgentEvent) {
    let path: string | null;
    if (event.agent === "codex") {
      // Resolve (walk ~/.codex/sessions) at most ONCE per session — cache the
      // null result too, or an unmatched session re-walks on every event.
      if (codexPath.has(event.sessionId)) {
        path = codexPath.get(event.sessionId) ?? null;
      } else {
        path = findCodexRollout(event.sessionId, event.repoPath ?? event.cwd);
        codexPath.set(event.sessionId, path);
      }
    } else {
      path = event.transcriptPath ?? null;
    }
    if (!path) return;

    let mtime: number;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      return;
    }
    const cached = usageCache.get(path);
    let usage: Usage | null;
    if (cached && cached.mtime === mtime) usage = cached.usage;
    else {
      usage = event.agent === "codex" ? readCodexUsage(path) : readClaudeUsage(path);
      usageCache.set(path, { mtime, usage });
    }
    if (!usage) return;

    db.updateSessionUsage(event.sessionId, {
      totalTokens: usage.totalTokens,
      costUsd: usage.costUsd,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    });
    emit?.({ kind: "event", event, risk: [] });
  }

  return async function enrich(event) {
    // Token/cost enrichment runs for every event (not just git-enrichable ones).
    await enrichUsage(event).catch(() => {});

    if (!isEnrichable(event)) return;
    const dir = resolveDir(event);
    if (!dir) return;
    if (!(await isWorkTree(runner, dir))) return;

    if (event.type === "git_event") {
      const commit = await lastCommit(runner, dir);
      if (!commit) return;

      // Redact raw git text before it is persisted or broadcast.
      const safeFiles = commit.files.map((f) => ({ ...f, path: redactString(f.path).text }));
      const safeMsg = redactString(commit.message).text;
      const links = {
        commitSha: commit.sha,
        branch: commit.branch,
        files: safeFiles.map((f) => f.path),
      };
      const metrics = {
        filesChanged: commit.filesChanged,
        linesAdded: commit.linesAdded,
        linesDeleted: commit.linesDeleted,
      };
      const newTitle =
        event.title === "Git commit" && safeMsg ? truncate(`Commit: ${safeMsg}`, 90) : undefined;
      db.enrichEvent(event.id, JSON.stringify(links), JSON.stringify(metrics), newTitle);

      // Committed rows supersede the working-tree rows for the same files.
      db.deleteSupersededFileChanges(event.sessionId, safeFiles.map((f) => f.path), event.id);
      for (const f of safeFiles) {
        const fc: FileChange = {
          id: `fc_${fingerprint(event.id + f.path)}`,
          sessionId: event.sessionId,
          eventId: event.id,
          repoPath: dir,
          filePath: f.path,
          changeType: "modified",
          linesAdded: f.added,
          linesDeleted: f.deleted,
          agent: event.agent,
          timestamp: event.timestamp,
        };
        db.insertFileChange(fc);
      }
      db.recomputeSession(event.sessionId);
      emit?.({
        kind: "event",
        event: { ...event, title: newTitle ?? event.title, links, metrics },
        risk: [],
      });
      return;
    }

    // Write tool: fill in working-tree line counts for the touched file.
    const file = event.links?.files?.[0];
    if (!file) return;
    const { added, deleted } = await numstatFile(runner, dir, file);
    if (added > 0 || deleted > 0) {
      db.updateFileChangeStats(`fc_${fingerprint(event.id + file)}`, added, deleted);
      db.recomputeSession(event.sessionId);
      emit?.({ kind: "event", event, risk: [] });
    }
  };
}

/**
 * Wrap an enricher with a bounded-concurrency queue so fire-and-forget
 * enrichment can never spawn an unbounded number of git subprocesses.
 */
export function limitConcurrency(enrich: Enricher, max = 4): Enricher {
  let active = 0;
  const queue: NormalizedAgentEvent[] = [];

  const pump = () => {
    while (active < max && queue.length > 0) {
      const event = queue.shift()!;
      active++;
      void enrich(event)
        .catch(() => {})
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return (event) => {
    queue.push(event);
    pump();
    return Promise.resolve();
  };
}
