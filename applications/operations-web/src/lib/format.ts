/**
 * Formatters (isomorphic). Port of MOCK.fmt from designs/mock-data.js — identical output for the
 * default locale ("ko"). All times render in KST (Asia/Seoul, UTC+9) regardless of the browser's
 * timezone, in EVERY UI locale (the platform runs on Seoul time; labels say "KST").
 *
 * Locale-aware members take an optional trailing locale (default "ko" → unchanged legacy output):
 *   fmt.duration(ms, { style, locale })   ko long "11분 49초" · en long "11m 49s" · short "11m 49s" (both)
 *   fmt.relative(ts, now, locale)          ko "3분 전" / "방금" · en "3m ago" / "just now" / "in 2h"
 *   fmt.dateLabel(ts, locale)              ko "11월 12일 (목)" · en "Thu, Nov 12"
 *   fmt.dateTimeLabel(ts, locale)          ko "11월 12일 14:31 KST" · en "Nov 12, 14:31 KST"
 * Prefer the bound helpers: client `const f = useFmt()` (src/i18n/client), server `await getFmt()`
 * (src/i18n/server), or `createFmt(locale)` anywhere — they inject the active locale.
 * Locale-independent: bytes, number (always "2,400"), pct, usd, time, timeMs, hm, date, dateTime, iso.
 *
 * IMPORTANT: `relative(ts, now)` needs the simulator's virtual "now" (useSimNow()), never Date.now().
 */
import type { EpochMs } from "./types";

/** UI locale accepted by the formatters (mirrors src/i18n/locales.ts; kept local so this file has no deps). */
export type FmtLocale = "ko" | "en";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number | string, w = 2): string {
  let s = String(n);
  while (s.length < w) s = "0" + s;
  return s;
}

export function kstParts(ts: EpochMs) {
  const d = new Date(ts + KST);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds(),
    dow: d.getUTCDay(),
  };
}

/** Start of the KST day containing ts. */
export function kstDayStart(ts: EpochMs): EpochMs {
  return Math.floor((ts + KST) / DAY) * DAY - KST;
}

type Num = number | null | undefined;
const bad = (n: Num): n is null | undefined => n == null || Number.isNaN(n);

export const fmt = {
  /** 1536 → "1.50 KB" */
  bytes(n: Num): string {
    if (bad(n)) return "-";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return (i === 0 ? String(v) : v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)) + " " + u[i];
  },
  /** 2400 → "2,400"; number(0.5, 2) → "0.50" */
  number(n: Num, d = 0): string {
    if (bad(n)) return "-";
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  /** 0.875 → "87.5%" */
  pct(x: Num, d = 1): string {
    if (bad(x)) return "-";
    return (x * 100).toFixed(d) + "%";
  },
  usd(n: Num, d = 2): string {
    return "$" + fmt.number(n, d);
  },
  /**
   * ms → "850ms" | "4.2초" | "11분 49초" | "1시간 5분";  style:'short' → "4.2s" | "11m 49s" | "1h 05m".
   * locale "en": long → "4.2s" | "11m 49s" | "1h 5m" (English has no separate long form in the UI).
   */
  duration(ms: Num, opts?: { style?: "short" | "long"; locale?: FmtLocale }): string {
    if (bad(ms)) return "-";
    const short = opts?.style === "short";
    if (!short && opts?.locale === "en") {
      ms = Math.max(0, Math.round(ms));
      if (ms < 1000) return ms + "ms";
      const s = ms / 1000;
      if (s < 60) return (s < 10 ? s.toFixed(1) : Math.round(s)) + "s";
      const tot = Math.round(s);
      const h = Math.floor(tot / 3600);
      const m = Math.floor((tot % 3600) / 60);
      return h > 0 ? h + "h " + m + "m" : m + "m " + (tot % 60) + "s";
    }
    ms = Math.max(0, Math.round(ms));
    if (ms < 1000) return ms + "ms";
    const s = ms / 1000;
    if (s < 60) return short ? s.toFixed(1) + "s" : (s < 10 ? s.toFixed(1) : Math.round(s)) + "초";
    const tot = Math.round(s);
    const h = Math.floor(tot / 3600);
    const m = Math.floor((tot % 3600) / 60);
    const sec = tot % 60;
    if (h > 0) return short ? h + "h " + pad(m) + "m" : h + "시간 " + m + "분";
    return short ? m + "m " + pad(sec) + "s" : m + "분 " + sec + "초";
  },
  /** "14:30:00" (KST) */
  time(ts: Num): string {
    if (bad(ts)) return "-";
    const p = kstParts(ts);
    return pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s);
  },
  /** "14:30:00.123" (KST) */
  timeMs(ts: Num): string {
    if (bad(ts)) return "-";
    const p = kstParts(ts);
    return pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s) + "." + pad(p.ms, 3);
  },
  /** "14:30" (KST) */
  hm(ts: Num): string {
    if (bad(ts)) return "-";
    const p = kstParts(ts);
    return pad(p.h) + ":" + pad(p.mi);
  },
  /** "2026-11-12" (KST) */
  date(ts: Num): string {
    if (bad(ts)) return "-";
    const p = kstParts(ts);
    return p.y + "-" + pad(p.mo) + "-" + pad(p.d);
  },
  /** "11월 12일 (목)" */
  dateKo(ts: Num): string {
    if (bad(ts)) return "-";
    const p = kstParts(ts);
    return p.mo + "월 " + p.d + "일 (" + DOW_KO[p.dow] + ")";
  },
  /** ko "11월 12일 (목)" · en "Thu, Nov 12" (KST) */
  dateLabel(ts: Num, locale: FmtLocale = "ko"): string {
    if (bad(ts)) return "-";
    if (locale !== "en") return fmt.dateKo(ts);
    const p = kstParts(ts);
    return DOW_EN[p.dow] + ", " + MON_EN[p.mo - 1] + " " + p.d;
  },
  /** ko "11월 12일 14:31 KST" · en "Nov 12, 14:31 KST" */
  dateTimeLabel(ts: Num, locale: FmtLocale = "ko", opts?: { seconds?: boolean; tz?: boolean }): string {
    if (bad(ts)) return "-";
    const p = kstParts(ts);
    const clock = opts?.seconds ? fmt.time(ts) : fmt.hm(ts);
    const tz = opts?.tz === false ? "" : " KST";
    return (locale === "en" ? MON_EN[p.mo - 1] + " " + p.d + ", " : p.mo + "월 " + p.d + "일 ") + clock + tz;
  },
  /** "2026-11-12 14:30:00" */
  dateTime(ts: Num): string {
    return bad(ts) ? "-" : fmt.date(ts) + " " + fmt.time(ts);
  },
  /** ISO with +09:00 */
  iso(ts: Num): string | null {
    if (bad(ts)) return null;
    const p = kstParts(ts);
    return fmt.date(ts) + "T" + pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s) + "." + pad(p.ms, 3) + "+09:00";
  },
  /** "방금" | "12초 전" | "3분 전" | "2시간 후" — pass the SIM now (useSimNow()). en: "just now" | "12s ago" | "in 2h" */
  relative(ts: Num, now: EpochMs, locale: FmtLocale = "ko"): string {
    if (bad(ts)) return "-";
    let d = now - ts;
    const fut = d < 0;
    d = Math.abs(d);
    if (locale === "en") {
      if (d < 5 * SEC) return "just now";
      const v = d < MIN ? Math.round(d / SEC) + "s" : d < HOUR ? Math.round(d / MIN) + "m" : d < DAY ? Math.round(d / HOUR) + "h" : Math.round(d / DAY) + "d";
      return fut ? "in " + v : v + " ago";
    }
    if (d < 5 * SEC) return "방금";
    let t: string;
    if (d < MIN) t = Math.round(d / SEC) + "초";
    else if (d < HOUR) t = Math.round(d / MIN) + "분";
    else if (d < DAY) t = Math.round(d / HOUR) + "시간";
    else t = Math.round(d / DAY) + "일";
    return t + (fut ? " 후" : " 전");
  },
  shortHash(h: string | null | undefined, n = 8): string {
    return h ? String(h).slice(0, n) : "-";
  },
  /** "wf-20261112-ko-0033" → "ko-0033" */
  shortWorkflowId(id: string | null | undefined): string {
    if (!id) return "-";
    const m = /^wf-\d{8}-(\w+-\d+)$/.exec(id);
    return m ? m[1] : id;
  },
};

export type Fmt = typeof fmt;

/** `fmt` with the locale pre-applied (same member names and argument order, minus the locale). */
export interface LocaleFmt extends Omit<Fmt, "duration" | "relative" | "dateLabel" | "dateTimeLabel"> {
  readonly locale: FmtLocale;
  duration(ms: Num, opts?: { style?: "short" | "long" }): string;
  relative(ts: Num, now: EpochMs): string;
  dateLabel(ts: Num): string;
  dateTimeLabel(ts: Num, opts?: { seconds?: boolean; tz?: boolean }): string;
}

const bound = new Map<FmtLocale, LocaleFmt>();

/** Locale-bound formatter set (cached per locale). createFmt("ko") behaves exactly like `fmt`. */
export function createFmt(locale: FmtLocale = "ko"): LocaleFmt {
  let f = bound.get(locale);
  if (!f) {
    f = {
      ...fmt,
      locale,
      duration: (ms, opts) => fmt.duration(ms, { ...opts, locale }),
      relative: (ts, now) => fmt.relative(ts, now, locale),
      dateLabel: (ts) => fmt.dateLabel(ts, locale),
      dateTimeLabel: (ts, opts) => fmt.dateTimeLabel(ts, locale, opts),
    };
    bound.set(locale, f);
  }
  return f;
}
