"use client";
/**
 * Signal Lab — filter bar (R4). Facet menus for every data column + the issue-level filters, search,
 * minimum score, grouping, active chips and the baseline readout. Everything writes the shared URL state.
 */
import clsx from "clsx";
import { Check, ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { capsuleLabel, deviceLabel, languageName } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import type { IssueBaseline, IssueFacets } from "@/lib/types";
import { ISSUE_COLUMNS, ISSUE_LEVEL_FILTERS, useIssueFormat, type IssueFiltersApi, type IssueListFilter } from "../issues-shared";

const PRIMARY: IssueListFilter[] = ["agent_function", "market", "language", "device", "model_version", "severity", "severity_class", "status", "novelty"];
const SECONDARY: IssueListFilter[] = ["capsule", "intent", "failure_reason", "pipeline", "pipeline_version", "os_version", "one_ui_version"];

/** human label for any facet value */
export function useValueLabel() {
  const fx = useIssueFormat();
  const locale = useLocale();
  return useMemo(
    () => (col: string, v: string) => {
      if (col === "language") return languageName(v, locale);
      if (col === "device") return deviceLabel(v, locale);
      if (col === "capsule") return capsuleLabel(v, locale);
      if (col === "market") return `${v} · ${fx.market(v)}`;
      return fx.value(col, v);
    },
    [fx, locale],
  );
}

function FacetMenu({ col, f, facets }: { col: IssueListFilter; f: IssueFiltersApi; facets: IssueFacets | undefined }) {
  const t = useT("issuesC");
  const fx = useIssueFormat();
  const label = useValueLabel();
  const fm = useFmt();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sel = f.values[col];
  const isRowCol = (ISSUE_COLUMNS as string[]).includes(col);
  const vals = facets?.facets[col] ?? [];
  const shown = q ? vals.filter((v) => (v.value + " " + label(col, v.value)).toLowerCase().includes(q.toLowerCase())) : vals;
  const max = Math.max(1, ...vals.map((v) => v.count));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAlignRight(r.left + 290 > window.innerWidth - 12);
    }
    setOpen((o) => !o);
  };

  return (
    <div className="lab-facet" ref={ref}>
      <button type="button" className={clsx("lab-facet-btn", sel.length && "on")} aria-expanded={open} aria-haspopup="true" onClick={toggleOpen}>
        <span className="lab-facet-k">{fx.column(col)}</span>
        {sel.length ? <b className="lab-facet-n">{sel.length === 1 ? label(col, sel[0]) : sel.length}</b> : <span className="lab-facet-all">{t("filter.all")}</span>}
        <ChevronDown aria-hidden />
      </button>
      {open ? (
        <div className={clsx("lab-pop", alignRight && "right")} role="dialog" aria-label={fx.column(col)}>
          <div className="lab-pop-head">
            <b>{fx.column(col)}</b>
            <span className="muted mono">{isRowCol ? t("filter.countFails") : t("filter.countIssues")}</span>
          </div>
          {vals.length > 8 ? <input className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filter.findValue")} aria-label={t("filter.findValue")} autoFocus /> : null}
          <ul className="lab-pop-list">
            {shown.map((v) => {
              const on = sel.includes(v.value);
              return (
                <li key={v.value}>
                  <button type="button" aria-pressed={on} onClick={() => f.toggle(col, v.value)}>
                    <span className="lab-check">{on ? <Check aria-hidden /> : null}</span>
                    {col === "severity" ? <span className="iss-sev" data-sev={v.value}>{v.value}</span> : null}
                    <span className="lab-pop-v">{label(col, v.value)}</span>
                    <span className="lab-pop-bar" style={{ ["--w" as string]: `${(v.count / max) * 100}%` }} />
                    <span className="mono lab-pop-c">{fm.number(v.count)}</span>
                  </button>
                </li>
              );
            })}
            {!shown.length ? <li className="muted lab-pop-empty">{t("filter.noValues")}</li> : null}
          </ul>
          <div className="lab-pop-foot">
            <button type="button" className="btn sm ghost" disabled={!sel.length} onClick={() => f.only(col, null)}>
              {t("filter.clear")}
            </button>
            <button type="button" className="btn sm" onClick={() => setOpen(false)}>
              {t("filter.done")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SearchBox({ f }: { f: IssueFiltersApi }) {
  const s = useT("issues");
  const [v, setV] = useState(f.values.q ?? "");
  const cur = f.values.q ?? "";
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
    <label className="lab-search">
      <Search aria-hidden />
      <input className="in" value={v} onChange={(e) => setV(e.target.value)} placeholder={s("filters.search")} aria-label={s("filters.search")} />
    </label>
  );
}

export function BaselineTag({ b }: { b: IssueBaseline | undefined }) {
  const s = useT("issues");
  const t = useT("issuesC");
  const fm = useFmt();
  if (!b) return null;
  return (
    <span className={clsx("lab-base", !b.sufficient && "warn")} title={b.sufficient ? undefined : s("baseline.insufficient")}>
      <span className="lab-base-k">{s("baseline.label")}</span>
      <span>{s(`baseline.mode.${b.mode}`)}</span>
      <span className="mono">
        {fm.dateLabel(b.from)} – {fm.dateLabel(b.to)} · {t("filter.coverage", { pct: Math.round(b.coverage * 100) })}
      </span>
    </span>
  );
}

export function FilterBar({ f, facets, baseline }: { f: IssueFiltersApi; facets: IssueFacets | undefined; baseline: IssueBaseline | undefined }) {
  const t = useT("issuesC");
  const s = useT("issues");
  const fx = useIssueFormat();
  const label = useValueLabel();
  const [more, setMore] = useState(() => SECONDARY.some((c) => f.values[c].length));
  const chips: { col: IssueListFilter; v: string }[] = [];
  for (const c of [...ISSUE_COLUMNS, ...ISSUE_LEVEL_FILTERS]) for (const v of f.values[c]) chips.push({ col: c, v });
  const minScores = [null, 30, 45, 60] as const;

  return (
    <section className="lab-filters" aria-label={s("filters.title")}>
      <div className="lab-frow">
        <span className="lab-flabel">
          <SlidersHorizontal aria-hidden /> {s("filters.title")}
        </span>
        {PRIMARY.map((c) => (
          <FacetMenu key={c} col={c} f={f} facets={facets} />
        ))}
        {more ? SECONDARY.map((c) => <FacetMenu key={c} col={c} f={f} facets={facets} />) : null}
        <button type="button" className="btn sm ghost lab-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? t("filter.less") : t("filter.more", { count: SECONDARY.length })}
        </button>
      </div>
      <div className="lab-frow lab-frow-2">
        <SearchBox f={f} />
        <div className="lab-ctl">
          <span className="lab-ctl-k">{s("filters.minScore")}</span>
          <div className="seg" role="group" aria-label={s("filters.minScore")}>
            {minScores.map((m) => (
              <button key={String(m)} type="button" aria-pressed={f.values.min_score === m} onClick={() => f.set({ min_score: m })}>
                {m == null ? s("filters.all") : m === 30 ? "P2+" : m === 45 ? "P1+" : "P0"}
              </button>
            ))}
          </div>
        </div>
        <div className="lab-ctl">
          <span className="lab-ctl-k">{s("filters.groupBy")}</span>
          <div className="seg" role="group" aria-label={s("filters.groupBy")}>
            <button type="button" aria-pressed={f.values.group_by === "signature"} title={s("filters.groupBySignature")} onClick={() => f.set({ group_by: "signature" })}>
              {t("filter.signature")}
            </button>
            <button type="button" aria-pressed={f.values.group_by === "pattern"} title={s("filters.groupByPattern")} onClick={() => f.set({ group_by: "pattern" })}>
              {t("filter.pattern")}
            </button>
          </div>
        </div>
        <BaselineTag b={baseline} />
      </div>
      {chips.length || f.values.q || f.values.min_score != null ? (
        <div className="lab-chips" aria-live="polite">
          {chips.map(({ col, v }) => (
            <button key={col + v} type="button" className="lab-chip" onClick={() => f.toggle(col, v)} aria-label={t("filter.remove", { label: `${fx.column(col)} ${label(col, v)}` })}>
              <span className="muted">{fx.column(col)}</span> {label(col, v)} <X aria-hidden />
            </button>
          ))}
          {f.values.q ? (
            <button type="button" className="lab-chip" onClick={() => f.set({ q: null })}>
              <span className="muted">q</span> “{f.values.q}” <X aria-hidden />
            </button>
          ) : null}
          {f.values.min_score != null ? (
            <button type="button" className="lab-chip" onClick={() => f.set({ min_score: null })}>
              <span className="muted">{s("filters.minScore")}</span> ≥ {f.values.min_score} <X aria-hidden />
            </button>
          ) : null}
          <button type="button" className="btn sm ghost" onClick={f.reset}>
            <RotateCcw aria-hidden /> {s("filters.reset")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
