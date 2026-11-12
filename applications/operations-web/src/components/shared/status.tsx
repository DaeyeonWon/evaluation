/**
 * Standardized status presentation (plan §6.4 "Visual Consistency").
 * Colors come ONLY from CSS tokens --st-<tone> (globals.css; light/dark aware), so each variant
 * can restyle shape/size while the meaning of a color stays identical across the app.
 *
 *   <StatusPill status="RUNNING" />                       // workflow status (default kind)
 *   <StatusPill kind="node" status="FAILED" />            // DAG node
 *   <StatusPill kind="dlq" status="PENDING_REVIEW" />     // DLQ item
 *   <StatusIcon status="RETRY_WAIT" size={14} />
 *   <TonePill tone="retry" icon="rotate-ccw">Backoff 60s</TonePill>
 *   <SeverityBadge severity="ERROR" />   <LangBadge lang="ko" />   <LangDot lang="en" />
 *
 * Rendered markup: <span class="st-pill" data-tone="running" data-status="RUNNING" style="--tone: var(--st-running)">.
 * Base styles for .st-pill / .st-icon / .lang-badge live in globals.css (minimal; override freely
 * under your [data-variant] scope) — or pass `unstyled` to drop the base class.
 */
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import {
  ATTEMPT_STATUS_META,
  DLQ_STATUS_META,
  LANGUAGE_BY_CODE,
  NODE_STATUS_META,
  SEVERITY_META,
  STATUS_META,
} from "@/lib/catalog";
import type { AttemptStatus, DlqStatus, LangCode, MetaEntry, NodeStatus, Severity, Tone, WorkflowStatus } from "@/lib/types";
import { CatalogIcon } from "./icons";

export type StatusKind = "workflow" | "node" | "attempt" | "dlq";

type StatusByKind = {
  workflow: WorkflowStatus;
  node: NodeStatus;
  attempt: AttemptStatus;
  dlq: DlqStatus;
};

/** Resolve tone/label/icon for any status kind. */
export function statusInfo(kind: StatusKind, status: string): MetaEntry & { labelEn?: string } {
  const table: Record<string, MetaEntry & { labelEn?: string }> =
    kind === "node" ? NODE_STATUS_META : kind === "attempt" ? ATTEMPT_STATUS_META : kind === "dlq" ? DLQ_STATUS_META : STATUS_META;
  return table[status] ?? { label: status, tone: "queued", icon: "circle-dashed" };
}

export const toneVar = (tone: Tone) => `var(--st-${tone})`;
export const langVar = (lang: LangCode) => `var(--lang-${lang})`;

/** Statuses whose icon should spin (running / dispatching). */
const SPIN = new Set(["RUNNING", "DISPATCHING", "REPLAYING"]);

export interface StatusPillProps<K extends StatusKind = "workflow"> {
  status: StatusByKind[K];
  kind?: K;
  /** override the Korean label */
  label?: ReactNode;
  /** show English label instead (workflow kind only) */
  english?: boolean;
  showIcon?: boolean;
  /** spin the icon for in-progress statuses (default true; disabled under prefers-reduced-motion by CSS) */
  spin?: boolean;
  size?: "xs" | "sm" | "md";
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function StatusPill<K extends StatusKind = "workflow">({
  status,
  kind,
  label,
  english,
  showIcon = true,
  spin = true,
  size = "sm",
  unstyled,
  className,
  style,
  title,
}: StatusPillProps<K>) {
  const info = statusInfo(kind ?? "workflow", status);
  return (
    <span
      className={clsx(!unstyled && "st-pill", className)}
      data-tone={info.tone}
      data-status={status}
      data-size={size}
      title={title ?? (info.labelEn ? `${info.label} · ${info.labelEn}` : info.label)}
      style={{ ["--tone" as string]: toneVar(info.tone), ...style }}
    >
      {showIcon && <CatalogIcon name={info.icon} className={clsx("st-icon", spin && SPIN.has(status) && "st-spin")} aria-hidden />}
      <span className="st-label">{label ?? (english && info.labelEn ? info.labelEn : info.label)}</span>
    </span>
  );
}

export interface StatusIconProps<K extends StatusKind = "workflow"> {
  status: StatusByKind[K];
  kind?: K;
  size?: number;
  spin?: boolean;
  className?: string;
  /** accessible label (defaults to the Korean status label) */
  title?: string;
}

export function StatusIcon<K extends StatusKind = "workflow">({ status, kind, size = 14, spin = true, className, title }: StatusIconProps<K>) {
  const info = statusInfo(kind ?? "workflow", status);
  return (
    <CatalogIcon
      name={info.icon}
      size={size}
      className={clsx("st-icon", spin && SPIN.has(status) && "st-spin", className)}
      style={{ color: toneVar(info.tone) }}
      data-tone={info.tone}
      role="img"
      aria-label={title ?? info.label}
    />
  );
}

export function TonePill({
  tone,
  icon,
  children,
  className,
  unstyled,
  size = "sm",
}: {
  tone: Tone;
  icon?: string;
  children: ReactNode;
  className?: string;
  unstyled?: boolean;
  size?: "xs" | "sm" | "md";
}) {
  return (
    <span className={clsx(!unstyled && "st-pill", className)} data-tone={tone} data-size={size} style={{ ["--tone" as string]: toneVar(tone) }}>
      {icon && <CatalogIcon name={icon} className="st-icon" aria-hidden />}
      <span className="st-label">{children}</span>
    </span>
  );
}

export function SeverityBadge({ severity, className, unstyled }: { severity: Severity; className?: string; unstyled?: boolean }) {
  const m = SEVERITY_META[severity] ?? { label: severity, tone: "queued" as Tone };
  return (
    <span
      className={clsx(!unstyled && "st-pill st-sev", className)}
      data-tone={m.tone}
      data-severity={severity}
      data-size="xs"
      style={{ ["--tone" as string]: toneVar(m.tone) }}
    >
      <span className="st-label">{m.label}</span>
    </span>
  );
}

export function LangDot({ lang, size = 8, className }: { lang: LangCode; size?: number; className?: string }) {
  return (
    <span
      className={clsx("lang-dot", className)}
      data-lang={lang}
      aria-hidden
      style={{ display: "inline-block", width: size, height: size, borderRadius: 999, background: langVar(lang), flex: "none" }}
    />
  );
}

export function LangBadge({
  lang,
  display = "code",
  className,
  unstyled,
}: {
  lang: LangCode;
  /** "code" → KO · "name" → 한국어 · "both" → KO 한국어 */
  display?: "code" | "name" | "both";
  className?: string;
  unstyled?: boolean;
}) {
  const l = LANGUAGE_BY_CODE[lang];
  return (
    <span className={clsx(!unstyled && "lang-badge", className)} data-lang={lang} style={{ ["--lang" as string]: langVar(lang) }} title={l?.name}>
      <LangDot lang={lang} />
      {display !== "name" && <span className="lang-code">{lang.toUpperCase()}</span>}
      {display !== "code" && <span className="lang-name">{l?.name ?? lang}</span>}
    </span>
  );
}
