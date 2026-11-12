"use client";
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
 * Labels are localized through the i18n `status` namespace (useLocale(); works without a provider →
 * "ko"). Policy: status names are English system terms in every locale ("Running"); the tooltip adds
 * the localized explanation ("Running · 실행 중 · Vertex AI Pipeline이 실행되고 있습니다").
 * Pure helpers (statusInfo, toneVar, langVar) live in ./status-meta.ts so server code can call them.
 *
 * Rendered markup: <span class="st-pill" data-tone="running" data-status="RUNNING" style="--tone: var(--st-running)">.
 * Base styles for .st-pill / .st-icon / .lang-badge live in globals.css (minimal; override freely
 * under your [data-variant] scope) — or pass `unstyled` to drop the base class.
 */
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { SEVERITY_META } from "@/lib/catalog";
import type { AttemptStatus, DlqStatus, LangCode, NodeStatus, Severity, Tone, WorkflowStatus } from "@/lib/types";
import { useLocale } from "@/i18n/client";
import { languageName, statusHelp, statusLabel } from "@/i18n/static";
import { CatalogIcon } from "./icons";
import { langVar, statusInfo, toneVar, type StatusKind } from "./status-meta";

export type { StatusKind } from "./status-meta";

type StatusByKind = {
  workflow: WorkflowStatus;
  node: NodeStatus;
  attempt: AttemptStatus;
  dlq: DlqStatus;
};

/** Statuses whose icon should spin (running / dispatching). */
const SPIN = new Set(["RUNNING", "DISPATCHING", "REPLAYING"]);

export interface StatusPillProps<K extends StatusKind = "workflow"> {
  status: StatusByKind[K];
  kind?: K;
  /** override the label */
  label?: ReactNode;
  /** force the English label regardless of the UI locale */
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
  const locale = useLocale();
  const info = statusInfo(kind ?? "workflow", status, locale);
  return (
    <span
      className={clsx(!unstyled && "st-pill", className)}
      data-tone={info.tone}
      data-status={status}
      data-size={size}
      title={title ?? (info.help ? `${info.label} · ${info.help}` : info.label)}
      style={{ ["--tone" as string]: toneVar(info.tone), ...style }}
    >
      {showIcon && <CatalogIcon name={info.icon} className={clsx("st-icon", spin && SPIN.has(status) && "st-spin")} aria-hidden />}
      <span className="st-label">{label ?? (english ? info.labelEn : info.label)}</span>
    </span>
  );
}

export interface StatusIconProps<K extends StatusKind = "workflow"> {
  status: StatusByKind[K];
  kind?: K;
  size?: number;
  spin?: boolean;
  className?: string;
  /** accessible label (defaults to the localized status label) */
  title?: string;
}

export function StatusIcon<K extends StatusKind = "workflow">({ status, kind, size = 14, spin = true, className, title }: StatusIconProps<K>) {
  const info = statusInfo(kind ?? "workflow", status, useLocale());
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
  const locale = useLocale();
  const tone = SEVERITY_META[severity]?.tone ?? ("queued" as Tone);
  const label = statusLabel("severity", severity, locale);
  const help = statusHelp("severity", severity, locale);
  return (
    <span
      className={clsx(!unstyled && "st-pill st-sev", className)}
      data-tone={tone}
      data-severity={severity}
      data-size="xs"
      title={help && help !== label ? `${label} · ${help}` : undefined}
      style={{ ["--tone" as string]: toneVar(tone) }}
    >
      <span className="st-label">{label}</span>
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
  /** "code" → KO · "name" → 한국어 / Korean (UI locale) · "both" → KO 한국어 */
  display?: "code" | "name" | "both";
  className?: string;
  unstyled?: boolean;
}) {
  const name = languageName(lang, useLocale());
  return (
    <span className={clsx(!unstyled && "lang-badge", className)} data-lang={lang} style={{ ["--lang" as string]: langVar(lang) }} title={name}>
      <LangDot lang={lang} />
      {display !== "name" && <span className="lang-code">{lang.toUpperCase()}</span>}
      {display !== "code" && <span className="lang-name">{name}</span>}
    </span>
  );
}
