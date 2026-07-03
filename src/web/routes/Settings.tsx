import {
  Plug,
  HardDrive,
  EyeOff,
  ShieldAlert,
  Download,
  Stethoscope,
  CheckCircle2,
  CircleAlert,
  Lock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AGENT_LABELS } from "@core/types";
import { useAppStore } from "../app/store";
import { Panel, KeyValue, Pill } from "../components/ui";
import { AgentBadge } from "../components/AgentBadge";
import { CommandBlock } from "../components/CommandBlock";

export function Settings() {
  const status = useAppStore((s) => s.dataset.status);

  return (
    <div className="space-y-4 p-4">
      {/* Local-first banner */}
      <div className="aac-card flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-safe/30 bg-safe/10">
          <Lock size={16} className="text-safe" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">
            No account. No cloud. Your agent history stays on your machine.
          </div>
          <div className="text-[11px] text-ink-3">
            Data is stored locally in SQLite. Secrets are redacted before storage. Nothing is
            uploaded by default.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Agent integrations */}
        <Panel title="Agent Integrations" icon={Plug} subtitle="Hook installation status">
          <div className="space-y-2">
            {(["claude-code", "codex"] as const).map((agent) => (
              <div key={agent} className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2.5">
                <AgentBadge agent={agent} size="md" />
                <div className="flex items-center gap-2">
                  <Pill color="var(--color-warn)">
                    <CircleAlert size={11} /> Not installed
                  </Pill>
                  <span className="text-[11px] text-ink-3">demo mode</span>
                </div>
              </div>
            ))}
            <div className="rounded-md border border-line bg-bg px-3 py-2.5">
              <div className="mb-1.5 text-[11px] text-ink-3">
                Install hooks to collect real {AGENT_LABELS["claude-code"]} / {AGENT_LABELS.codex} activity (Phase 4):
              </div>
              <CommandBlock command="aster-agent init" />
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                Existing hook config is backed up first. Hooks only POST to{" "}
                <span className="font-mono">127.0.0.1:{status.port}</span> and never block your
                workflow.
              </p>
            </div>
          </div>
        </Panel>

        {/* Local storage */}
        <Panel title="Local Storage" icon={HardDrive} subtitle="Where your data lives">
          <div className="aac-inset rounded-md px-3 py-1.5">
            <KeyValue label="Database" mono>{status.dbPath}</KeyValue>
            <KeyValue label="Config dir" mono>~/.aster-agent-console/</KeyValue>
            <KeyValue label="Spool" mono>~/.aster-agent-console/spool/</KeyValue>
            <KeyValue label="Backups" mono>~/.aster-agent-console/backups/</KeyValue>
            <KeyValue label="Mode">
              <span className="capitalize">{status.mode}</span>
            </KeyValue>
          </div>
        </Panel>

        {/* Redaction policy */}
        <Panel title="Redaction Policy" icon={EyeOff} subtitle="Secrets are stripped before storage">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              "API keys (sk-…)",
              "GitHub tokens (ghp_…)",
              "Supabase keys",
              "JWTs",
              "Private keys",
              ".env values",
              "AWS keys",
              "URL credentials",
            ].map((k) => (
              <span key={k} className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2">
                <CheckCircle2 size={12} className="text-safe" /> {k}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            Raw secret values are never persisted — only a redacted replacement, a fingerprint, and
            finding metadata.
          </p>
        </Panel>

        {/* Risk policy */}
        <Panel title="Risk Policy" icon={ShieldAlert} subtitle="Active detection rules">
          <div className="space-y-1.5 text-[12px]">
            <Rule id="AAC-SHELL-002" text="Recursive delete / rm -rf on interpolated paths" />
            <Rule id="AAC-GIT-014" text="Force push to protected branch" />
            <Rule id="AAC-SECRET-001" text="API key in tool input" />
            <Rule id="AAC-MCP-007" text="MCP server with broad exec/network capability" />
            <Rule id="AAC-NET-003" text="Outbound network during sensitive edit" />
            <Rule id="AAC-FILE-005" text="Write outside repository root" />
          </div>
        </Panel>

        {/* Export */}
        <Panel title="Export" icon={Download} subtitle="Opt-in only — nothing leaves by default">
          <div className="flex flex-wrap gap-2">
            <DisabledButton icon={Download} label="Export work report (JSON)" />
            <DisabledButton icon={Download} label="Export findings (CSV)" />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            Export is manual and local. Cloud sync remains opt-in and is not part of the MVP.
          </p>
        </Panel>

        {/* Diagnostics */}
        <Panel title="Diagnostics" icon={Stethoscope} subtitle="aster-agent doctor (Phase 3)">
          <div className="space-y-1.5">
            <Diag ok label="Node version" detail="v20.15.1" />
            <Diag ok label="Config directory writable" detail="~/.aster-agent-console" />
            <Diag ok={false} label="Local collector" detail={`offline · 127.0.0.1:${status.port}`} />
            <Diag ok label="Database readable" detail="agent-console.db" />
            <Diag ok={false} label="Hooks installed" detail="0 of 2 agents" />
          </div>
          <div className="mt-2">
            <CommandBlock command="aster-agent doctor" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Rule({ id, text }: { id: string; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
      <CheckCircle2 size={13} className="shrink-0 text-safe" />
      <span className="aac-truncate flex-1 text-ink-2">{text}</span>
      <span className="shrink-0 font-mono text-[10px] text-ink-3">{id}</span>
    </div>
  );
}

function DisabledButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-3"
      disabled
      title="Available once events are collected"
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function Diag({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">
      {ok ? (
        <CheckCircle2 size={13} className="shrink-0 text-safe" />
      ) : (
        <CircleAlert size={13} className="shrink-0 text-warn" />
      )}
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="aac-truncate font-mono text-[10px] text-ink-3">{detail}</span>
    </div>
  );
}
