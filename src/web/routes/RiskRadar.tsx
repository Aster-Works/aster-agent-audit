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
  Trash2,
  BellOff,
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
  const canAct = (r: RiskRow) => isLive && r.sessionId !== "mcp-config-scan";

  async function mutate(path: string, body: object) {
    setBusy(true);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setSelectedId("");
      await loadLive();
    } finally {
      setBusy(false);
    }
  }

  const resolveFinding = (r: RiskRow) => mutate("/api/risk-findings/resolve", { id: r.id });
  const deleteFinding = (r: RiskRow) => {
    const msg =
      r.category === "secrets"
        ? "Delete this record? The finding and the captured event it came from will be permanently removed."
        : "Delete this record? The finding and its source event will be permanently removed.";
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    return mutate("/api/risk-findings/delete", { id: r.id, purgeEvent: true });
  };
  const ignoreRule = (r: RiskRow) => {
    const msg = `Ignore every "${r.ruleId}" finding? They stop showing on the Risk Radar (raw records are kept). Undo by editing ~/.aster-agent-console/policy.json.`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    return mutate("/api/risk-findings/ignore-rule", { ruleId: r.ruleId });
  };

  const counts = useMemo(() => {
    const m = new Map<RiskSeverity, number>();
    for (const sev of SEVERITY_ORDER) m.set(sev, 0);
    for (const r of risk) m.set(r.severity, (m.get(r.severity) ?? 0) + 1);
    return m;
  }, [risk]);

  const cleanEvents = Math.max(0, overview.totals.toolCalls - risk.length);
  const radar = radarScores(risk, RISK_CATEGORIES);
  // Safety surface: invert risk so a fully safe setup reads as a big, full
  // green hexagon. Categories with findings dip inward.
  const safety = computeSafety(risk);
  const safetyRadar = toSafetyRadar(radar);

  const sorted = [...risk].sort(
    (a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity)
  );

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
          subtitle={`${risk.length} findings · ${counts.get("critical")} critical`}
          noBodyPadding
        >
          <div className="max-h-[440px] overflow-y-auto">
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
            <SafetyHeadline safety={safety} findings={risk.length} />
            <RiskRadarChart
              data={safetyRadar}
              height={196}
              color={safety.color}
              fillOpacity={safety.safe ? 0.34 : 0.2}
            />
          </Panel>
          <Panel title="Risk Matrix" icon={Grid3x3} subtitle="Category × severity">
            <RiskMatrix risk={risk} />
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
              canAct={canAct(selected)}
              canIgnore={isLive}
              busy={busy}
              onResolve={() => resolveFinding(selected)}
              onDelete={() => deleteFinding(selected)}
              onIgnore={() => ignoreRule(selected)}
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-start gap-2.5 border-b border-line/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2",
        selected && "bg-surface-2"
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
          <span className="aac-truncate text-[12.5px] font-medium text-ink">{row.title}</span>
          <RiskBadge severity={row.severity} />
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

function FindingDetails({
  row,
  canAct,
  canIgnore,
  busy,
  onResolve,
  onDelete,
  onIgnore,
}: {
  row: RiskRow;
  canAct: boolean;
  canIgnore: boolean;
  busy: boolean;
  onResolve: () => void;
  onDelete: () => void;
  onIgnore: () => void;
}) {
  const isMcp = row.sessionId === "mcp-config-scan";
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

      {/* Actions: resolve / delete a stored record, or ignore the whole rule */}
      {(canAct || canIgnore) && (
        <div className="space-y-2 border-t border-line pt-3">
          {canAct && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onResolve}
                className="inline-flex items-center gap-1.5 rounded-md border border-safe/40 bg-safe/10 px-2.5 py-1.5 text-[12px] font-medium text-safe hover:bg-safe/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check size={13} /> Resolve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={13} /> Delete record
              </button>
              <span className="ml-auto text-[10px] text-ink-3">Resolve dismisses; Delete purges the record.</span>
            </div>
          )}
          {isMcp && (
            <p className="text-[11px] leading-snug text-ink-3">
              This reflects your current MCP configuration — fix the config to clear it, or ignore the rule below.
            </p>
          )}
          {canIgnore && (
            <button
              type="button"
              disabled={busy}
              onClick={onIgnore}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] font-medium text-ink-2 hover:border-ink-3/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <BellOff size={12} /> Ignore this rule ({row.ruleId})
            </button>
          )}
        </div>
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
