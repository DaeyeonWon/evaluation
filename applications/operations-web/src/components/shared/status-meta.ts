/**
 * Isomorphic status helpers (no hooks — safe in server components, route handlers and chart callbacks).
 * Labels come from the i18n `status` namespace (src/i18n/messages/{ko,en}/status.ts); tone/icon from
 * the catalog. Components live in ./status.tsx.
 *
 *   statusInfo("workflow", "RUNNING")              // { label: "Running", labelEn: "Running", help: "실행 중 · …", tone, icon }
 *   statusInfo("dlq", "PENDING_REVIEW", "en")      // { label: "Pending review", help: "Needs operator review", … }
 */
import { ATTEMPT_STATUS_META, DLQ_STATUS_META, NODE_STATUS_META, STATUS_META } from "@/lib/catalog";
import type { LangCode, MetaEntry, Tone } from "@/lib/types";
import type { Locale } from "@/i18n/locales";
import { statusHelp, statusLabel } from "@/i18n/static";

export type StatusKind = "workflow" | "node" | "attempt" | "dlq";

export interface StatusInfo extends MetaEntry {
  /** English display label (same as `label` under the default policy; kept for older callers) */
  labelEn: string;
  /** localized explanation for tooltips / legends ("" if none) */
  help: string;
}

/** Resolve tone/label/icon/help for any status kind in `locale` (default "ko"). */
export function statusInfo(kind: StatusKind, status: string, locale: Locale = "ko"): StatusInfo {
  const table: Record<string, MetaEntry> =
    kind === "node" ? NODE_STATUS_META : kind === "attempt" ? ATTEMPT_STATUS_META : kind === "dlq" ? DLQ_STATUS_META : STATUS_META;
  const meta = table[status] ?? { label: status, tone: "queued" as Tone, icon: "circle-dashed" };
  return {
    tone: meta.tone,
    icon: meta.icon,
    label: statusLabel(kind, status, locale),
    labelEn: statusLabel(kind, status, "en"),
    help: statusHelp(kind, status, locale),
  };
}

export const toneVar = (tone: Tone) => `var(--st-${tone})`;
export const langVar = (lang: LangCode) => `var(--lang-${lang})`;
