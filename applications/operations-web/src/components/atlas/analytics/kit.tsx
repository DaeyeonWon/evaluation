"use client";
/**
 * Small helpers shared by the data screens (DLQ, Results, Analytics):
 * - useRangeInfo(): the global period (useTimeRange) + a localized label + bucket choice
 * - useApiErrorHandler(): 401 → /login?next=…, 403 → localized message, else the server message
 * - RangeTag: inline "period" chip for plate headers
 */
import { useCallback, useEffect, useMemo } from "react";
import { ApiClientError, useTimeRange } from "@/lib/client";
import { redirectToLogin } from "@/lib/client/auth-redirect";
import { RANGE_PRESETS } from "@/lib/time-range";
import type { ResolvedRange } from "@/lib/types";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { useToast } from "../ui";

export type Bucket = "5m" | "hour" | "day";
const HOUR = 3600e3;

/** 5-min for ≤ 24h, hourly for ≤ 7d, daily beyond (30d). */
export function bucketFor(spanMs: number): Bucket {
  if (spanMs <= 24 * HOUR + 5 * 60e3) return "5m";
  if (spanMs <= 7 * 24 * HOUR + HOUR) return "hour";
  return "day";
}

export function useRangeLabel() {
  const locale = useLocale();
  const f = useFmt();
  const t = useT("analytics");
  return useCallback(
    (r: Pick<ResolvedRange, "from" | "to" | "preset">) => {
      const p = RANGE_PRESETS.find((x) => x.id === r.preset);
      const name = p ? (locale === "en" ? p.labelEn : p.label) : null;
      if (r.preset === "today") return `${name} · ${f.dateLabel(r.to)}`;
      if (r.preset === "yesterday") return `${name} · ${f.dateLabel(r.from)}`;
      if (name) return name;
      const m = /^(\d+)([hd])$/.exec(r.preset);
      if (m) return t(m[2] === "d" ? "range.lastDays" : "range.lastHours", { count: Number(m[1]) });
      return `${f.dateTimeLabel(r.from, { tz: false })} – ${f.dateTimeLabel(r.to)}`;
    },
    [locale, f, t],
  );
}

/** Global time range, plus a localized label (server range wins once a response is in). */
export function useRangeInfo(server?: ResolvedRange | null) {
  const tr = useTimeRange();
  const label = useRangeLabel();
  const r = server ?? tr.resolved;
  const span = Math.max(0, r.to - r.from);
  return useMemo(() => ({ ...tr, range: r, span, label: label(r), bucket: bucketFor(span) }), [tr, r, span, label]);
}

/** Session expired → /login?next=<current URL> (full navigation, loop-guarded; see lib/client/auth-redirect). */
export function useLoginRedirect() {
  return redirectToLogin;
}

/** Returns an error reporter for catch blocks: 401 → login redirect, 403 → localized toast. */

export function useApiErrorHandler() {
  const toast = useToast();
  const toLogin = useLoginRedirect();
  const t = useT("analytics");
  return useCallback(
    (e: unknown) => {
      if (e instanceof ApiClientError && e.status === 401) {
        toLogin();
        return;
      }
      if (e instanceof ApiClientError && e.status === 403) return toast.err(new Error(`${t("errors.forbidden")} (${e.message})`));
      toast.err(e);
    },
    [toast, t, toLogin],
  );
}

/** Inline error block for a failed query (401 redirects, 403 gets the localized text). */
export function QueryError({ error }: { error: unknown }) {
  const t = useT("analytics");
  const toLogin = useLoginRedirect();
  const expired = error instanceof ApiClientError && error.status === 401;
  useEffect(() => {
    if (expired) toLogin();
  }, [expired, toLogin]);
  if (!error || expired) return null;
  const msg = error instanceof ApiClientError && error.status === 403 ? t("errors.forbidden") : error instanceof Error ? error.message : String(error);
  return (
    <div className="note bad" role="alert">
      {t("errors.loadFailed")} · {msg}
    </div>
  );
}

export function RangeTag({ label }: { label: string }) {
  return <span className="ad-range">{label}</span>;
}
