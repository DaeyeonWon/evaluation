"use client";
/**
 * Atlas global period selector (header) + range helpers shared by every Atlas screen.
 *
 *   <RangePicker />                         header control: presets, custom KST from/to, data window ruler
 *   const label = useRangeLabel();          localized { title, span } for the current URL range
 *   const href = useRangeHref();            href("/explorer?status=X") → keeps ?range= / ?from=&to=
 *   const cover = useCoverHref();           cover("/results?workflow_id=…", wf.created_at, wf.completed_at)
 *                                           → keeps the range, widened to include [from, to] if needed
 *   <RangeEmpty title=… />                  range-aware empty state ("no items in <label>")
 *
 * The range lives in the URL (useTimeRange → ?range=7d | ?from=…&to=…; "today" is omitted), so it
 * survives reloads; nav links carry it so it also survives navigation. The server's
 * `response.range.label` is Korean-only, so labels are always rebuilt here from from/to + locale.
 */
import clsx from "clsx";
import { CalendarRange, Check, ChevronDown, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import { api, useApi, useSimNow, useTimeRange } from "@/lib/client";
import { kstParts } from "@/lib/format";
import { PRESET_IDS, kstDayStart, resolveRange, serializeRange, type RangePreset, type RangeSpec, type ResolvedRange } from "@/lib/time-range";
import { useReducedMotionSafe } from "./ui";

const DAY = 86_400_000;
const RANGE_KEYS = ["range", "from", "to"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
/** epoch → "YYYY-MM-DD" (KST) */
export function kstDateInput(ts: number): string {
  const p = kstParts(ts);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}
/** epoch → "HH:MM" (KST) */
export function kstTimeInput(ts: number): string {
  const p = kstParts(ts);
  return `${pad(p.h)}:${pad(p.mi)}`;
}
/** "YYYY-MM-DD" + "HH:MM" (KST) → epoch, or null */
export function fromKstInputs(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const n = Date.parse(`${date}T${time}:00+09:00`);
  return Number.isFinite(n) ? n : null;
}
const shortDT = (ts: number) => {
  const p = kstParts(ts);
  return `${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
};

/* ───────────── labels ───────────── */

export interface RangeLabel {
  /** "오늘 · 11월 13일 (금)" / "Today · Fri, Nov 13" / "최근 7일" / "11-10 09:00 – 11-12 14:30" */
  title: string;
  /** exact bounds: "11-13 00:00 – 11-13 14:30 KST" */
  span: string;
  /** short mono chip: "TODAY" / "7D" / "CUSTOM" */
  short: string;
  resolved: ResolvedRange;
}

/** Localized label for a spec (default: the URL range). Depends on the virtual clock. */
export function useRangeLabel(specArg?: RangeSpec): RangeLabel {
  const tr = useTimeRange();
  const t = useT("shell");
  const f = useFmt();
  const now = useSimNow();
  const spec = specArg ?? tr.spec;
  return useMemo(() => {
    const r = resolveRange(spec, now);
    let title: string;
    let short: string;
    if (spec.kind === "preset") {
      short = spec.preset.toUpperCase();
      if (spec.preset === "today") title = t("range.label.today", { date: f.dateLabel(now) });
      else if (spec.preset === "yesterday") title = t("range.label.yesterday", { date: f.dateLabel(r.from) });
      else title = t(`range.presets.${spec.preset}`);
    } else if (spec.kind === "last") {
      title = spec.unit === "d" ? t("range.label.lastDays", { count: spec.amount }) : t("range.label.lastHours", { count: spec.amount });
      short = `${spec.amount}${spec.unit}`.toUpperCase();
    } else {
      title = `${shortDT(r.from)} – ${Number.isFinite(spec.to) ? shortDT(r.to) : t("range.label.now")}`;
      short = t("range.customShort");
    }
    const span = `${shortDT(r.from)} – ${shortDT(r.to)} ${t("range.kst")}`;
    return { title, span, short, resolved: r };
  }, [spec, now, t, f]);
}

/** Append the current URL range (range/from/to) to an in-app href. External or hash hrefs are untouched. */
export function withRange(href: string, rangeQs: string): string {
  if (!rangeQs || !href.startsWith("/")) return href;
  const [pathAndQuery, hash] = href.split("#");
  const [path, query] = pathAndQuery.split("?");
  const sp = new URLSearchParams(query ?? "");
  RANGE_KEYS.forEach((k) => sp.delete(k));
  new URLSearchParams(rangeQs).forEach((v, k) => sp.set(k, v));
  const s = sp.toString();
  return path + (s ? "?" + s : "") + (hash ? "#" + hash : "");
}

/** The range part of the current URL ("range=7d" | "from=…&to=…" | ""). */
export function useRangeQs(): string {
  const sp = useSearchParams();
  const range = sp.get("range");
  const from = sp.get("from");
  const to = sp.get("to");
  return useMemo(() => {
    const o = new URLSearchParams();
    if (from || to) {
      if (from) o.set("from", from);
      if (to) o.set("to", to);
    } else if (range && range !== "today") o.set("range", range);
    return o.toString();
  }, [range, from, to]);
}

/** `href => href + current range` for links and router.push. */
export function useRangeHref(): (href: string) => string {
  const q = useRangeQs();
  return useCallback((href: string) => withRange(href, q), [q]);
}

/**
 * `href` + a range that is guaranteed to contain [from, to] (e.g. one Workflow's created..completed),
 * so a link to that Workflow's results is never empty. Inside the current range → same as
 * useRangeHref(); otherwise → a custom range = union of the current range and [from, to], left open
 * ("until now") when the current range is live.
 */
export function useCoverHref(): (href: string, from: number, to?: number | null) => string {
  const tr = useTimeRange();
  const q = useRangeQs();
  const now = useSimNow();
  const { from: cf, to: ct } = tr.resolved;
  return useCallback(
    (href: string, from: number, to?: number | null) => {
      const end = to ?? now;
      if (from >= cf && end <= ct) return withRange(href, q);
      const live = ct >= now - 60_000;
      const spec: RangeSpec = { kind: "custom", from: Math.min(cf, from), to: live ? Infinity : Math.max(ct, end + 60_000) };
      return withRange(href, new URLSearchParams(serializeRange(spec)).toString());
    },
    [cf, ct, now, q],
  );
}

/** Range-aware empty state: names the range and optionally hints at items outside it. */
export function RangeEmpty({ title, hint, outside, children }: { title?: string; hint?: ReactNode; outside?: ReactNode; children?: ReactNode }) {
  const t = useT("shell");
  const L = useRangeLabel();
  return (
    <div className="empty range-empty">
      <CalendarRange aria-hidden className="range-empty-ico" />
      <b>{title ?? t("range.empty.title")}</b>
      <span suppressHydrationWarning>{t("range.empty.in", { range: L.title })}</span>
      {hint ? <span>{hint}</span> : null}
      {outside ? <span className="range-outside">{outside}</span> : null}
      {children}
    </div>
  );
}

/** Small "range" readout for plate headers: "오늘 · 11월 13일 (금)". */
export function RangeTag({ prefix }: { prefix?: string }) {
  const L = useRangeLabel();
  return (
    <span className="range-tag" title={L.span} suppressHydrationWarning>
      <CalendarRange aria-hidden />
      {prefix ? `${prefix} · ` : null}
      {L.title}
    </span>
  );
}

/* ───────────── picker ───────────── */

function Ruler({ earliest, now, from, to }: { earliest: number; now: number; from: number; to: number }) {
  const reduced = useReducedMotionSafe();
  const start = kstDayStart(earliest);
  const end = now;
  const span = Math.max(1, end - start);
  const days = Math.ceil(span / DAY);
  const l = Math.max(0, Math.min(1, (from - start) / span));
  const r = Math.max(0, Math.min(1, (to - start) / span));
  return (
    <div className="tr-ruler" aria-hidden>
      <div className="tr-ticks">
        {Array.from({ length: days + 1 }, (_, i) => (
          <i key={i} className={clsx(i % 7 === 0 && "maj")} style={{ left: `${((i * DAY) / span) * 100}%` }} />
        ))}
      </div>
      <motion.div className="tr-sel" initial={false} animate={{ left: `${l * 100}%`, width: `${Math.max(0.6, (r - l) * 100)}%` }} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 36 }} />
      <div className="tr-ends mono">
        <span>{kstDateInput(start).slice(5)}</span>
        <span>{kstDateInput(end).slice(5)}</span>
      </div>
    </div>
  );
}

export function RangePicker({ className }: { className?: string }) {
  const tr = useTimeRange();
  const t = useT("shell");
  const now = useSimNow();
  const reduced = useReducedMotionSafe();
  const L = useRangeLabel();
  const meta = useApi(["meta"], () => api.meta(), { revalidateOn: ["sim"], revalidateOnFocus: false });
  const earliest = meta.data?.dataWindow.earliest ?? now - 30 * DAY;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const popId = useId();

  const cur = tr.resolved;
  const [fd, setFd] = useState("");
  const [ft, setFt] = useState("");
  const [td, setTd] = useState("");
  const [tt, setTt] = useState("");
  const openPicker = () => {
    setFd(kstDateInput(cur.from));
    setFt(kstTimeInput(cur.from));
    setTd(kstDateInput(cur.to));
    setTt(kstTimeInput(cur.to));
    setOpen(true);
  };
  const close = useCallback((focus = true) => {
    setOpen(false);
    if (focus) btn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const from = fromKstInputs(fd, ft);
  const to = fromKstInputs(td, tt);
  const minDate = kstDateInput(earliest);
  const maxDate = kstDateInput(now);
  const err =
    from == null || to == null
      ? t("range.errors.invalid")
      : from >= to
        ? t("range.errors.order")
        : from < kstDayStart(earliest)
          ? t("range.errors.before", { date: minDate })
          : to > now + 60_000
            ? t("range.errors.after")
            : null;
  const preview = from != null && to != null && !err ? { from, to } : { from: cur.from, to: cur.to };

  const pick = (s: RangeSpec) => {
    tr.setSpec(s, { history: "push" });
    close();
  };
  const activePreset = tr.spec.kind === "preset" ? tr.spec.preset : tr.spec.kind === "last" ? `${tr.spec.amount}${tr.spec.unit}` : "custom";

  return (
    <div className={clsx("tr", className)} ref={wrap}>
      <button
        ref={btn}
        type="button"
        className={clsx("btn tr-btn", !tr.isDefault && "on")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={t("range.aria", { label: L.title })}
        title={L.span}
        suppressHydrationWarning
        onClick={() => (open ? close() : openPicker())}
      >
        <CalendarRange aria-hidden />
        <span className="tr-short">{L.short}</span>
        <span className="tr-label" suppressHydrationWarning>
          {L.title}
        </span>
        <ChevronDown aria-hidden className="tr-chev" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={popId}
            className="tr-pop"
            role="dialog"
            aria-label={t("range.dialog")}
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="tr-head">
              <span className="dwg">{t("range.sheet")}</span>
              <b suppressHydrationWarning>{L.title}</b>
              <span className="mono muted" suppressHydrationWarning>
                {L.span}
              </span>
            </div>
            <div className="tr-grid">
              <div className="tr-presets" role="group" aria-label={t("range.presetsLabel")}>
                {PRESET_IDS.map((p: RangePreset) => (
                  <button key={p} type="button" aria-pressed={activePreset === p} onClick={() => pick({ kind: "preset", preset: p })} autoFocus={activePreset === p}>
                    <span>{t(`range.presets.${p}`)}</span>
                    <span className="mono muted">{p}</span>
                    {activePreset === p ? <Check aria-hidden /> : null}
                  </button>
                ))}
              </div>
              <form
                className="tr-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!err && from != null && to != null) pick({ kind: "custom", from, to });
                }}
              >
                <div className="tr-custom-h">
                  {t("range.custom")} <span className="mono muted">{t("range.kst")}</span>
                </div>
                <fieldset>
                  <legend>{t("range.from")}</legend>
                  <input className="in mono" type="date" value={fd} min={minDate} max={maxDate} onChange={(e) => setFd(e.target.value)} aria-label={t("range.fromDate")} required />
                  <input className="in mono" type="time" value={ft} onChange={(e) => setFt(e.target.value)} aria-label={t("range.fromTime")} required />
                </fieldset>
                <fieldset>
                  <legend>{t("range.to")}</legend>
                  <input className="in mono" type="date" value={td} min={minDate} max={maxDate} onChange={(e) => setTd(e.target.value)} aria-label={t("range.toDate")} required />
                  <input className="in mono" type="time" value={tt} onChange={(e) => setTt(e.target.value)} aria-label={t("range.toTime")} required />
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => {
                      setTd(kstDateInput(now));
                      setTt(kstTimeInput(now));
                    }}
                  >
                    {t("range.toNow")}
                  </button>
                </fieldset>
                <Ruler earliest={earliest} now={now} from={preview.from} to={preview.to} />
                <div className="tr-window mono muted">{t("range.window", { from: minDate, to: maxDate, days: meta.data?.dataWindow.historyDays ?? 30 })}</div>
                <div className={clsx("tr-err", err && "show")} role="status" aria-live="polite">
                  {err ?? " "}
                </div>
                <div className="tr-acts">
                  {!tr.isDefault ? (
                    <button type="button" className="btn sm" onClick={() => pick({ kind: "preset", preset: "today" })}>
                      <RotateCcw aria-hidden />
                      {t("range.reset")}
                    </button>
                  ) : null}
                  <button type="submit" className="btn sm primary" disabled={!!err}>
                    <Check aria-hidden />
                    {t("range.apply")}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
