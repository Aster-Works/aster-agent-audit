import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  Clock,
  FileCode2,
  FlaskConical,
  GitBranch,
  MessageSquare,
  Play,
  ShieldAlert,
  TerminalSquare,
  User,
  Zap,
} from "lucide-react";
import type {
  AgentSession,
  NormalizedAgentEvent,
  RiskCategory,
} from "@core/types";
import { AGENT_LABELS } from "@core/types";
import { useAppStore } from "../app/store";
import { KeyValue, EmptyState, Pill } from "../components/ui";
import { AgentBadge } from "../components/AgentBadge";
import { RiskBadge, CategoryChip } from "../components/RiskBadge";
import { CommandBlock } from "../components/CommandBlock";
import { DiffViewer, type DiffLine } from "../components/DiffViewer";
import { cn } from "../lib/cn";
import {
  AGENT_COLOR_VAR,
  formatClock,
  formatDuration,
  durationBetween,
  formatTokens,
  formatUsd,
} from "../lib/format";

type TrackKey = "user" | "agent" | "shell" | "files" | "tests" | "git";

const PX_PER_MIN = 30;
const TRACK_H = 40;
const LABEL_GUTTER = 96;

export function SessionReplay() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const dataset = useAppStore((s) => s.dataset);
  const sessions = dataset.sessions;

  const session =
    sessions.find((s) => s.id === sessionId) ??
    sessions.find((s) => dataset.eventsBySession[s.id]) ??
    sessions[0];

  const events = dataset.eventsBySession[session.id] ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(
    events.find((e) => e.type === "file_change")?.id ?? events[1]?.id ?? events[0]?.id ?? null
  );
  const selected = events.find((e) => e.id === selectedId) ?? events[0] ?? null;

  const tracks: { key: TrackKey; label: string; icon: typeof User; color: string }[] = [
    { key: "user", label: "User", icon: User, color: "var(--color-ink-2)" },
    { key: "agent", label: AGENT_LABELS[session.agent], icon: Zap, color: AGENT_COLOR_VAR[session.agent] },
    { key: "shell", label: "Shell", icon: TerminalSquare, color: "var(--color-warn)" },
    { key: "files", label: "Files", icon: FileCode2, color: "var(--color-info)" },
    { key: "tests", label: "Tests", icon: FlaskConical, color: "var(--color-safe)" },
    { key: "git", label: "Git", icon: GitBranch, color: "var(--color-cursor)" },
  ];

  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.endedAt ?? events[events.length - 1]?.timestamp ?? session.startedAt).getTime();
  const totalMin = Math.max(1, (end - start) / 60000);

  function offsetPx(iso: string): number {
    return ((new Date(iso).getTime() - start) / 60000) * PX_PER_MIN + LABEL_GUTTER;
  }

  // Per-track declustering: place each event at its time-based x, but never
  // closer than MIN_GAP to the previous event on the same track so pills never
  // overlap. The playhead aligns to the rendered (declustered) position.
  const layoutX = useMemo(() => {
    const MIN_GAP = 120;
    const map = new Map<string, number>();
    const keys: TrackKey[] = ["user", "agent", "shell", "files", "tests", "git"];
    for (const key of keys) {
      const list = events
        .filter((e) => trackForEvent(e, session.agent) === key)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      let prev = -Infinity;
      for (const e of list) {
        let x = offsetPx(e.timestamp);
        if (x < prev + MIN_GAP) x = prev + MIN_GAP;
        map.set(e.id, x);
        prev = x;
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, start, session.agent]);

  const maxX = layoutX.size ? Math.max(...layoutX.values()) : LABEL_GUTTER;
  const width = Math.max(640, maxX + 230);
  const selectedX = selected ? layoutX.get(selected.id) ?? offsetPx(selected.timestamp) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Session header */}
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <SessionPicker sessions={sessions} current={session} onPick={(id) => { setSelectedId(null); navigate(`/session-replay/${id}`); }} />
          <div className="hidden items-center gap-2 text-[11px] text-ink-3 md:flex">
            <AgentBadge agent={session.agent} />
            <span className="font-mono">{session.model}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-3">
          <Pill>{durationBetween(session.startedAt, session.endedAt)}</Pill>
          <Pill>{session.filesChanged ?? 0} files</Pill>
          <Pill>{formatTokens(session.totalTokens ?? 0)} tok</Pill>
          <Pill>{formatUsd(session.estimatedCostUsd ?? 0)}</Pill>
          {session.riskCount ? (
            <Pill color="var(--color-warn)">
              <ShieldAlert size={11} /> {session.riskCount}
            </Pill>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Timeline */}
        <div className="flex min-w-0 flex-1 flex-col">
          {events.length === 0 ? (
            <EmptyState icon={Play} title="No detailed events for this session">
              Pick a session with a recorded timeline (e.g. “Implement session orchestration”).
            </EmptyState>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="relative" style={{ width }}>
                {/* Track labels (sticky left) */}
                <div className="pointer-events-none absolute left-0 top-7 z-20 flex flex-col">
                  {tracks.map((tr) => (
                    <div
                      key={tr.key}
                      style={{ height: TRACK_H }}
                      className="flex items-center"
                    >
                      <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface/90 px-2 py-1 text-[11px] font-medium text-ink-2 backdrop-blur">
                        <tr.icon size={12} style={{ color: tr.color }} />
                        {tr.label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Ruler */}
                <div className="relative mb-1 h-6 border-b border-line">
                  {Array.from({ length: Math.ceil(totalMin / 5) + 1 }, (_, i) => i * 5).map((m) => (
                    <div
                      key={m}
                      className="absolute top-0 flex h-6 flex-col items-center"
                      style={{ left: m * PX_PER_MIN + LABEL_GUTTER }}
                    >
                      <span className="aac-tnum text-[10px] text-ink-3">+{m}m</span>
                      <span className="mt-0.5 h-2 w-px bg-line" />
                    </div>
                  ))}
                </div>

                {/* Playhead */}
                {selected && (
                  <div
                    className="pointer-events-none absolute z-10"
                    style={{ left: selectedX, top: 24, bottom: 0 }}
                  >
                    <div className="h-full w-px" style={{ background: "var(--color-sel)" }} />
                    <div
                      className="absolute -left-1 -top-1 h-2 w-2 rotate-45"
                      style={{ background: "var(--color-sel)" }}
                    />
                  </div>
                )}

                {/* Track rows */}
                <div className="relative">
                  {tracks.map((tr, ri) => (
                    <div
                      key={tr.key}
                      className={cn(
                        "relative border-b border-line-soft",
                        ri % 2 === 1 && "bg-surface/30"
                      )}
                      style={{ height: TRACK_H }}
                    >
                      {events
                        .filter((e) => trackForEvent(e, session.agent) === tr.key)
                        .map((e) => (
                          <EventPill
                            key={e.id}
                            event={e}
                            left={layoutX.get(e.id) ?? offsetPx(e.timestamp)}
                            color={tr.color}
                            selected={e.id === selectedId}
                            onClick={() => setSelectedId(e.id)}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Playback controls */}
          <PlaybackBar
            events={events}
            selectedId={selectedId}
            onSelect={setSelectedId}
            clock={selected ? formatClock(selected.timestamp) : "--:--:--"}
          />
        </div>

        {/* Inspector */}
        <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-line bg-surface lg:block 2xl:w-[420px]">
          {selected ? (
            <EventInspector event={selected} session={session} />
          ) : (
            <EmptyState icon={MessageSquare} title="Select an event">
              Click any event on the timeline to inspect its input, output, diff, and risk.
            </EmptyState>
          )}
        </aside>
      </div>
    </div>
  );
}

function trackForEvent(e: NormalizedAgentEvent, _agent: string): TrackKey {
  switch (e.type) {
    case "session_start":
    case "session_stop":
    case "user_prompt":
      return "user";
    case "file_change":
      return "files";
    case "test_result":
      return "tests";
    case "git_event":
      return "git";
    case "risk_finding": {
      const cat = e.risk?.[0]?.category as RiskCategory | undefined;
      if (cat === "git") return "git";
      if (cat === "files") return "files";
      if (cat === "shell" || cat === "secrets") return "shell";
      return "agent";
    }
    default: {
      const tool = (e.toolName ?? "").toLowerCase();
      if (/bash|exec|shell|command/.test(tool)) return "shell";
      return "agent";
    }
  }
}

function EventPill({
  event,
  left,
  color,
  selected,
  onClick,
}: {
  event: NormalizedAgentEvent;
  left: number;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  const isRisk = event.type === "risk_finding";
  const sev = event.risk?.[0]?.severity;
  const ring = isRisk ? "var(--color-danger)" : selected ? "var(--color-sel)" : "transparent";
  return (
    <button
      type="button"
      onClick={onClick}
      title={event.title}
      className="absolute top-1/2 flex max-w-[200px] -translate-y-1/2 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors hover:z-10"
      style={{
        left,
        color: "var(--color-ink)",
        borderColor: ring === "transparent" ? `color-mix(in srgb, ${color} 38%, transparent)` : ring,
        background: `color-mix(in srgb, ${isRisk ? "var(--color-danger)" : color} ${selected ? 26 : 14}%, var(--color-surface))`,
        boxShadow: selected ? `0 0 0 1px ${ring}` : "none",
      }}
    >
      {isRisk && <ShieldAlert size={11} className="shrink-0" style={{ color: "var(--color-danger)" }} />}
      {sev && <span className="sr-only">{sev}</span>}
      <span className="aac-truncate">{event.title}</span>
    </button>
  );
}

function SessionPicker({
  sessions,
  current,
  onPick,
}: {
  sessions: AgentSession[];
  current: AgentSession;
  onPick: (id: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={current.id}
        onChange={(e) => onPick(e.target.value)}
        className="h-8 max-w-[280px] cursor-pointer appearance-none truncate rounded-md border border-line bg-bg pl-2.5 pr-7 text-[13px] font-semibold text-ink focus:outline-none focus:ring-1 focus:ring-claude/40"
      >
        {sessions.map((s) => (
          <option key={s.id} value={s.id} className="bg-surface font-normal">
            {s.summary ?? s.id} · {AGENT_LABELS[s.agent]}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
}

function PlaybackBar({
  events,
  selectedId,
  onSelect,
  clock,
}: {
  events: NormalizedAgentEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  clock: string;
}) {
  const idx = Math.max(0, events.findIndex((e) => e.id === selectedId));
  const step = (d: number) => {
    const n = Math.min(events.length - 1, Math.max(0, idx + d));
    if (events[n]) onSelect(events[n].id);
  };
  return (
    <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-2">
      <div className="flex items-center gap-1">
        <CtrlButton onClick={() => step(-1)} label="Prev">‹</CtrlButton>
        <CtrlButton onClick={() => step(1)} label="Next" accent>
          <Play size={13} />
        </CtrlButton>
      </div>
      <span className="aac-tnum w-20 font-mono text-[13px] text-ink">{clock}</span>
      {/* Scrub track */}
      <div className="relative h-2 flex-1 rounded-full bg-surface-2">
        <div
          className="absolute left-0 top-0 h-2 rounded-full"
          style={{
            width: events.length > 1 ? `${(idx / (events.length - 1)) * 100}%` : "0%",
            background: "var(--color-sel)",
          }}
        />
        {events.map((e, i) => (
          <button
            key={e.id}
            type="button"
            title={`${formatClock(e.timestamp)} · ${e.title}`}
            onClick={() => onSelect(e.id)}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
            style={{
              left: events.length > 1 ? `${(i / (events.length - 1)) * 100}%` : "0%",
              background:
                e.type === "risk_finding"
                  ? "var(--color-danger)"
                  : e.id === selectedId
                  ? "var(--color-sel)"
                  : "var(--color-ink-3)",
            }}
          />
        ))}
      </div>
      <span className="text-[11px] text-ink-3">
        {idx + 1}/{events.length}
      </span>
    </div>
  );
}

function CtrlButton({
  children,
  onClick,
  label,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border text-[14px] transition-colors",
        accent
          ? "border-sel/50 bg-sel/15 text-ink hover:bg-sel/25"
          : "border-line bg-bg text-ink-2 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

// ---- Inspector ------------------------------------------------------------

const DEMO_DIFFS: Record<string, { added: number; deleted: number; lines: DiffLine[] }> = {
  "src/server/events.ts": {
    added: 132,
    deleted: 0,
    lines: [
      { type: "hunk", text: "@@ -0,0 +1,18 @@ session orchestration" },
      { type: "add", text: "export function ingest(raw: unknown): NormalizedAgentEvent {", newNo: 1 },
      { type: "add", text: "  const evt = normalize(raw);", newNo: 2 },
      { type: "add", text: "  const session = upsertSession(evt.sessionId, evt);", newNo: 3 },
      { type: "add", text: "  redact(evt); // strip secrets before persistence", newNo: 4 },
      { type: "add", text: "  db.insertEvent(evt);", newNo: 5 },
      { type: "add", text: "  return evt;", newNo: 6 },
      { type: "add", text: "}", newNo: 7 },
    ],
  },
  "src/app/dashboard.tsx": {
    added: 88,
    deleted: 24,
    lines: [
      { type: "hunk", text: "@@ -42,7 +42,9 @@ function Overview()" },
      { type: "ctx", text: "  const sessions = useSessions();", oldNo: 42, newNo: 42 },
      { type: "del", text: "  return <List items={sessions} />;", oldNo: 43 },
      { type: "add", text: "  const grouped = groupBySession(sessions);", newNo: 43 },
      { type: "add", text: "  return <SessionGroups groups={grouped} />;", newNo: 44 },
    ],
  },
};

function EventInspector({
  event,
  session,
}: {
  event: NormalizedAgentEvent;
  session: AgentSession;
}) {
  // Sample diffs are illustrative demo content only — never show them over live
  // data (we don't reconstruct real file diffs from hook events).
  const isDemo = useAppStore((s) => s.source) === "demo";
  const diff = isDemo && event.links?.files?.[0] ? DEMO_DIFFS[event.links.files[0]] : undefined;
  const command = event.risk?.[0]?.redactedEvidence;
  return (
    <div className="flex flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Pill color={AGENT_COLOR_VAR[event.agent]}>{event.type.replace(/_/g, " ")}</Pill>
          {event.toolName && <Pill>{event.toolName}</Pill>}
        </div>
        <h3 className="mt-2 text-[14px] font-semibold leading-snug text-ink">{event.title}</h3>
        {event.summary && <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{event.summary}</p>}
      </div>

      <div className="border-b border-line px-4 py-2">
        <KeyValue label="Timestamp" mono>{formatClock(event.timestamp)}</KeyValue>
        {event.metrics?.durationMs != null && (
          <KeyValue label="Duration" mono>{formatDuration(event.metrics.durationMs)}</KeyValue>
        )}
        {event.metrics?.exitCode != null && (
          <KeyValue label="Exit code" mono>{event.metrics.exitCode}</KeyValue>
        )}
        {event.links?.commitSha && (
          <KeyValue label="Commit" mono>{event.links.commitSha}</KeyValue>
        )}
        {event.links?.branch && (
          <KeyValue label="Branch" mono>{event.links.branch}</KeyValue>
        )}
      </div>

      {command && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-1.5 text-[11px] font-medium text-ink-3">Command (redacted, not executed)</div>
          <CommandBlock command={command} danger={(event.risk?.[0]?.severity ?? "low") !== "low"} />
        </div>
      )}

      {diff && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
            <Clock size={11} /> Proposed change
          </div>
          <DiffViewer file={event.links!.files![0]} lines={diff.lines} added={diff.added} deleted={diff.deleted} />
        </div>
      )}

      {event.risk?.map((r) => (
        <div key={r.id} className="border-b border-line px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <RiskBadge severity={r.severity} />
            <CategoryChip category={r.category} />
          </div>
          <p className="text-[12px] leading-relaxed text-ink-2">{r.description}</p>
          {r.redactedEvidence && (
            <div className="mt-2">
              <CommandBlock label="Evidence" command={r.redactedEvidence} danger />
            </div>
          )}
          <div className="mt-2 rounded-md border border-safe/30 bg-safe/5 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-safe">
              Recommended action
            </div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{r.recommendedAction}</p>
          </div>
        </div>
      ))}

      <div className="px-4 py-3">
        <KeyValue label="Session">{session.summary}</KeyValue>
        <KeyValue label="Repo" mono>{session.repoPath}</KeyValue>
      </div>
    </div>
  );
}
