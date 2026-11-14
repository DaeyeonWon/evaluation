"use client";
/**
 * Analysis — free-axis heatmap over any two MATRIX_DIMS (GET /issues/matrix via useIssueMatrix).
 * Rows = Y, columns = X; metric = fail_rate | fail_count | delta | issue_count.
 * Scale: sequential (one hue) for rates and counts, diverging (worse ↔ neutral ↔ better) for delta,
 * from the response's own domain (low-n cells, total < 10, do not stretch the rate scale).
 * Margins carry the X / Y totals of the same metric. Values past the server cap fold into "Other".
 *
 * Linked view: the matrix request leaves out its OWN two dims from the URL filters (classic
 * cross-filter), so a FilterBar `division=TV` still shows every division with TV ringed. A clicked
 * cell is a LOCAL selection (`hm=<x>|<y>`): it narrows the bubble, treemap, patterns and ledger, and
 * offers "Triage로 보기" with both values (drill).
 */
import clsx from "clsx";
import { ArrowLeftRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { IssueQuery } from "@/lib/client";
import type { IssueDimMatrixCell, IssueDimStat, IssueText } from "@/lib/types";
import { ISSUE_DIMS, MATRIX_DIMS, MATRIX_METRICS, useDimLabel, useIssueFacets, useIssueFormat, useIssueMatrix, type IssueFiltersApi, type MatrixDim, type MatrixMetric } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { HEAT_PRESETS, OTHER, deltaDir, divFill, divInk, seqFill, seqInk, type CellSel } from "./lab";

function without(q: IssueQuery, keys: string[]): IssueQuery {
  const o = { ...q } as Record<string, unknown>;
  for (const k of keys) delete o[k];
  return o as IssueQuery;
}

const LOW_N = 10;
/** row dims split PASS rows too, so a small `total` really is a small sample */
const isRowDim = (d: MatrixDim) => ISSUE_DIMS[d].level === "row";

interface Hover {
  c: IssueDimMatrixCell;
  x: number;
  y: number;
  /** too close to the top of the scroll box: show the tip under the cell */
  below: boolean;
}

export interface HeatAxes {
  x: MatrixDim;
  y: MatrixDim;
  metric: MatrixMetric;
}

/** the metric's value for a margin total */
function statValue(st: IssueDimStat | undefined, m: MatrixMetric): number | null {
  if (!st) return null;
  return m === "fail_rate" ? st.fail_rate : m === "fail_count" ? st.fails : m === "delta" ? st.delta : st.issues;
}

export function Heatmap({
  f,
  axes,
  setAxes,
  sel,
  onCell,
}: {
  f: IssueFiltersApi;
  axes: HeatAxes;
  setAxes: (a: Partial<HeatAxes>) => void;
  sel: CellSel | null;
  /** select a cell (null clears); `xs`/`ys` = concrete values behind it */
  onCell: (c: { xv: string; yv: string; xs: string[]; ys: string[] } | null) => void;
}) {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const fx = useIssueFormat();
  const dl = useDimLabel();
  const fm = useFmt();
  const { x, y, metric } = axes;
  const xParam = ISSUE_DIMS[x].param;
  const yParam = ISSUE_DIMS[y].param;
  const scoped = useMemo(() => ({ ...f, filterQuery: without(f.filterQuery, [xParam, yParam]) }), [f, xParam, yParam]);
  const mx = useIssueMatrix(scoped, { x, y, metric });
  const m = mx.data;
  const [hover, setHover] = useState<Hover | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const label = (dim: MatrixDim, v: string, lb: IssueText | null | undefined) => (v === OTHER ? s("dimValue.other") : lb ? fx.text(lb) : dl.value(dim, v));
  /** short header text (columns are narrow) */
  const short = (dim: MatrixDim, v: string, lb: IssueText | null | undefined) => {
    if (v === OTHER) return s("dimValue.other");
    if (dim === "language") return v.toUpperCase();
    if (dim === "market") return v;
    if (dim === "model_version") return v.replace("bixby-nlu-", "");
    return label(dim, v, lb);
  };
  const filX = f.values[xParam as keyof typeof f.values] as string[] | undefined;
  const filY = f.values[yParam as keyof typeof f.values] as string[] | undefined;
  const degenerate = (x === "failure_reason" || y === "failure_reason") && (metric === "fail_rate" || metric === "delta");
  const lowApplies = isRowDim(x) && isRowDim(y);

  const grid = useMemo(() => {
    if (!m) return null;
    const by = new Map(m.cells.map((c) => [c.x + "|" + c.y, c]));
    const solid = m.cells.filter((c) => c.value != null && (!lowApplies || c.total >= LOW_N || metric === "fail_count" || metric === "issue_count"));
    const vals = (solid.length ? solid : m.cells.filter((c) => c.value != null)).map((c) => c.value!);
    const div = metric === "delta";
    const max = div ? Math.max(1, ...vals.map(Math.abs)) : Math.max(metric === "fail_rate" ? 0.5 : 1, ...vals);
    const xt = new Map(m.x_totals.map((st) => [st.value, st]));
    const yt = new Map(m.y_totals.map((st) => [st.value, st]));
    const rows = m.y_values.map((v, i) => ({ v, lb: m.y_labels[i] }));
    const cols = m.x_values.map((v, i) => ({ v, lb: m.x_labels[i] }));
    const marginMax = Math.max(1, ...m.y_totals.map((st) => Math.abs(statValue(st, metric) ?? 0)));
    return { by, max, div, rows, cols, xt, yt, marginMax };
  }, [m, metric, lowApplies]);

  /** "__other__" → every value of the dim not named on the axis (the tail comes from the facets the frame already loads) */
  const fac = useIssueFacets(scoped);
  const expand = (dim: MatrixDim, v: string, shown: string[]) => {
    if (v !== OTHER) return [v];
    const all = (fac.data?.facets as Record<string, { value: string }[] | undefined> | undefined)?.[ISSUE_DIMS[dim].param] ?? [];
    return all.map((o) => o.value).filter((x) => !shown.includes(x));
  };

  const fillOf = (v: number | null) => (grid ? (grid.div ? divFill(v, grid.max) : seqFill(v, grid.max)) : "transparent");
  const inkOf = (v: number | null) => (grid ? (grid.div ? divInk(v, grid.max) : seqInk(v, grid.max)) : "var(--ink)");
  const fmtV = (v: number | null, compact = true) => {
    if (v == null) return "—";
    if (metric === "fail_rate") return compact ? v.toFixed(v >= 10 || v === 0 ? 0 : 1) : fx.pct(v);
    if (metric === "delta") return compact ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1)}` : fx.pp(v);
    return fm.number(v);
  };
  const legendMax = () => (grid ? (metric === "fail_rate" ? `${Math.round(grid.max)}%` : metric === "delta" ? fx.pp(grid.max) : fm.number(grid.max)) : "");

  const clickCell = (c: IssueDimMatrixCell) => {
    if (sel && sel.xv === c.x && sel.yv === c.y) return onCell(null);
    const xs = m!.x_values;
    const ys = m!.y_values;
    onCell({ xv: c.x, yv: c.y, xs: expand(x, c.x, xs), ys: expand(y, c.y, ys) });
  };
  const onEnter = (e: React.MouseEvent | React.FocusEvent, c: IssueDimMatrixCell) => {
    const host = wrap.current?.getBoundingClientRect();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!host || !wrap.current) return;
    const top = r.top - host.top + wrap.current.scrollTop;
    const below = r.top - host.top < 150;
    setHover({ c, x: Math.max(130, Math.min(r.left - host.left + wrap.current.scrollLeft + r.width / 2, wrap.current.scrollLeft + host.width - 130)), y: below ? top + r.height : top, below });
  };
  const presetOn = HEAT_PRESETS.find((p) => p.x === x && p.y === y)?.id ?? null;
  const lbX = (v: string) => (m ? label(x, v, m.x_labels[m.x_values.indexOf(v)]) : v);
  const lbY = (v: string) => (m ? label(y, v, m.y_labels[m.y_values.indexOf(v)]) : v);

  return (
    <div className="lab-hm">
      <div className="lab-hm-presets" role="group" aria-label={t("heat.presets")}>
        {HEAT_PRESETS.map((p) => (
          <button key={p.id} type="button" className="lab-preset" aria-pressed={presetOn === p.id} onClick={() => setAxes({ x: p.x, y: p.y })}>
            {t(`heat.preset.${p.id}`)}
          </button>
        ))}
      </div>
      <div className="lab-viewbar lab-hm-ctl">
        <label className="lab-axis">
          <span>{t("heat.rows")}</span>
          <select className="in" value={y} onChange={(e) => setAxes({ y: e.target.value as MatrixDim })} aria-label={t("heat.rowsAria")}>
            {MATRIX_DIMS.map((d) => (
              <option key={d} value={d} disabled={d === x}>
                {dl.dim(d)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn icon sm ghost lab-swap" onClick={() => setAxes({ x: y, y: x })} aria-label={t("heat.swap")} title={t("heat.swap")}>
          <ArrowLeftRight aria-hidden />
        </button>
        <label className="lab-axis">
          <span>{t("heat.cols")}</span>
          <select className="in" value={x} onChange={(e) => setAxes({ x: e.target.value as MatrixDim })} aria-label={t("heat.colsAria")}>
            {MATRIX_DIMS.map((d) => (
              <option key={d} value={d} disabled={d === y}>
                {dl.dim(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="seg lab-metric" role="group" aria-label={t("heat.metric")}>
          {MATRIX_METRICS.map((mt) => (
            <button key={mt} type="button" aria-pressed={metric === mt} onClick={() => setAxes({ metric: mt })}>
              {t(`heat.m.${mt}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-hm-legend">
        {grid?.div ? (
          <>
            <span className="mono">−{legendMax().replace(/^[+−±]/, "")}</span>
            <span className="lab-hm-ramp div" aria-hidden />
            <span className="mono">+{legendMax().replace(/^[+−±]/, "")}</span>
            <span className="lab-hm-dl" data-dir="down">
              ▼ {t("heat.better")}
            </span>
            <span className="lab-hm-dl" data-dir="up">
              ▲ {t("heat.worse")}
            </span>
          </>
        ) : (
          <>
            <span className="mono">0</span>
            <span className="lab-hm-ramp" aria-hidden />
            <span className="mono">{legendMax()}</span>
            <span className="muted">{t(`heat.mHelp.${metric}`)}</span>
          </>
        )}
        {lowApplies && (metric === "fail_rate" || metric === "delta") ? <span className="lab-hm-lowkey">{t("heat.low")}</span> : null}
        {m && (m.folded.x || m.folded.y) ? <span className="muted mono">{t("heat.folded", { n: m.folded.x + m.folded.y })}</span> : null}
      </div>
      {degenerate ? <p className="note lab-hm-note">{t("heat.degenerate")}</p> : null}
      {mx.error && !m ? <div className="note bad">{mx.error instanceof Error ? mx.error.message : String(mx.error)}</div> : null}
      {m === null ? <div className="empty">{t("heat.unavailable")}</div> : null}
      {m === undefined ? <Skeleton rows={8} /> : null}
      {grid && m ? (
        !grid.rows.length || !grid.cols.length ? (
          <div className="empty">{s("empty.issues")}</div>
        ) : (
          <div className="lab-hm-scroll" ref={wrap} onMouseLeave={() => setHover(null)}>
            <div
              key={`${x}.${y}.${metric}`}
              className="lab-hm-grid"
              style={{ gridTemplateColumns: `minmax(var(--hm-rh, 132px), 1.3fr) repeat(${grid.cols.length}, minmax(var(--hm-c, 58px), 1fr)) minmax(var(--hm-m, 70px), 0.8fr)` }}
              role="grid"
              aria-label={t("heat.aria", { y: dl.dim(y), x: dl.dim(x), metric: t(`heat.m.${metric}`) })}
            >
              <div className="lab-hm-corner mono" role="columnheader">
                {dl.dim(y)} ↓ · {dl.dim(x)} →
              </div>
              {grid.cols.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  role="columnheader"
                  className={clsx("lab-hm-ch", (filX?.includes(c.v) || sel?.xv === c.v) && "on", c.v === OTHER && "other")}
                  title={label(x, c.v, c.lb)}
                  disabled={c.v === OTHER}
                  onClick={() => f.toggle(xParam as never, c.v)}
                >
                  {short(x, c.v, c.lb)}
                </button>
              ))}
              <div className="lab-hm-ch lab-hm-mh mono" role="columnheader">
                {t("heat.rowTotal")}
              </div>
              {grid.rows.map((r, ri) => {
                const rs = grid.yt.get(r.v);
                const rv = statValue(rs, metric);
                return (
                  <div key={r.v} className="lab-hm-row" role="row" style={{ ["--ri" as string]: ri }}>
                    <button
                      type="button"
                      className={clsx("lab-hm-rh", (filY?.includes(r.v) || sel?.yv === r.v) && "on", r.v === OTHER && "other")}
                      disabled={r.v === OTHER}
                      onClick={() => f.toggle(yParam as never, r.v)}
                      role="rowheader"
                      title={label(y, r.v, r.lb)}
                    >
                      {label(y, r.v, r.lb)}
                    </button>
                    {grid.cols.map((c) => {
                      const cell = grid.by.get(c.v + "|" + r.v);
                      if (!cell || (!cell.total && !cell.fails)) return <div key={c.v} className="lab-hm-cell empty" role="gridcell" aria-label="—" />;
                      const low = lowApplies && cell.total < LOW_N && (metric === "fail_rate" || metric === "delta");
                      const on = sel ? sel.xv === c.v && sel.yv === r.v : false;
                      const ringed = !sel && (filX?.length || filY?.length) ? (!filX?.length || filX.includes(c.v)) && (!filY?.length || filY.includes(r.v)) : false;
                      const dir = deltaDir(cell.delta);
                      return (
                        <button
                          key={c.v}
                          type="button"
                          role="gridcell"
                          className={clsx("lab-hm-cell", low && "low", sel && (on ? "sel" : "dim"), ringed && "ring")}
                          style={{ background: fillOf(cell.value), color: inkOf(cell.value) }}
                          onMouseEnter={(e) => onEnter(e, cell)}
                          onFocus={(e) => onEnter(e, cell)}
                          onBlur={() => setHover(null)}
                          onClick={() => clickCell(cell)}
                          aria-selected={on}
                          aria-label={t("heat.cellAria", { y: lbY(r.v), x: lbX(c.v), value: fmtV(cell.value, false), fails: cell.fails, total: cell.total, issues: cell.issues })}
                        >
                          <span className="lab-hm-v mono">{fmtV(cell.value)}</span>
                          {metric !== "delta" && cell.delta != null && !low && !degenerate ? (
                            <span className="lab-hm-d mono" data-dir={dir} aria-hidden>
                              {dir === "up" ? "▲" : dir === "down" ? "▼" : ""}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    <div className="lab-hm-margin" role="gridcell">
                      <span className="mono">{fmtV(rv)}</span>
                      <i data-dir={metric === "delta" && rv != null ? (rv < 0 ? "down" : "up") : undefined} style={{ width: `${Math.min(100, (Math.abs(rv ?? 0) / grid.marginMax) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="lab-hm-rh lab-hm-foot mono">{t("heat.colTotal")}</div>
              {grid.cols.map((c) => {
                const cs = grid.xt.get(c.v);
                const cv = statValue(cs, metric);
                const dir = deltaDir(cs?.delta);
                return (
                  <div key={c.v} className="lab-hm-margin col" role="gridcell">
                    <span className="mono">{fmtV(cv)}</span>
                    {metric !== "delta" && cs?.delta != null && !degenerate ? (
                      <span className="lab-hm-d mono" data-dir={dir}>
                        {fx.pp(cs.delta)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              <div />
            </div>
            {hover ? (
              <div className={clsx("lab-tip", hover.below && "below")} style={{ left: hover.x, top: hover.y }} role="tooltip">
                <div className="lab-tip-h">
                  <b>{lbY(hover.c.y)}</b> × {lbX(hover.c.x)}
                </div>
                <dl>
                  <dt>{s("field.failRate")}</dt>
                  <dd className="mono">{fx.pct(hover.c.fail_rate)}</dd>
                  <dt>{s("field.baselineRate")}</dt>
                  <dd className="mono">{fx.pct(hover.c.baseline_fail_rate)}</dd>
                  <dt>{s("field.delta")}</dt>
                  <dd className="mono lab-hm-d" data-dir={deltaDir(hover.c.delta)}>
                    {fx.pp(hover.c.delta)}
                  </dd>
                  <dt>{s("kpi.fails")}</dt>
                  <dd className="mono">
                    {fm.number(hover.c.fails)} / {fm.number(hover.c.total)}
                  </dd>
                  <dt>{t("heat.m.issue_count")}</dt>
                  <dd className="mono">{fm.number(hover.c.issues)}</dd>
                </dl>
                <div className="lab-tip-hint">{lowApplies && hover.c.total < LOW_N ? t("heat.lowHint") : t("heat.clickHint")}</div>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
