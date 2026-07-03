import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Neutral surface card. */
export function Surface({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("aac-card", className)}>{children}</div>;
}

/** Standard panel: header (title + optional action) over a body. */
export function Panel({
  title,
  subtitle,
  icon: Icon,
  iconColor,
  action,
  children,
  className,
  bodyClassName,
  noBodyPadding,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  iconColor?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noBodyPadding?: boolean;
}) {
  return (
    <section className={cn("aac-card flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && (
              <Icon
                size={15}
                strokeWidth={2}
                style={{ color: iconColor ?? "var(--color-ink-2)" }}
                className="shrink-0"
              />
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="aac-truncate text-[13px] font-semibold tracking-tight text-ink">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="aac-truncate text-[11px] text-ink-3">{subtitle}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div
        className={cn(
          "min-w-0 flex-1",
          !noBodyPadding && "p-4",
          bodyClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function StatusDot({
  color,
  pulse,
  size = 8,
}: {
  color: string;
  pulse?: boolean;
  size?: number;
}) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {pulse && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
      )}
      <span
        className="relative inline-block rounded-full"
        style={{ width: size, height: size, background: color }}
      />
    </span>
  );
}

export function Pill({
  children,
  color,
  className,
  title,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        className
      )}
      style={
        color
          ? {
              color,
              borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
            }
          : {
              color: "var(--color-ink-2)",
              borderColor: "var(--color-line)",
              background: "var(--color-surface-2)",
            }
      }
    >
      {children}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-2">
        <Icon size={18} className="text-ink-3" />
      </div>
      <div className="text-[13px] font-medium text-ink-2">{title}</div>
      {children && (
        <div className="max-w-sm text-[12px] leading-relaxed text-ink-3">
          {children}
        </div>
      )}
    </div>
  );
}

/** Inline key/value row used in inspectors. */
export function KeyValue({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] text-ink-3">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-[12px] text-ink-2",
          mono && "font-mono",
          "aac-truncate"
        )}
      >
        {children}
      </span>
    </div>
  );
}
