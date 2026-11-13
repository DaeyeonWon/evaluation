"use client";
/** Triage Deck — left filter rail: issue attributes + every data column with FAIL counts / rates. */
import clsx from "clsx";
import { Check, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { IssueColumn, IssueColumnStat, IssueFacets, IssueSummary } from "@/lib/types";
import { ISSUE_COLUMNS, ISSUE_STATUS_ORDER, type IssueFiltersApi, type IssueFormat, type IssueListFilter } from "../issues-shared";
import { CLS_ICON, STATUS_ICON } from "./card";

const LEVEL = ["severity", "severity_class", "status", "novelty"] as const;
const OPEN_DEFAULT: IssueColumn[] = ["agent_function", "market", "failure_reason"];
const MIN_SCORES = [null, 30, 45, 60] as const;

function Facet({ col, f, fx, facets, stats }: { col: IssueColumn; f: IssueFiltersApi; fx: IssueFormat; facets: IssueFacets | undefined; stats: IssueColumnStat[] | undefined }) {
  const t = useT("issuesA");
  const fm = useFmt();
  const [more, setMore] = useState(false);
  const sel = f.values[col];
  const vals = facets?.facets[col] ?? [];
  const byVal = new Map((stats ?? []).map((s) => [s.value, s]));
  // keep selected values visible even with no FAILs
  const list = [...vals, ...sel.filter((v) => !vals.some((x) => x.value === v)).map((value) => ({ value, count: 0 }))];
  const max = Math.max(1, ...list.map((v) => v.count));
  const shown = more ? list : list.slice(0, 6);
  return (
    <details className="ia-facet" open={OPEN_DEFAULT.includes(col) || sel.length > 0 || undefined}>
      <summary>
        <span>{fx.column(col)}</span>
        {sel.length ? <span className="ia-fc-n">{sel.length}</span> : <span className="mono muted">{list.length}</span>}
        {sel.length ? (
          <button
            type="button"
            className="ia-fc-x"
            aria-label={t("rail.clear", { col: fx.column(col) })}
            onClick={(e) => {
              e.preventDefault();
              f.set({ [col]: [] });
            }}
          >
            <X aria-hidden />
          </button>
        ) : null}
      </summary>
      <ul>
        {shown.map((v) => {
          const st = byVal.get(v.value);
          const on = sel.includes(v.value);
          return (
            <li key={v.value}>
              <button type="button" className={clsx("ia-fv", on && "on")} aria-pressed={on} onClick={() => f.toggle(col, v.value)} title={st ? `${fx.pct(st.fail_rate)} · ${fx.pp(st.delta)} · ${st.issues}` : undefined}>
                <span className="ia-fv-box" aria-hidden>
                  {on ? <Check /> : null}
                </span>
                <span className="ia-fv-l">{fx.value(col, v.value)}</span>
                <span className="ia-fv-bar" aria-hidden style={{ ["--w" as string]: `${(v.count / max) * 100}%` } as CSSProperties} />
                <span className="ia-fv-n mono">{fm.number(v.count)}</span>
                <span className="ia-fv-r mono">
                  {st ? fx.pct(st.fail_rate) : "—"}
                  {st?.delta != null ? (
                    <i data-dir={st.delta > 0.5 ? "up" : st.delta < -0.5 ? "down" : "flat"}>{fx.pp(st.delta)}</i>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {list.length > 6 ? (
        <button type="button" className="ia-fc-more" onClick={() => setMore((m) => !m)}>
          {more ? t("rail.less") : t("rail.more", { n: list.length - 6 })}
        </button>
      ) : null}
    </details>
  );
}

export function Rail({ f, fx, facets, sum, open, onClose }: { f: IssueFiltersApi; fx: IssueFormat; facets: IssueFacets | undefined; sum: IssueSummary | undefined; open: boolean; onClose: () => void }) {
  const t = useT("issuesA");
  const s = useT("issues");
  const [q, setQ] = useState(f.values.q ?? "");
  const urlQ = f.values.q ?? "";
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }
  const { set } = f;
  useEffect(() => {
    if (q === urlQ) return;
    const h = setTimeout(() => set({ q: q || null }), 300);
    return () => clearTimeout(h);
  }, [q, urlQ, set]);
  const levelValue = (k: (typeof LEVEL)[number], v: string) => {
    if (k === "severity") return <span className="iss-sev" data-sev={v}>{v}</span>;
    if (k === "severity_class") return <span className="ia-cls" data-cls={v}>{CLS_ICON[v as keyof typeof CLS_ICON]}{fx.value(k, v)}</span>;
    if (k === "status") return <span className="ia-st" data-st={v}>{STATUS_ICON[v as keyof typeof STATUS_ICON]}{fx.value(k, v)}</span>;
    return <span className={clsx("ia-nv", v === "new" && "ia-new")}>{fx.value(k, v)}</span>;
  };
  const order = (k: (typeof LEVEL)[number]) => {
    const vals = facets?.facets[k] ?? [];
    if (k === "status") return ISSUE_STATUS_ORDER.map((st) => vals.find((v) => v.value === st) ?? { value: st, count: 0 });
    return vals;
  };
  return (
    <aside className={clsx("ia-rail", open && "open")} aria-label={t("rail.title")}>
      <div className="ia-rail-head">
        <b>{t("rail.title")}</b>
        {f.activeCount ? <span className="ia-fc-n">{f.activeCount}</span> : null}
        <button type="button" className="btn sm ghost" onClick={f.reset} disabled={!f.activeCount}>
          <RotateCcw aria-hidden />
          {s("filters.reset")}
        </button>
        <button type="button" className="btn icon sm ia-rail-close" onClick={onClose} aria-label={t("rail.close")}>
          <X aria-hidden />
        </button>
      </div>
      <label className="ia-search">
        <Search aria-hidden />
        <input className="in" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={s("filters.search")} aria-label={s("filters.search")} />
      </label>
      <div className="ia-rail-grp">
        <span className="ia-rail-h">{t("rail.minScore")}</span>
        <div className="seg ia-minscore" role="group" aria-label={t("rail.minScore")}>
          {MIN_SCORES.map((m) => (
            <button key={String(m)} type="button" aria-pressed={f.values.min_score === m} onClick={() => f.set({ min_score: m })}>
              {m == null ? t("rail.any") : `≥${m}`}
            </button>
          ))}
        </div>
      </div>
      <div className="ia-rail-grp">
        <span className="ia-rail-h">{t("rail.issueLevel")}</span>
        {LEVEL.map((k) => (
          <div key={k} className="ia-lvl" role="group" aria-label={fx.column(k)}>
            <span className="ia-lvl-k">{fx.column(k)}</span>
            <div className="ia-lvl-v">
              {order(k).map((v) => {
                const on = f.values[k as IssueListFilter].includes(v.value);
                return (
                  <button key={v.value} type="button" className={clsx("ia-lv", on && "on")} aria-pressed={on} onClick={() => f.toggle(k, v.value)} disabled={!v.count && !on}>
                    {levelValue(k, v.value)}
                    <span className="mono">{v.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="ia-rail-grp">
        <span className="ia-rail-h">{t("rail.columns")}</span>
        <span className="ia-rail-hint">{t("rail.columnsHint")}</span>
        {ISSUE_COLUMNS.map((c) => (
          <Facet key={c} col={c} f={f} fx={fx} facets={facets} stats={sum?.columns[c]} />
        ))}
      </div>
    </aside>
  );
}
