import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldAlert,
  ShieldCheck,
  Plug,
  ListChecks,
  Grid3x3,
  ArrowRight,
  Check,
  KeyRound,
  ExternalLink,
  RotateCcw,
  EyeOff,
} from "lucide-react";
import {
  RISK_CATEGORIES,
  SEVERITY_ORDER,
  AGENT_LABELS,
} from "@core/types";
import type { RiskSeverity, RiskCategory, AgentName } from "@core/types";
import type { McpServer, RiskRow } from "@core/views";
import { useDataset } from "../data/useDataset";
import { useAppStore } from "../app/store";
import { fetchMcpInventory, type McpInventoryResponse, type McpInventoryRow, type McpInventoryDiff } from "../data/source";
import { Panel, EmptyState, KeyValue } from "../components/ui";
import { RiskBadge, CategoryChip, SeverityDot, CATEGORY_ICON, CATEGORY_LABEL } from "../components/RiskBadge";
import { AgentBadge, AgentDot } from "../components/AgentBadge";
import { CommandBlock } from "../components/CommandBlock";
import { RiskRadarChart, radarScores } from "../components/charts";
import { cn } from "../lib/cn";
import {
  AGENT_COLOR_VAR,
  formatClock,
  SEVERITY_COLOR_VAR,
  SEVERITY_LABEL,
} from "../lib/format";
import { computeSafety, toSafetyRadar, type Safety } from "../lib/safety";
import { useT } from "../lib/i18n";

/** Finding lifecycle (v3, mirrors `FindingStatus` in `src/db/index.ts`). */
type FindingStatus = "open" | "acknowledged" | "resolved" | "accepted-risk" | "false-positive";
const CLOSED_STATUSES: ReadonlySet<FindingStatus> = new Set(["resolved", "accepted-risk", "false-positive"]);
const CLOSED_STATUS_META: Record<string, { label: string; colorVar: string }> = {
  resolved: { label: "Resolved", colorVar: "var(--color-safe)" },
  "accepted-risk": { label: "Accepted risk", colorVar: "var(--color-warn)" },
  "false-positive": { label: "False positive", colorVar: "var(--color-ink-3)" },
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  "accepted-risk": "Accepted risk",
  "false-positive": "False positive",
};

export function RiskRadar() {
  const t = useT();
  const navigate = useNavigate();
  const dataset = useDataset();
  const { risk, mcpServers, policyEvents, overview, mcpScan } = dataset;
  const isLive = useAppStore((s) => s.source) === "live";
  const loadLive = useAppStore((s) => s.loadLive);
  const [busy, setBusy] = useState(false);

  // MCP inventory: fetched directly (not part of the filtered Dataset) — a
  // fetch failure (offline collector, demo mode) just means no inventory to
  // show, so it degrades to an empty state rather than fake demo rows.
  const [mcpInventory, setMcpInventory] = useState<McpInventoryResponse | null>(null);
  useEffect(() => {
    let ok = true;
    fetchMcpInventory().then((r) => ok && setMcpInventory(r));
    return () => {
      ok = false;
    };
  }, [isLive]);

  const [selectedId, setSelectedId] = useState<string>(
    risk.find((r) => r.severity === "critical")?.id ?? risk[0]?.id ?? ""
  );
  const selected = risk.find((r) => r.id === selectedId) ?? risk[0];

  // A finding can be acted on only when it's backed by the local DB — MCP
  // config-scan findings reflect current config state, not a stored record.
  const canResolve = (r: RiskRow) => isLive && r.sessionId !== "mcp-config-scan";

  async function mutate(path: string, body: object) {
    setBusy(true);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadLive();
    } finally {
      setBusy(false);
    }
  }
  const setStatus = (r: RiskRow, status: FindingStatus, note?: string) =>
    mutate("/api/risk-findings/resolve", { id: r.id, status, note });

  // Active findings (not closed by any of the three terminal states) drive
  // the score, counters and radar; closed ones stay in the list but marked,
  // so you can see what you've handled — and how.
  const active = useMemo(() => risk.filter((r) => !CLOSED_STATUSES.has(r.status)), [risk]);
  const resolvedCount = risk.length - active.length;

  const counts = useMemo(() => {
    const m = new Map<RiskSeverity, number>();
    for (const sev of SEVERITY_ORDER) m.set(sev, 0);
    for (const r of active) m.set(r.severity, (m.get(r.severity) ?? 0) + 1);
    return m;
  }, [active]);

  const cleanEvents = Math.max(0, overview.totals.toolCalls - active.length);
  const radar = radarScores(active, RISK_CATEGORIES);
  // Safety surface: invert risk so a fully safe setup reads as a big, full
  // green hexagon. Categories with findings dip inward.
  const safety = computeSafety(active);
  const safetyRadar = toSafetyRadar(radar);

  // Active first (by severity), closed (resolved/accepted-risk/false-positive) last.
  const sorted = [...risk].sort((a, b) => {
    const ar = CLOSED_STATUSES.has(a.status) ? 1 : 0;
    const br = CLOSED_STATUSES.has(b.status) ? 1 : 0;
    if (ar !== br) return ar - br;
    return SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity);
  });

  return (
    <div className="space-y-4 p-4">
      {/* Severity counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[...SEVERITY_ORDER].reverse().map((sev) => (
          <SeverityCounter key={sev} severity={sev} count={counts.get(sev) ?? 0} />
        ))}
        <div className="aac-card-2 flex flex-col gap-1 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-ink-3">{t("Clean events")}</span>
            <ShieldCheck size={14} className="text-safe" />
          </div>
          <span className="aac-tnum text-[22px] font-semibold leading-none text-safe">
            {cleanEvents}
          </span>
          <span className="text-[10px] text-ink-3">{t("no risk detected")}</span>
        </div>
      </div>

      {/* Main: findings list · radar+matrix · details */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Findings list */}
        <Panel
          title={t("Recent Flagged Events")}
          icon={ListChecks}
          subtitle={
            resolvedCount > 0
              ? t("{active} active · {resolved} resolved", { active: active.length, resolved: resolvedCount })
              : t("{active} findings · {critical} critical", { active: active.length, critical: counts.get("critical") ?? 0 })
          }
          noBodyPadding
          className="self-start"
        >
          <div className="max-h-[544px] overflow-y-auto">
            {sorted.map((r) => (
              <FindingRow
                key={r.id}
                row={r}
                selected={r.id === selectedId}
                onClick={() => setSelectedId(r.id)}
              />
            ))}
          </div>
        </Panel>

        {/* Safety surface + matrix */}
        <div className="flex flex-col gap-4">
          <Panel
            title={t("Safety Surface")}
            icon={safety.safe ? ShieldCheck : ShieldAlert}
            iconColor={safety.color}
            subtitle={t("Fuller and greener means safer")}
          >
            <SafetyHeadline safety={safety} findings={active.length} />
            <RiskRadarChart
              data={safetyRadar}
              height={196}
              color={safety.color}
              fillOpacity={safety.safe ? 0.34 : 0.2}
            />
          </Panel>
          <Panel title={t("Risk Matrix")} icon={Grid3x3} subtitle={t("Category × severity")}>
            <RiskMatrix risk={active} />
          </Panel>
        </div>

        {/* Finding details */}
        <Panel
          title={t("Finding Details")}
          icon={ShieldAlert}
          iconColor={selected ? SEVERITY_COLOR_VAR[selected.severity] : undefined}
          action={
            selected && (
              <button
                type="button"
                onClick={() => navigate(`/session-replay/${selected.sessionId}`)}
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-3 hover:text-ink-2"
              >
                {t("Open session")} <ArrowRight size={12} />
              </button>
            )
          }
        >
          {selected ? (
            <FindingDetails
              row={selected}
              canResolve={canResolve(selected)}
              busy={busy}
              onSetStatus={(status, note) => setStatus(selected, status, note)}
            />
          ) : (
            <EmptyState icon={ShieldCheck} title={t("No findings")} />
          )}
        </Panel>
      </div>

      {/* MCP map + policy timeline */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title={t("MCP Permission Map")}
          icon={Plug}
          subtitle={
            mcpScan
              ? t("{count} servers · posture {grade} ({score}/100)", { count: mcpScan.serverCount, grade: mcpScan.grade, score: mcpScan.score })
              : t("Tool servers and the capabilities they hold")
          }
          className="xl:col-span-2"
        >
          {mcpServers.length ? (
            <McpMap servers={mcpServers} />
          ) : (
            <EmptyState icon={ShieldCheck} title={t("No MCP servers configured")} />
          )}
        </Panel>

        <Panel title={t("Policy Timeline")} icon={ListChecks} subtitle={t("Recent policy decisions")} noBodyPadding>
          <div className="max-h-[300px] overflow-y-auto px-4 py-3">
            <ol className="relative ml-1 border-l border-line">
              {policyEvents.map((p) => (
                <li key={p.id} className="relative mb-3 pl-4 last:mb-0">
                  <span
                    className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface"
                    style={{ background: SEVERITY_COLOR_VAR[p.severity] }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="aac-truncate text-[12px] text-ink">{p.title}</span>
                    <PolicyOutcome outcome={p.outcome} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-3">
                    <CategoryChip category={p.category} />
                    <span className="aac-tnum">{formatClock(p.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
      </div>

      {/* MCP inventory: every server ever seen across config scans, with
          change detection against the previous scan. */}
      <Panel
        title={t("MCP Inventory")}
        icon={Plug}
        subtitle={
          mcpInventory
            ? t("{n} known servers · {added} new · {changed} changed · {removed} removed", {
                n: mcpInventory.inventory.length,
                added: mcpInventory.diff.added.length,
                changed: mcpInventory.diff.changed.length,
                removed: mcpInventory.diff.removed.length,
              })
            : t("Servers and their config fingerprints, tracked across scans")
        }
        noBodyPadding
      >
        {mcpInventory === null ? (
          <EmptyState icon={Plug} title={t("Available once connected to the live collector")} />
        ) : mcpInventory.inventory.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={t("No MCP servers configured")} />
        ) : (
          <McpInventoryTable inventory={mcpInventory.inventory} diff={mcpInventory.diff} />
        )}
      </Panel>
    </div>
  );
}

function SeverityCounter({ severity, count }: { severity: RiskSeverity; count: number }) {
  const t = useT();
  const color = SEVERITY_COLOR_VAR[severity];
  return (
    <div className="aac-card-2 flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-ink-3">{t(SEVERITY_LABEL[severity])}</span>
        <SeverityDot severity={severity} />
      </div>
      <span className="aac-tnum text-[22px] font-semibold leading-none" style={{ color: count ? color : "var(--color-ink-3)" }}>
        {count}
      </span>
      <span className="text-[10px] text-ink-3">{t("findings")}</span>
    </div>
  );
}

function FindingRow({
  row,
  selected,
  onClick,
}: {
  row: RiskRow;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = CATEGORY_ICON[row.category];
  const closed = CLOSED_STATUSES.has(row.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-start gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2",
        selected && "bg-surface-2",
        closed && "opacity-55"
      )}
      style={selected ? { boxShadow: `inset 2px 0 0 ${SEVERITY_COLOR_VAR[row.severity]}` } : undefined}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: `color-mix(in srgb, ${SEVERITY_COLOR_VAR[row.severity]} 16%, transparent)` }}
      >
        <Icon size={13} style={{ color: SEVERITY_COLOR_VAR[row.severity] }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("aac-truncate text-[12.5px] font-medium text-ink", closed && "line-through")}>
            {row.title}
          </span>
          {closed ? <ClosedStatusBadge status={row.status} /> : <RiskBadge severity={row.severity} />}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
          <AgentDot agent={row.agent} />
          <span>{AGENT_LABELS[row.agent]}</span>
          <span className="font-mono">{row.ruleId}</span>
          <span className="aac-tnum ml-auto">{formatClock(row.timestamp)}</span>
        </div>
      </div>
    </button>
  );
}

/** Closed-state badge — same shape as the old "Resolved" pill, colored per status. */
function ClosedStatusBadge({ status }: { status: string }) {
  const t = useT();
  const meta = CLOSED_STATUS_META[status] ?? CLOSED_STATUS_META.resolved;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: meta.colorVar, background: `color-mix(in srgb, ${meta.colorVar} 14%, transparent)` }}
    >
      <Check size={10} /> {t(meta.label)}
    </span>
  );
}

type Rotation = { provider: string; url?: string; hint?: string };

// Known MCP servers → where to rotate their key (matched from the server name
// the finding records, e.g. `server "magic"`).
const MCP_PROVIDERS: Record<string, { provider: string; url: string }> = {
  magic: { provider: "21st.dev (Magic)", url: "https://21st.dev/magic/console" },
  higgsfield: { provider: "Higgsfield", url: "https://higgsfield.ai/account" },
  stripe: { provider: "Stripe", url: "https://dashboard.stripe.com/apikeys" },
};

// Recognizable credential prefixes / providers. mask() preserves prefixes like
// sk-ant-/ghp_/AKIA, so the redacted evidence still identifies the provider.
const TOKEN_TARGETS: { test: RegExp; provider: string; url: string }[] = [
  { test: /sk-ant-|anthropic/i, provider: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
  { test: /gh[pousr]_|github_pat_|github/i, provider: "GitHub", url: "https://github.com/settings/tokens" },
  { test: /sb[ps]_|sbsecret_|supabase/i, provider: "Supabase", url: "https://supabase.com/dashboard/project/_/settings/api" },
  { test: /AKIA[0-9A-Z]{16}|\baws\b/i, provider: "AWS", url: "https://console.aws.amazon.com/iam/home#/security_credentials" },
  { test: /\bAIza[0-9A-Za-z_-]/, provider: "Google Cloud", url: "https://console.cloud.google.com/apis/credentials" },
  { test: /\b[srp]k_(?:live|test)_/, provider: "Stripe", url: "https://dashboard.stripe.com/apikeys" },
  { test: /\bxox[baprs]-/, provider: "Slack", url: "https://api.slack.com/apps" },
  { test: /\bsk-/, provider: "OpenAI", url: "https://platform.openai.com/api-keys" },
];

/** Where to rotate the exposed credential behind a secret finding. */
function rotationTarget(row: RiskRow): Rotation {
  const ev = row.redactedEvidence ?? "";
  const hay = `${ev} ${row.description}`;

  // 1. Known credential prefix / provider.
  for (const t of TOKEN_TARGETS) if (t.test.test(hay)) return { provider: t.provider, url: t.url };

  // 2. Database connection string → identify the host (only the password is masked).
  if (/:\/\/|\bpostgres|\bmysql|\bmongodb|\bredis|url_credential/i.test(hay)) {
    const host = (ev.match(/@([A-Za-z0-9_.-]+)/) || [])[1] ?? "";
    if (/supabase/i.test(host)) return { provider: "Supabase", url: "https://supabase.com/dashboard/project/_/settings/database" };
    if (/neon\.tech/i.test(host)) return { provider: "Neon", url: "https://console.neon.tech" };
    if (/rds\.amazonaws/i.test(host)) return { provider: "AWS RDS", url: "https://console.aws.amazon.com/rds" };
    if (!host || /^(127\.|0\.0\.0\.0|localhost|::1|192\.168\.|10\.)/i.test(host))
      return {
        provider: "your local database",
        hint: "Local database — change the role's password (e.g. `ALTER USER … WITH PASSWORD …`) and update the connection string. There's no web page to rotate a local credential.",
      };
    return { provider: host, hint: `Rotate the database password on ${host}, then update the connection string.` };
  }

  // 3. MCP server env secret → map the named server to its provider.
  const server = (row.description.match(/server ["']([^"']+)["']/) || [])[1];
  if (server) {
    const known = MCP_PROVIDERS[server.toLowerCase()];
    if (known) return known;
    return {
      provider: `the "${server}" provider`,
      hint: `Rotate this key in the ${server} provider's dashboard, then reference it as \${VAR} in your MCP config instead of inlining it.`,
    };
  }

  // 4. Generic fallback.
  return { provider: "the issuing provider", hint: "Rotate this credential where it was issued, then update it wherever it's configured." };
}

function FindingDetails({
  row,
  canResolve,
  busy,
  onSetStatus,
}: {
  row: RiskRow;
  canResolve: boolean;
  busy: boolean;
  onSetStatus: (status: FindingStatus, note?: string) => void;
}) {
  const t = useT();
  const isMcp = row.sessionId === "mcp-config-scan";
  const isClosed = CLOSED_STATUSES.has(row.status);
  const isSecret = row.category === "secrets";
  const rotate = isSecret ? rotationTarget(row) : null;

  // Closing a finding (resolve / accept risk / false positive) is the moment
  // that matters for the audit trail, so it's the only action that prompts
  // for a note. `window.prompt` is deliberately minimal — this is an audit
  // tool, not a form builder; a cancelled prompt aborts the status change.
  function close(status: FindingStatus) {
    const input = window.prompt(t("Add a note (optional)"));
    if (input === null) return;
    onSetStatus(status, input.trim() || undefined);
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <RiskBadge severity={row.severity} />
        <CategoryChip category={row.category} />
        <span className="ml-auto font-mono text-[11px] text-ink-3">{row.ruleId}</span>
      </div>
      <h3 className="text-[14px] font-semibold leading-snug text-ink">{row.title}</h3>

      <div className="aac-inset rounded-md px-3 py-1">
        <KeyValue label={t("Agent")}>{AGENT_LABELS[row.agent]}</KeyValue>
        <KeyValue label={t("Time")} mono>{formatClock(row.timestamp)}</KeyValue>
        <KeyValue label={t("Status")}>
          <span>{t(STATUS_LABEL[row.status] ?? row.status)}</span>
        </KeyValue>
      </div>

      <div>
        <SectionTitle>{t("What happened")}</SectionTitle>
        <p className="text-[12px] leading-relaxed text-ink-2">{row.description}</p>
      </div>

      {row.redactedEvidence && (
        <div>
          <SectionTitle>{t("Evidence (redacted, not executed)")}</SectionTitle>
          <CommandBlock command={row.redactedEvidence} danger={row.severity !== "low" && row.severity !== "info"} />
        </div>
      )}

      <div className="rounded-md border border-safe/30 bg-safe/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-safe">
          <ShieldCheck size={12} /> {t("Recommended action")}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{row.recommendedAction}</p>
      </div>

      {/* Secret remediation: be honest that the real key lives elsewhere, and
          point to where to rotate it. Deleting this (redacted) record wouldn't
          remove the secret. */}
      {isSecret && rotate && (
        <div className="rounded-md border border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
            <KeyRound size={12} /> {t("Rotate the key — this is the real fix")}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
            {t("This console never stored the raw key (the record above is redacted). The real value still sits in plaintext in the agent’s own log")}
            {row.agent === "codex" ? " (~/.codex/sessions/…)" : row.agent === "claude-code" ? " (~/.claude/projects/…)" : ""}
            {isMcp ? t(" and in the MCP config it came from") : t(" and wherever it came from (e.g. a .env)")}
            {t(" — so it’s already exposed. Deleting a record wouldn’t undo that;")} <span className="text-ink">{t("rotate the key")}</span> {t("to neutralize it.")}
          </p>
          {rotate.url && (
            <a
              href={rotate.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/20"
            >
              <KeyRound size={13} /> {t("Rotate at {provider}", { provider: rotate.provider })} <ExternalLink size={12} />
            </a>
          )}
          {rotate.hint && <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{rotate.hint}</p>}
        </div>
      )}

      {/* Resolve / accept risk / false positive / reopen — never delete.
          Marks a reviewed finding as handled, with a reason. */}
      {canResolve ? (
        <div className="space-y-1.5 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {isClosed ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onSetStatus("open")}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:border-ink-3/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw size={13} /> {t("Reopen")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => close("resolved")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-safe/40 bg-safe/10 px-2.5 py-1.5 text-[12px] font-medium text-safe hover:bg-safe/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check size={13} /> {t("Mark resolved")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => close("accepted-risk")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[12px] font-medium text-warn hover:bg-warn/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ShieldAlert size={13} /> {t("Accept risk")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => close("false-positive")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:border-ink-3/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <EyeOff size={13} /> {t("False positive")}
                </button>
              </>
            )}
          </div>
          <p className="text-[10px] text-ink-3">{t("Marks it handled — the record is kept, never deleted.")}</p>
        </div>
      ) : (
        isMcp && (
          <p className="border-t border-line pt-3 text-[11px] leading-snug text-ink-3">
            {t("This reflects your current MCP configuration — it clears once you fix the config (move the key to an env-var reference like")} <span className="font-mono">${"{VAR}"}</span> {t("and rotate it).")}
          </p>
        )
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-3">{children}</div>;
}

function SafetyHeadline({ safety, findings }: { safety: Safety; findings: number }) {
  const t = useT();
  return (
    <div className="mb-1 flex items-center justify-between">
      <div className="flex items-baseline gap-1.5">
        <span className="aac-tnum text-[30px] font-bold leading-none" style={{ color: safety.color }}>
          {safety.score}
        </span>
        <span className="text-[12px] text-ink-3">/100</span>
        <span className="ml-1 text-[15px] font-semibold" style={{ color: safety.color }}>
          {safety.grade}
        </span>
      </div>
      <div
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
        style={{ color: safety.color, background: `color-mix(in srgb, ${safety.color} 14%, transparent)` }}
      >
        {safety.safe ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
        {findings === 0 ? t("All clear") : safety.label}
      </div>
    </div>
  );
}

function RiskMatrix({ risk }: { risk: RiskRow[] }) {
  const t = useT();
  const sevs = [...SEVERITY_ORDER].reverse();
  function count(cat: RiskCategory, sev: RiskSeverity) {
    return risk.filter((r) => r.category === cat && r.severity === sev).length;
  }
  const max = Math.max(1, ...RISK_CATEGORIES.flatMap((c) => sevs.map((s) => count(c, s))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="px-1 py-1" />
            {sevs.map((s) => (
              <th key={s} className="px-1 py-1 text-center font-medium text-ink-3">
                <SeverityDot severity={s} size={7} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RISK_CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICON[cat];
            return (
              <tr key={cat}>
                <td className="py-1 pr-2">
                  <span className="flex items-center gap-1 text-ink-2">
                    <Icon size={12} className="text-ink-3" />
                    {t(CATEGORY_LABEL[cat])}
                  </span>
                </td>
                {sevs.map((s) => {
                  const v = count(cat, s);
                  return (
                    <td key={s} className="px-1 py-1 text-center">
                      <span
                        className="inline-flex h-6 w-full min-w-[26px] items-center justify-center rounded text-[11px] font-medium"
                        style={{
                          background:
                            v > 0
                              ? `color-mix(in srgb, ${SEVERITY_COLOR_VAR[s]} ${20 + (v / max) * 55}%, transparent)`
                              : "var(--color-surface-2)",
                          color: v > 0 ? "var(--color-ink)" : "var(--color-ink-3)",
                        }}
                      >
                        {v || "·"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PolicyOutcome({ outcome }: { outcome: "allowed" | "flagged" | "blocked" }) {
  const t = useT();
  const map = {
    allowed: { color: "var(--color-safe)", label: "Allowed" },
    flagged: { color: "var(--color-warn)", label: "Flagged" },
    blocked: { color: "var(--color-danger)", label: "Blocked" },
  } as const;
  const m = map[outcome];
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}
    >
      {t(m.label)}
    </span>
  );
}

function McpMap({ servers }: { servers: McpServer[] }) {
  const t = useT();
  const agents = [...new Set(servers.map((s) => s.agent))];
  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div key={agent}>
          <div className="mb-1.5 flex items-center gap-2">
            <AgentBadge agent={agent} />
            <span className="text-[11px] text-ink-3">
              {t("{n} servers", { n: servers.filter((s) => s.agent === agent).length })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {servers
              .filter((s) => s.agent === agent)
              .map((s) => (
                <div
                  key={s.id}
                  className="rounded-md border bg-surface-2 px-2.5 py-2"
                  style={{ borderColor: `color-mix(in srgb, ${SEVERITY_COLOR_VAR[s.risk]} 30%, var(--color-line))` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-mono text-[12px] text-ink">
                      <Plug size={12} style={{ color: AGENT_COLOR_VAR[agent] }} />
                      {s.name}
                    </span>
                    <RiskBadge severity={s.risk} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="rounded border border-line bg-bg px-1 py-0.5 text-[10px] text-ink-3">
                      {s.transport}
                    </span>
                    {s.permissions.map((p) => (
                      <span
                        key={p}
                        className={cn(
                          "rounded px-1 py-0.5 text-[10px] font-medium",
                          p === "exec" || p === "secrets" || p === "write"
                            ? "text-warn"
                            : "text-ink-2"
                        )}
                        style={{
                          background:
                            p === "exec" || p === "secrets" || p === "write"
                              ? "color-mix(in srgb, var(--color-warn) 14%, transparent)"
                              : "var(--color-bg)",
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{s.note}</p>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const KNOWN_AGENTS = new Set<string>(Object.keys(AGENT_LABELS));
const DIFF_BADGE_META: Record<"added" | "changed" | "removed", { label: string; colorVar: string; hint: string }> = {
  added: { label: "new", colorVar: "var(--color-safe)", hint: "First seen in the latest scan" },
  changed: { label: "changed", colorVar: "var(--color-warn)", hint: "Definition changed since the last scan" },
  removed: { label: "removed", colorVar: "var(--color-ink-3)", hint: "Not seen in the latest scan" },
};

/** Identify a row for diff matching — mirrors the (name, sourceFile) key in `src/db`. */
function inventoryKey(r: { name: string; sourceFile: string }): string {
  return `${r.name}\u0000${r.sourceFile}`;
}

function diffKind(row: McpInventoryRow, diff: McpInventoryDiff): "added" | "changed" | "removed" | null {
  const k = inventoryKey(row);
  if (diff.added.some((r) => inventoryKey(r) === k)) return "added";
  if (diff.changed.some((c) => inventoryKey(c.after) === k)) return "changed";
  if (diff.removed.some((r) => inventoryKey(r) === k)) return "removed";
  return null;
}

function DiffBadge({ kind }: { kind: "added" | "changed" | "removed" }) {
  const t = useT();
  const meta = DIFF_BADGE_META[kind];
  return (
    <span
      title={t(meta.hint)}
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: meta.colorVar, background: `color-mix(in srgb, ${meta.colorVar} 14%, transparent)` }}
    >
      {t(meta.label)}
    </span>
  );
}

/** "10 Jul" in the viewer's local timezone — inventory spans days, not minutes. */
function formatSeenDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function McpInventoryTable({ inventory, diff }: { inventory: McpInventoryRow[]; diff: McpInventoryDiff }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 text-left font-medium">{t("Server")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("Agent")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("Source")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("Command / URL")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("Env vars")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("Fingerprint")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("First–last seen")}</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map((row) => {
            const kind = diffKind(row, diff);
            const envNames = row.definition.envNames ?? [];
            return (
              <tr
                key={inventoryKey(row)}
                className={cn("border-b border-line/60", kind === "removed" && "opacity-60")}
              >
                <td className="px-3 py-1.5 align-top">
                  <div className="flex items-center gap-1.5">
                    <Plug size={12} className="shrink-0 text-ink-3" />
                    <span className="aac-truncate font-mono text-[12px] text-ink">{row.name}</span>
                    {kind && <DiffBadge kind={kind} />}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 align-top">
                  {row.agent && KNOWN_AGENTS.has(row.agent) ? (
                    <AgentBadge agent={row.agent as AgentName} />
                  ) : (
                    <span className="text-[11px] text-ink-3">{row.agent ?? "—"}</span>
                  )}
                </td>
                <td className="max-w-[160px] px-3 py-1.5 align-top" title={row.sourceFile}>
                  <span className="aac-truncate block font-mono text-[11px] text-ink-3">
                    {row.sourceFile.split("/").pop() || row.sourceFile}
                  </span>
                </td>
                <td className="max-w-[220px] px-3 py-1.5 align-top">
                  <span className="aac-truncate block font-mono text-[11px] text-ink-2">
                    {row.definition.command ?? row.definition.url ?? "—"}
                  </span>
                </td>
                <td className="max-w-[200px] px-3 py-1.5 align-top">
                  {envNames.length ? (
                    <div className="flex flex-wrap gap-1">
                      {envNames.map((n) => (
                        <span key={n} className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-ink-3">
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-ink-3">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 align-top font-mono text-[11px] text-ink-3">
                  {row.fingerprint.slice(0, 8)}
                </td>
                <td className="aac-tnum whitespace-nowrap px-3 py-1.5 align-top text-[11px] text-ink-3">
                  {formatSeenDate(row.firstSeen)}–{formatSeenDate(row.lastSeen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
