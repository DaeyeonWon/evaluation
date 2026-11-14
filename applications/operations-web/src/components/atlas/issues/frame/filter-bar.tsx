"use client";
/**
 * Issue Report frame — the UNIFIED FilterBar, driven by the dimension table in issues-shared/dims.ts.
 *
 *   desktop:  [필터] primary dim chips (dropdowns with FAIL count · FAIL rate · Δ) … [필터 더보기] [search]
 *             └ "더보기" row: the other list dims + Must-handle + min score
 *             └ active-filter chips + 모두 지우기
 *   ≤ 720px:  [필터 (n)] button + search; the button opens a bottom sheet with every dim as a collapsible list.
 *
 * Every control writes the shared URL state (useIssueFilters), so every view re-queries. Views must not
 * render their own filter UI.
 */
import { SEVERITY_BANDS } from "@/lib/severity";
import clsx from "clsx";
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { IssueColumnStat } from "@/lib/types";
import {
  ISSUE_DIMS,
  ISSUE_DIM_IDS,
  ISSUE_STATUS_ORDER,
  MORE_DIMS,
  PRIMARY_DIMS,
  useDimLabel,
  useIssueFacets,
  useIssueFormat,
  useIssueSummary,
  type IssueDimId,
  type IssueFacetValueMerge,
  type IssueFiltersApi,
  type IssueListFilter,
} from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";

const MIN_SCORES = [null, ...SEVERITY_BANDS.map((b) => b.at)] as const;
const SEV_ORDER = ["P0", "P1", "P2", "P3"];

type Row = { value: string; count: number; fail_rate: number | null; delta: number | null; issues: number | null };
type Source = { rows: (dim: IssueDimId) => Row[]; loading: boolean };

/** facet values (+ summary.columns stats as a fallback for fail rate / delta), selected values always kept */
function useSource(f: IssueFiltersApi): Source {
  const fac = useIssueFacets(f);
  const sum = useIssueSummary(f);
  return useMemo(() => {
    const facets = (fac.data?.facets ?? {}) as unknown as Record<string, IssueFacetValueMerge[] | undefined>;
    const cols = (sum.data?.columns ?? {}) as unknown as Record<string, IssueColumnStat[] | undefined>;
    const rows = (dim: IssueDimId): Row[] => {
      const m = ISSUE_DIMS[dim];
      if (m.kind !== "list") return [];
      const stats = new Map((cols[m.param] ?? []).map((s) => [s.value, s]));
      const vals = facets[m.param] ?? [];
      const sel = f.values[m.param as IssueListFilter] ?? [];
      let out: Row[] = vals.map((v) => {
        const st = stats.get(v.value);
        return { value: v.value, count: v.count, fail_rate: v.fail_rate ?? st?.fail_rate ?? null, delta: v.delta ?? st?.delta ?? null, issues: v.issues ?? st?.issues ?? null };
      });
      for (const v of sel) if (!out.some((r) => r.value === v)) out.push({ value: v, count: 0, fail_rate: null, delta: null, issues: null });
      if (dim === "severity") out = [...out].sort((a, b) => SEV_ORDER.indexOf(a.value) - SEV_ORDER.indexOf(b.value));
      if (dim === "status") out = [...out].sort((a, b) => ISSUE_STATUS_ORDER.indexOf(a.value as never) - ISSUE_STATUS_ORDER.indexOf(b.value as never));
      return out;
    };
    return { rows, loading: !fac.data };
  }, [fac.data, sum.data, f.values]);
}

function Delta({ d }: { d: number | null }) {
  const fx = useIssueFormat();
  if (d == null) return <span className="isf-d muted">—</span>;
  return (
    <span className="isf-d" data-dir={d > 0.5 ? "up" : d < -0.5 ? "down" : "flat"}>
      {d > 0.5 ? "▲" : d < -0.5 ? "▼" : "•"}
      {fx.pp(d)}
    </span>
  );
}

function ValueLabel({ dim, v }: { dim: IssueDimId; v: string }) {
  const dl = useDimLabel();
  const label = dl.value(dim, v);
  if (dim === "severity")
    return (
      <span className="isf-vl">
        <span className="iss-sev" data-sev={v}>
          {v}
        </span>
        {label !== v ? <span className="isf-vl-t">{label.replace(new RegExp(`^${v}\\s*`), "")}</span> : null}
      </span>
    );
  return <span className="isf-vl isf-vl-t">{label}</span>;
}

/** checkbox list of one dim's values with FAIL count, FAIL rate and Δ vs baseline */
function ValueList({ dim, f, src, query = "" }: { dim: IssueDimId; f: IssueFiltersApi; src: Source; query?: string }) {
  const t = useT("issues");
  const fm = useFmt();
  const fx = useIssueFormat();
  const dl = useDimLabel();
  const m = ISSUE_DIMS[dim];
  const all = src.rows(dim);
  const q = query.trim().toLowerCase();
  const rows = q ? all.filter((r) => (r.value + " " + dl.value(dim, r.value)).toLowerCase().includes(q)) : all;
  const max = Math.max(1, ...all.map((r) => r.count));
  const sel = f.values[m.param as IssueListFilter] ?? [];
  if (src.loading && !all.length) return <p className="isf-empty muted">…</p>;
  return (
    <ul className="isf-vals" role="group" aria-label={dl.dim(dim)}>
      {rows.map((r) => {
        const on = sel.includes(r.value);
        return (
          <li key={r.value}>
            <button
              type="button"
              className={clsx("isf-val", on && "on")}
              aria-pressed={on}
              onClick={() => f.toggle(m.param as IssueListFilter, r.value)}
              style={{ ["--w" as string]: `${(r.count / max) * 100}%` } as CSSProperties}
            >
              <span className="isf-box" aria-hidden>
                {on ? <Check /> : null}
              </span>
              <ValueLabel dim={dim} v={r.value} />
              <span className="isf-n mono">{fm.number(r.count)}</span>
              <span className="isf-r mono">{r.fail_rate != null ? fx.pct(r.fail_rate) : ""}</span>
              <Delta d={r.delta} />
            </button>
          </li>
        );
      })}
      {!rows.length ? <li className="isf-empty muted">{t("frame.filter.noValues")}</li> : null}
    </ul>
  );
}

function DimMenu({ dim, f, src }: { dim: IssueDimId; f: IssueFiltersApi; src: Source }) {
  const t = useT("issues");
  const dl = useDimLabel();
  const rm = useReducedMotionSafe();
  const id = useId();
  const m = ISSUE_DIMS[dim];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [right, setRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sel = f.values[m.param as IssueListFilter] ?? [];
  const n = src.rows(dim).length;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>(".isf-dim")?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) setRight(ref.current.getBoundingClientRect().left + 340 > window.innerWidth - 16);
    setOpen((o) => !o);
    setQ("");
  };

  return (
    <div className="isf-dimw" ref={ref}>
      <button type="button" className={clsx("isf-dim", sel.length && "on")} aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
        <span className="isf-dim-k">{dl.dim(dim)}</span>
        {sel.length ? <b className="isf-dim-v">{sel.length === 1 ? dl.value(dim, sel[0]) : t("frame.filter.selected", { count: sel.length })}</b> : <span className="isf-dim-all">{t("frame.filter.all")}</span>}
        <ChevronDown aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={id}
            className={clsx("isf-pop", right && "right")}
            role="dialog"
            aria-label={dl.dim(dim)}
            initial={rm ? false : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={rm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16, ease: [0.2, 0.75, 0.2, 1] }}
          >
            <div className="isf-pop-head">
              <b>{dl.dim(dim)}</b>
              <span className="mono muted">{m.level === "row" ? t("frame.filter.countFails") : t("frame.filter.countIssues")}</span>
            </div>
            {n > 8 ? <input className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("frame.filter.findValue")} aria-label={t("frame.filter.findValue")} autoFocus /> : null}
            <ValueList dim={dim} f={f} src={src} query={q} />
            <div className="isf-pop-foot">
              <button type="button" className="btn sm ghost" disabled={!sel.length} onClick={() => f.only(m.param as IssueListFilter, null)}>
                {t("frame.filter.clear")}
              </button>
              <button type="button" className="btn sm" onClick={() => setOpen(false)}>
                {t("frame.filter.done")}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SearchBox({ f }: { f: IssueFiltersApi }) {
  const t = useT("issues");
  const cur = f.values.q ?? "";
  const [v, setV] = useState(cur);
  const [prev, setPrev] = useState(cur);
  if (prev !== cur) {
    setPrev(cur);
    setV(cur);
  }
  const { set } = f;
  useEffect(() => {
    if (v === cur) return;
    const h = setTimeout(() => set({ q: v || null }), 350);
    return () => clearTimeout(h);
  }, [v, cur, set]);
  return (
    <label className="isf-search">
      <Search aria-hidden />
      <input className="in" type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={t("frame.filter.search")} aria-label={t("frame.filter.search")} />
    </label>
  );
}

/** Must-handle (true|false) + min score segmented controls */
function Scalars({ f }: { f: IssueFiltersApi }) {
  const t = useT("issues");
  const dl = useDimLabel();
  const mh = f.values.must_handle;
  return (
    <>
      <div className="isf-ctl">
        <span className="isf-ctl-k">{dl.dim("must_handle")}</span>
        <div className="seg" role="group" aria-label={dl.dim("must_handle")}>
          {([null, "true", "false"] as const).map((v) => (
            <button key={String(v)} type="button" aria-pressed={mh === v} onClick={() => f.set({ must_handle: v })}>
              {v == null ? t("frame.filter.any") : dl.value("must_handle", v)}
            </button>
          ))}
        </div>
      </div>
      <div className="isf-ctl">
        <span className="isf-ctl-k">{dl.dim("min_score")}</span>
        <div className="seg" role="group" aria-label={dl.dim("min_score")}>
          {MIN_SCORES.map((m) => (
            <button key={String(m)} type="button" aria-pressed={f.values.min_score === m} onClick={() => f.set({ min_score: m })}>
              {m == null ? t("frame.filter.any") : `≥${m}`}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** removable chips for every active filter + 모두 지우기 */
export function ActiveChips({ f }: { f: IssueFiltersApi }) {
  const t = useT("issues");
  const dl = useDimLabel();
  const rm = useReducedMotionSafe();
  const chips: { key: string; dim: string; label: string; clear: () => void }[] = [];
  for (const d of ISSUE_DIM_IDS) {
    const m = ISSUE_DIMS[d];
    if (m.kind === "list") for (const v of f.values[m.param as IssueListFilter] ?? []) chips.push({ key: `${d}:${v}`, dim: dl.dim(d), label: dl.value(d, v), clear: () => f.toggle(m.param as IssueListFilter, v) });
  }
  if (f.values.must_handle) chips.push({ key: "mh", dim: dl.dim("must_handle"), label: dl.value("must_handle", f.values.must_handle), clear: () => f.set({ must_handle: null }) });
  if (f.values.min_score != null) chips.push({ key: "ms", dim: dl.dim("min_score"), label: `≥ ${f.values.min_score}`, clear: () => f.set({ min_score: null }) });
  if (f.values.q) chips.push({ key: "q", dim: dl.dim("q"), label: `“${f.values.q}”`, clear: () => f.set({ q: null }) });
  if (!chips.length) return null;
  return (
    <div className="isf-chips" aria-label={t("frame.filter.active")}>
      <span className="isf-chips-k mono">{t("frame.filter.active")}</span>
      <ul>
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map((c) => (
            <motion.li
              key={c.key}
              layout={!rm}
              initial={rm ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={rm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18 }}
            >
              <button type="button" className="isf-chip" onClick={c.clear} aria-label={t("frame.filter.remove", { label: `${c.dim} ${c.label}` })}>
                <span className="muted">{c.dim}</span>
                <span className="isf-chip-v">{c.label}</span>
                <X aria-hidden />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
        <li>
          <button type="button" className="isf-clear" onClick={f.reset}>
            {t("frame.filter.clearAll")}
          </button>
        </li>
      </ul>
    </div>
  );
}

/** ≤ 720px: every dim in one collapsible bottom sheet */
function MobileSheet({ f, src, onClose }: { f: IssueFiltersApi; src: Source; onClose: () => void }) {
  const t = useT("issues");
  const dl = useDimLabel();
  const rm = useReducedMotionSafe();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <>
      <motion.div className="isf-scrim" onClick={onClose} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: rm ? 0 : 0.18 }} />
      <motion.div
        className="isf-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("frame.filter.sheet")}
        initial={rm ? false : { y: "100%" }}
        animate={{ y: 0 }}
        exit={rm ? { opacity: 0, transition: { duration: 0 } } : { y: "100%", transition: { duration: 0.2 } }}
        transition={{ duration: 0.28, ease: [0.2, 0.75, 0.2, 1] }}
      >
        <header className="isf-sheet-head">
          <b>{t("frame.filter.sheet")}</b>
          {f.activeCount ? <span className="isf-badge">{f.activeCount}</span> : null}
          <button type="button" className="btn sm ghost" onClick={f.reset} disabled={!f.activeCount}>
            {t("frame.filter.clearAll")}
          </button>
          <button type="button" className="btn sm icon" onClick={onClose} aria-label={t("frame.filter.done")} ref={closeRef}>
            <X aria-hidden />
          </button>
        </header>
        <div className="isf-sheet-body">
          <div className="isf-sheet-scalars">
            <Scalars f={f} />
          </div>
          {[...PRIMARY_DIMS, ...MORE_DIMS]
            .filter((d) => ISSUE_DIMS[d].kind === "list")
            .map((d) => {
              const n = (f.values[ISSUE_DIMS[d].param as IssueListFilter] ?? []).length;
              return (
                <details key={d} className="isf-acc" open={n > 0 || undefined}>
                  <summary>
                    <span>{dl.dim(d)}</span>
                    {n ? <span className="isf-badge">{n}</span> : null}
                    <ChevronDown aria-hidden />
                  </summary>
                  <ValueList dim={d} f={f} src={src} />
                </details>
              );
            })}
        </div>
        <footer className="isf-sheet-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            {t("frame.filter.apply")}
          </button>
        </footer>
      </motion.div>
    </>
  );
}

export function FilterBar({ f }: { f: IssueFiltersApi }) {
  const t = useT("issues");
  const src = useSource(f);
  const moreActive = MORE_DIMS.some((d) => {
    const m = ISSUE_DIMS[d];
    return m.kind === "list" ? (f.values[m.param as IssueListFilter] ?? []).length > 0 : d === "must_handle" ? !!f.values.must_handle : d === "min_score" ? f.values.min_score != null : false;
  });
  const [more, setMore] = useState(moreActive);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  const moreList = MORE_DIMS.filter((d) => ISSUE_DIMS[d].kind === "list");

  return (
    <section className="isf" aria-label={t("frame.filter.title")}>
      <div className="isf-row">
        <span className="isf-label">
          <SlidersHorizontal aria-hidden /> {t("frame.filter.title")}
        </span>
        <button type="button" className="btn sm isf-mob-btn" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-expanded={sheet}>
          <SlidersHorizontal aria-hidden />
          {t("frame.filter.open")}
          {f.activeCount ? <span className="isf-badge">{f.activeCount}</span> : null}
        </button>
        <div className="isf-dims">
          {PRIMARY_DIMS.map((d) => (
            <DimMenu key={d} dim={d} f={f} src={src} />
          ))}
          <button type="button" className={clsx("btn sm ghost isf-more", moreActive && "on")} aria-expanded={more} onClick={() => setMore((m) => !m)}>
            {more ? t("frame.filter.less") : t("frame.filter.more")}
            <ChevronDown aria-hidden data-open={more || undefined} />
          </button>
        </div>
        <SearchBox f={f} />
      </div>
      <AnimatePresence initial={false}>
        {more ? (
          <motion.div className="isf-row isf-row-more" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
            <div className="isf-dims">
              {moreList.map((d) => (
                <DimMenu key={d} dim={d} f={f} src={src} />
              ))}
            </div>
            <Scalars f={f} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <ActiveChips f={f} />
      <AnimatePresence>{sheet ? <MobileSheet key="sheet" f={f} src={src} onClose={closeSheet} /> : null}</AnimatePresence>
    </section>
  );
}
