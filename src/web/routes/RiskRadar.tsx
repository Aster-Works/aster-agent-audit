import { useMemo, useState } from "react";
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
} from "lucide-react";
import {
  RISK_CATEGORIES,
  SEVERITY_ORDER,
  AGENT_LABELS,
} from "@core/types";
import type { RiskSeverity, RiskCategory } from "@core/types";
import type { McpServer, RiskRow } from "@core/views";
import { useDataset } from "../data/useDataset";
import { useAppStore } from "../app/store";
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

export function RiskRadar() {
  const navigate = useNavigate();
  const dataset = useDataset();
  const { risk, mcpServers, policyEvents, overview, mcpScan } = dataset;
  const isLive = useAppStore((s) => s.source) === "live";
  const loadLive = useAppStore((s) => s.loadLive);
  const [busy, setBusy] = useState(false);

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
  const setStatus = (r: RiskRow, status: "open" | "resolved") =>
    mutate("/api/risk-findings/resolve", { id: r.id, status });

  // Active (unresolved) findings drive the score, counters and radar; resolved
  // ones stay in the list but marked, so you can see what you've handled.
  const active = useMemo(() => risk.filter((r) => r.status !== "resolved"), [risk]);
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

  // Active first (by severity), resolved last.
  const sorted = [...risk].sort((a, b) => {
    const ar = a.status === "resolved" ? 1 : 0;
    const br = b.status === "resolved" ? 1 : 0;
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
            <span className="text-[11px] font-medium text-ink-3">Clean events</span>
            <ShieldCheck size={14} className="text-safe" />
          </div>
          <span className="aac-tnum text-[22px] font-semibold leading-none text-safe">
            {cleanEvents}
          </span>
          <span className="text-[10px] text-ink-3">no risk detected</span>
        </div>
      </div>

      {/* Main: findings list · radar+matrix · details */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Findings list */}
        <Panel
          title="Recent Flagged Events"
          icon={ListChecks}
          subtitle={
            resolvedCount > 0
              ? `${active.length} active · ${resolvedCount} resolved`
              : `${active.length} findings · ${counts.get("critical")} critical`
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
            title="Safety Surface"
            icon={safety.safe ? ShieldCheck : ShieldAlert}
            iconColor={safety.color}
            subtitle="Fuller and greener means safer"
          >
            <SafetyHeadline safety={safety} findings={active.length} />
            <RiskRadarChart
              data={safetyRadar}
              height={196}
              color={safety.color}
              fillOpacity={safety.safe ? 0.34 : 0.2}
            />
          </Panel>
          <Panel title="Risk Matrix" icon={Grid3x3} subtitle="Category × severity">
            <RiskMatrix risk={active} />
          </Panel>
        </div>

        {/* Finding details */}
        <Panel
          title="Finding Details"
          icon={ShieldAlert}
          iconColor={selected ? SEVERITY_COLOR_VAR[selected.severity] : undefined}
          action={
            selected && (
              <button
                type="button"
                onClick={() => navigate(`/session-replay/${selected.sessionId}`)}
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-3 hover:text-ink-2"
              >
                Open session <ArrowRight size={12} />
              </button>
            )
          }
        >
          {selected ? (
            <FindingDetails
              row={selected}
              canResolve={canResolve(selected)}
              busy={busy}
              onSetStatus={(status) => setStatus(selected, status)}
            />
          ) : (
            <EmptyState icon={ShieldCheck} title="No findings" />
          )}
        </Panel>
      </div>

      {/* MCP map + policy timeline */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          title="MCP Permission Map"
          icon={Plug}
          subtitle={
            mcpScan
              ? `${mcpScan.serverCount} servers · posture ${mcpScan.grade} (${mcpScan.score}/100)`
              : "Tool servers and the capabilities they hold"
          }
          className="xl:col-span-2"
        >
          {mcpServers.length ? (
            <McpMap servers={mcpServers} />
          ) : (
            <EmptyState icon={ShieldCheck} title="No MCP servers configured" />
          )}
        </Panel>

        <Panel title="Policy Timeline" icon={ListChecks} subtitle="Recent policy decisions" noBodyPadding>
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
    </div>
  );
}

function SeverityCounter({ severity, count }: { severity: RiskSeverity; count: number }) {
  const color = SEVERITY_COLOR_VAR[severity];
  return (
    <div className="aac-card-2 flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-ink-3">{SEVERITY_LABEL[severity]}</span>
        <SeverityDot severity={severity} />
      </div>
      <span className="aac-tnum text-[22px] font-semibold leading-none" style={{ color: count ? color : "var(--color-ink-3)" }}>
        {count}
      </span>
      <span className="text-[10px] text-ink-3">findings</span>
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
  const isResolved = row.status === "resolved";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-start gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2",
        selected && "bg-surface-2",
        isResolved && "opacity-55"
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
          <span className={cn("aac-truncate text-[12.5px] font-medium text-ink", isResolved && "line-through")}>
            {row.title}
          </span>
          {isResolved ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-safe" style={{ background: "color-mix(in srgb, var(--color-safe) 14%, transparent)" }}>
              <Check size={10} /> Resolved
            </span>
          ) : (
            <RiskBadge severity={row.severity} />
          )}
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
  onSetStatus: (status: "open" | "resolved") => void;
}) {
  const isMcp = row.sessionId === "mcp-config-scan";
  const isResolved = row.status === "resolved";
  const isSecret = row.category === "secrets";
  const rotate = isSecret ? rotationTarget(row) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <RiskBadge severity={row.severity} />
        <CategoryChip category={row.category} />
        <span className="ml-auto font-mono text-[11px] text-ink-3">{row.ruleId}</span>
      </div>
      <h3 className="text-[14px] font-semibold leading-snug text-ink">{row.title}</h3>

      <div className="aac-inset rounded-md px-3 py-1">
        <KeyValue label="Agent">{AGENT_LABELS[row.agent]}</KeyValue>
        <KeyValue label="Time" mono>{formatClock(row.timestamp)}</KeyValue>
        <KeyValue label="Status">
          <span className="capitalize">{row.status}</span>
        </KeyValue>
      </div>

      <div>
        <SectionTitle>What happened</SectionTitle>
        <p className="text-[12px] leading-relaxed text-ink-2">{row.description}</p>
      </div>

      {row.redactedEvidence && (
        <div>
          <SectionTitle>Evidence (redacted, not executed)</SectionTitle>
          <CommandBlock command={row.redactedEvidence} danger={row.severity !== "low" && row.severity !== "info"} />
        </div>
      )}

      <div className="rounded-md border border-safe/30 bg-safe/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-safe">
          <ShieldCheck size={12} /> Recommended action
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{row.recommendedAction}</p>
      </div>

      {/* Secret remediation: be honest that the real key lives elsewhere, and
          point to where to rotate it. Deleting this (redacted) record wouldn't
          remove the secret. */}
      {isSecret && rotate && (
        <div className="rounded-md border border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
            <KeyRound size={12} /> Rotate the key — this is the real fix
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
            This console never stored the raw key (the record above is redacted). The real value still
            sits in plaintext in the agent’s own log
            {row.agent === "codex" ? " (~/.codex/sessions/…)" : row.agent === "claude-code" ? " (~/.claude/projects/…)" : ""}
            {isMcp ? " and in the MCP config it came from" : " and wherever it came from (e.g. a .env)"} — so it’s
            already exposed. Deleting a record wouldn’t undo that; <span className="text-ink">rotate the key</span> to neutralize it.
          </p>
          {rotate.url && (
            <a
              href={rotate.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/20"
            >
              <KeyRound size={13} /> Rotate at {rotate.provider} <ExternalLink size={12} />
            </a>
          )}
          {rotate.hint && <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{rotate.hint}</p>}
        </div>
      )}

      {/* Resolve / reopen — never delete. Marks a reviewed finding as handled. */}
      {canResolve ? (
        <div className="flex items-center gap-2 border-t border-line pt-3">
          {isResolved ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSetStatus("open")}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:border-ink-3/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={13} /> Reopen
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSetStatus("resolved")}
              className="inline-flex items-center gap-1.5 rounded-md border border-safe/40 bg-safe/10 px-2.5 py-1.5 text-[12px] font-medium text-safe hover:bg-safe/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={13} /> Mark resolved
            </button>
          )}
          <span className="ml-auto text-[10px] text-ink-3">Marks it handled — the record is kept, never deleted.</span>
        </div>
      ) : (
        isMcp && (
          <p className="border-t border-line pt-3 text-[11px] leading-snug text-ink-3">
            This reflects your current MCP configuration — it clears once you fix the config (move the key to
            an env-var reference like <span className="font-mono">${"{VAR}"}</span> and rotate it).
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
        {findings === 0 ? "All clear" : safety.label}
      </div>
    </div>
  );
}

function RiskMatrix({ risk }: { risk: RiskRow[] }) {
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
                    {CATEGORY_LABEL[cat]}
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
      {m.label}
    </span>
  );
}

function McpMap({ servers }: { servers: McpServer[] }) {
  const agents = [...new Set(servers.map((s) => s.agent))];
  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div key={agent}>
          <div className="mb-1.5 flex items-center gap-2">
            <AgentBadge agent={agent} />
            <span className="text-[11px] text-ink-3">
              {servers.filter((s) => s.agent === agent).length} servers
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
