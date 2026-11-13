"use client";
/**
 * Market Brief — "brief conditions": removable chips for every active filter (URL state) and a
 * disclosure panel with every R4 facet (data columns + issue-level conditions, search, min score).
 * Any change regenerates the whole brief (all hooks are keyed on the same filters).
 */
import clsx from "clsx";
import { ChevronDown, Loader2, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import type { IssueFacetKey, IssueFacets } from "@/lib/types";
import { ISSUE_COLUMNS, ISSUE_LEVEL_FILTERS, type IssueFiltersApi, type IssueFormat, type IssueListFilter } from "../issues-shared";

const ISSUE_KEYS: IssueListFilter[] = [...ISSUE_LEVEL_FILTERS];
const MIN_SCORES = [null, 30, 45, 60] as const;

export function FilterBar({ f, facets, fx, regenerating }: { f: IssueFiltersApi; facets: IssueFacets | undefined; fx: IssueFormat; regenerating: boolean }) {
  const t = useT("issuesB");
  const s = useT("issues");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(f.values.q ?? "");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // keep the search box in sync with back/forward navigation
  const urlQ = f.values.q ?? "";
  const [seenQ, setSeenQ] = useState(urlQ);
  if (seenQ !== urlQ) {
    setSeenQ(urlQ);
    setQ(urlQ);
  }
  // debounce typing into ?q=
  useEffect(() => {
    if (q === urlQ) return;
    const id = setTimeout(() => f.set({ q: q.trim() || null }), 350);
    return () => clearTimeout(id);
  }, [q, urlQ, f]);

  const chips: { k: IssueListFilter | "q" | "min_score"; v: string; label: string }[] = [];
  for (const k of [...ISSUE_COLUMNS, ...ISSUE_KEYS]) for (const v of f.values[k]) chips.push({ k, v, label: `${s.dynamic(`column.${k}`, undefined, k)}: ${fx.value(k, v)}` });
  if (f.values.q) chips.push({ k: "q", v: f.values.q, label: `${t("filters.searchLabel")}: “${f.values.q}”` });
  if (f.values.min_score != null) chips.push({ k: "min_score", v: String(f.values.min_score), label: `${s("filters.minScore")} ≥ ${f.values.min_score}` });

  const remove = (c: (typeof chips)[number]) => {
    if (c.k === "q") f.set({ q: null });
    else if (c.k === "min_score") f.set({ min_score: null });
    else f.toggle(c.k, c.v);
  };

  const group = (k: IssueFacetKey) => {
    const vals = facets?.facets[k] ?? [];
    const sel = f.values[k as IssueListFilter];
    // keep selected values visible even if their count dropped to 0
    const all = [...vals, ...sel.filter((v) => !vals.some((x) => x.value === v)).map((value) => ({ value, count: 0 }))];
    if (!all.length) return null;
    const lim = expanded[k] ? all.length : 8;
    return (
      <fieldset key={k} className="issb-facet">
        <legend>{s.dynamic(`column.${k}`, undefined, k)}</legend>
        <div className="issb-facet-vals">
          {all.slice(0, lim).map((x) => {
            const on = sel.includes(x.value);
            return (
              <button key={x.value} type="button" className={clsx("issb-fchip", on && "on")} aria-pressed={on} onClick={() => f.toggle(k as IssueListFilter, x.value)}>
                <span>{fx.value(k, x.value)}</span>
                <small>{x.count}</small>
              </button>
            );
          })}
          {all.length > lim ? (
            <button type="button" className="issb-fchip more" onClick={() => setExpanded((e) => ({ ...e, [k]: true }))}>
              {t("filters.showAll", { n: all.length })}
            </button>
          ) : null}
        </div>
      </fieldset>
    );
  };

  return (
    <div className="issb-conds" data-open={open || undefined}>
      <div className="issb-conds-row">
        <button type="button" className="btn sm issb-conds-btn" aria-expanded={open} aria-controls="issb-conds-panel" onClick={() => setOpen((o) => !o)}>
          <SlidersHorizontal aria-hidden />
          {t("filters.title")}
          {f.activeCount ? <span className="issb-count">{f.activeCount}</span> : null}
          <ChevronDown aria-hidden className="issb-chev" />
        </button>
        <ul className="issb-chips" aria-label={t("filters.title")}>
          {chips.length ? (
            chips.map((c) => (
              <li key={`${c.k}:${c.v}`}>
                <button type="button" className="issb-chip" onClick={() => remove(c)} title={s("filters.reset")}>
                  {c.label}
                  <X aria-hidden />
                </button>
              </li>
            ))
          ) : (
            <li className="issb-chips-none">{t("filters.none")}</li>
          )}
        </ul>
        {chips.length ? (
          <button type="button" className="btn ghost sm" onClick={() => f.reset()}>
            <RotateCcw aria-hidden />
            {t("filters.clearAll")}
          </button>
        ) : null}
        <span className="issb-regen" aria-live="polite" data-on={regenerating || undefined}>
          {regenerating ? (
            <>
              <Loader2 aria-hidden className="issb-spin" />
              {t("filters.regenerating")}
            </>
          ) : (
            t("filters.hint")
          )}
        </span>
      </div>
      {open ? (
        <div id="issb-conds-panel" className="issb-conds-panel">
          <div className="issb-conds-top">
            <label className="issb-search">
              <Search aria-hidden />
              <input className="in" value={q} placeholder={s("filters.search")} aria-label={s("filters.search")} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="issb-minscore">
              <span>{s("filters.minScore")}</span>
              <div className="seg" role="group" aria-label={s("filters.minScore")}>
                {MIN_SCORES.map((m) => (
                  <button key={String(m)} type="button" aria-pressed={f.values.min_score === m} onClick={() => f.set({ min_score: m })}>
                    {m == null ? t("filters.minScoreAny") : `≥${m}`}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="btn sm" onClick={() => setOpen(false)}>
              {t("filters.close")}
            </button>
          </div>
          <div className="issb-conds-grid">
            <div>
              <h3>{t("filters.issueLevel")}</h3>
              {ISSUE_KEYS.map((k) => group(k))}
            </div>
            <div>
              <h3>{t("filters.rowLevel")}</h3>
              <div className="issb-conds-cols">{ISSUE_COLUMNS.map((k) => group(k))}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
