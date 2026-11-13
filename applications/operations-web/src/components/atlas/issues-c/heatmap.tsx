"use client";
/**
 * Signal Lab — FAIL-rate heatmap: Agent function × language | market | device | model version.
 * Cell fill = FAIL rate (sequential, one hue); the inner marker = Δ vs baseline (diverging ▲/▼ + a
 * baseline notch on the cell's rate track). Margins carry the per-row / per-column FAIL rate.
 *
 * Linked view: the matrix ignores its OWN two dimensions in the filter (classic cross-filter), so a
 * clicked cell stays in context and is ringed while every other view narrows to it.
 * × language / × market come from summary.matrix / market_matrix. × device / × model version are not
 * in the summary, so they are assembled from one summary per column value (columns.agent_function).
 */
import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import { deviceLabel, languageName } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { api, useApi, type IssueQuery } from "@/lib/client";
import type { Issue, IssueFacets, IssueMatrix, IssueMatrixCell, IssueSummary } from "@/lib/types";
import { useIssueFormat, type IssueFiltersApi } from "../issues-shared";
import { Skeleton } from "../ui";
import { deltaDir, heatFill, heatInk } from "./lab";

export type HeatMode = "language" | "market" | "device" | "model_version";
export const HEAT_MODES: HeatMode[] = ["language", "market", "device", "model_version"];
const OPTS = { revalidateOn: ["issue" as const], refreshInterval: 30_000 };

function without(q: IssueQuery, keys: string[]): IssueQuery {
  const o = { ...q } as Record<string, unknown>;
  for (const k of keys) delete o[k];
  return o as IssueQuery;
}

/** the matrix for the current mode, ignoring the matrix's own dimensions */
function useMatrix(f: IssueFiltersApi, mode: HeatMode, facets: IssueFacets | undefined) {
  const base = useMemo(() => without(f.filterQuery, ["agent_function", mode]), [f.filterQuery, mode]);
  const direct = mode === "language" || mode === "market";
  const one = useApi(direct ? ["issc:hm", base] : null, () => api.issueSummary(base), OPTS);
  const values = useMemo(() => (direct ? [] : (facets?.facets[mode] ?? []).map((v) => v.value).sort()), [direct, facets, mode]);
  const many = useApi(!direct && values.length ? ["issc:hm-split", mode, values, base] : null, () => Promise.all(values.map((v) => api.issueSummary({ ...base, [mode]: [v] }))), OPTS);
  return useMemo((): { m: IssueMatrix | null; margins: IssueSummary | null; error: unknown } => {
    if (direct) {
      const s = one.data;
      return { m: s ? (mode === "language" ? s.matrix : s.market_matrix) : null, margins: s ?? null, error: one.error };
    }
    const list = many.data;
    if (!list) return { m: null, margins: null, error: many.error };
    const rows = [...new Set(list.flatMap((x) => x.matrix.rows))];
    const cells: IssueMatrixCell[] = [];
    list.forEach((s, ci) => {
      for (const r of rows) {
        // summary.columns is capped to the top values, so totals come from the fn × language matrix
        const st = s.columns.agent_function.find((x) => x.value === r);
        const mc = s.matrix.cells.filter((c) => c.row === r);
        const total = mc.reduce((a, c) => a + c.total, 0);
        const fails = mc.reduce((a, c) => a + c.fails, 0);
        cells.push({
          row: r,
          col: values[ci],
          total,
          fails,
          fail_rate: total ? Math.round((fails / total) * 1000) / 10 : null,
          baseline_fail_rate: st?.baseline_fail_rate ?? null,
          delta: st?.delta ?? null,
          top_issue_id: s.top_issues.find((i) => i.signature.agent_function === r)?.id ?? null,
        });
      }
    });
    return { m: { rows, cols: values, cells }, margins: null, error: many.error };
  }, [direct, one.data, one.error, many.data, many.error, mode, values]);
}

interface Hover {
  c: IssueMatrixCell;
  x: number;
  y: number;
}

export function Heatmap({ f, facets, mode, setMode, issues }: { f: IssueFiltersApi; facets: IssueFacets | undefined; mode: HeatMode; setMode: (m: HeatMode) => void; issues: Issue[] }) {
  const t = useT("issuesC");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const locale = useLocale();
  const { m, margins, error } = useMatrix(f, mode, facets);
  const [hover, setHover] = useState<Hover | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const colLabel = (c: string) => (mode === "language" ? c.toUpperCase() : mode === "device" ? deviceLabel(c, locale) : mode === "model_version" ? c.replace("bixby-nlu-", "") : c);
  const colTitle = (c: string) => (mode === "language" ? languageName(c, locale) : mode === "market" ? fx.market(c) : colLabel(c));
  const selRows = f.values.agent_function;
  const selCols = f.values[mode];
  const anySel = selRows.length > 0 || selCols.length > 0;
  const isSel = (r: string, c: string) => (!selRows.length || selRows.includes(r)) && (!selCols.length || selCols.includes(c));

  const grid = useMemo(() => {
    if (!m) return null;
    const by = new Map(m.cells.map((c) => [c.row + "|" + c.col, c]));
    const rates = m.cells.filter((c) => c.total >= 10 && c.fail_rate != null).map((c) => c.fail_rate!);
    const max = Math.min(70, Math.max(20, Math.ceil((Math.max(0, ...rates) + 2) / 5) * 5));
    const rowStat = (r: string) => {
      const cs = m.cells.filter((c) => c.row === r);
      const tot = cs.reduce((a, c) => a + c.total, 0);
      const fl = cs.reduce((a, c) => a + c.fails, 0);
      const st = margins?.columns.agent_function.find((x) => x.value === r);
      return { rate: st ? st.fail_rate : tot ? (fl / tot) * 100 : null, delta: st?.delta ?? null, fails: fl };
    };
    const colStat = (c: string) => {
      const cs = m.cells.filter((x) => x.col === c);
      const tot = cs.reduce((a, x) => a + x.total, 0);
      const fl = cs.reduce((a, x) => a + x.fails, 0);
      const st = margins?.columns[mode]?.find((x) => x.value === c);
      return { rate: st ? st.fail_rate : tot ? (fl / tot) * 100 : null, delta: st?.delta ?? null, fails: fl };
    };
    const rows = m.rows.filter((r) => m.cells.some((c) => c.row === r && c.total > 0));
    return { by, max, rows, cols: m.cols, rowStat, colStat };
  }, [m, margins, mode]);

  const clickCell = (c: IssueMatrixCell) => {
    const exact = selRows.length === 1 && selRows[0] === c.row && selCols.length === 1 && selCols[0] === c.col;
    f.set({ agent_function: exact ? [] : [c.row], [mode]: exact ? [] : [c.col] });
  };
  const onEnter = (e: React.MouseEvent | React.FocusEvent, c: IssueMatrixCell) => {
    const host = wrap.current?.getBoundingClientRect();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!host) return;
    setHover({ c, x: r.left - host.left + r.width / 2, y: r.top - host.top });
  };
  const topIssue = hover?.c.top_issue_id ? issues.find((i) => i.id === hover.c.top_issue_id) : null;

  return (
    <div className="lab-hm">
      <div className="lab-viewbar">
        <div className="seg" role="group" aria-label={t("heat.axis")}>
          {HEAT_MODES.map((md) => (
            <button key={md} type="button" aria-pressed={mode === md} onClick={() => setMode(md)}>
              × {fx.column(md)}
            </button>
          ))}
        </div>
        <div className="lab-hm-legend" aria-hidden>
          <span className="mono">0%</span>
          <span className="lab-hm-ramp" />
          <span className="mono">{grid ? `${grid.max}%+` : ""}</span>
          <span className="lab-hm-dl" data-dir="up">
            ▲ {t("heat.worse")}
          </span>
          <span className="lab-hm-dl" data-dir="down">
            ▼ {t("heat.better")}
          </span>
          <span className="lab-hm-lowkey">{t("heat.low")}</span>
        </div>
      </div>
      {error && !m ? <div className="note bad">{error instanceof Error ? error.message : String(error)}</div> : null}
      {!grid ? (
        <Skeleton rows={8} />
      ) : (
        <div className="lab-hm-scroll" ref={wrap} onMouseLeave={() => setHover(null)}>
          <div className="lab-hm-grid" style={{ gridTemplateColumns: `minmax(var(--hm-rh, 118px), 1.25fr) repeat(${grid.cols.length}, minmax(var(--hm-c, 58px), 1fr)) minmax(var(--hm-m, 64px), 0.8fr)` }} role="grid" aria-label={t("heat.aria", { axis: fx.column(mode) })}>
            <div className="lab-hm-corner mono" role="columnheader">
              {fx.column("agent_function")} ↓ · {fx.column(mode)} →
            </div>
            {grid.cols.map((c) => (
              <button key={c} type="button" role="columnheader" className={clsx("lab-hm-ch", selCols.includes(c) && "on")} title={colTitle(c)} onClick={() => f.toggle(mode, c)}>
                {colLabel(c)}
              </button>
            ))}
            <div className="lab-hm-ch lab-hm-mh mono" role="columnheader">
              {t("heat.rowRate")}
            </div>
            {grid.rows.map((r, ri) => {
              const rs = grid.rowStat(r);
              return (
                <div key={r} className="lab-hm-row" role="row" style={{ ["--ri" as string]: ri }}>
                  <button type="button" className={clsx("lab-hm-rh", selRows.includes(r) && "on")} onClick={() => f.toggle("agent_function", r)} role="rowheader">
                    {fx.fn(r)}
                  </button>
                  {grid.cols.map((c) => {
                    const cell = grid.by.get(r + "|" + c);
                    if (!cell || !cell.total) return <div key={c} className="lab-hm-cell empty" role="gridcell" aria-label="—" />;
                    const low = cell.total < 10;
                    const dir = deltaDir(cell.delta);
                    const sel = anySel && isSel(r, c);
                    return (
                      <button
                        key={c}
                        type="button"
                        role="gridcell"
                        className={clsx("lab-hm-cell", low && "low", anySel && (sel ? "sel" : "dim"))}
                        style={{ background: heatFill(cell.fail_rate, grid.max), color: heatInk(cell.fail_rate, grid.max) }}
                        onMouseEnter={(e) => onEnter(e, cell)}
                        onFocus={(e) => onEnter(e, cell)}
                        onBlur={() => setHover(null)}
                        onClick={() => clickCell(cell)}
                        aria-label={t("heat.cellAria", { fn: fx.fn(r), col: colTitle(c), rate: fx.pct(cell.fail_rate), delta: fx.pp(cell.delta), fails: cell.fails, total: cell.total })}
                      >
                        <span className="lab-hm-v mono">{cell.fail_rate == null ? "—" : cell.fail_rate.toFixed(cell.fail_rate >= 10 ? 0 : 1)}</span>
                        {cell.delta != null && !low ? (
                          <span className="lab-hm-d mono" data-dir={dir}>
                            {dir === "up" ? "▲" : dir === "down" ? "▼" : "·"}
                            {Math.abs(cell.delta) >= 0.5 ? Math.abs(cell.delta).toFixed(Math.abs(cell.delta) >= 10 ? 0 : 1) : ""}
                          </span>
                        ) : null}
                        {cell.baseline_fail_rate != null && !low ? <i className="lab-hm-notch" style={{ left: `${Math.min(100, (cell.baseline_fail_rate / grid.max) * 100)}%` }} /> : null}
                      </button>
                    );
                  })}
                  <div className="lab-hm-margin" role="gridcell">
                    <span className="mono">{fx.pct(rs.rate)}</span>
                    <i style={{ width: `${Math.min(100, ((rs.rate ?? 0) / grid.max) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="lab-hm-rh lab-hm-foot mono">{t("heat.colRate")}</div>
            {grid.cols.map((c) => {
              const cs = grid.colStat(c);
              const dir = deltaDir(cs.delta);
              return (
                <div key={c} className="lab-hm-margin col" role="gridcell">
                  <span className="mono">{fx.pct(cs.rate)}</span>
                  {cs.delta != null ? (
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
            <div className="lab-tip" style={{ left: hover.x, top: hover.y }} role="tooltip">
              <div className="lab-tip-h">
                <b>{fx.fn(hover.c.row)}</b> × {colTitle(hover.c.col)}
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
              </dl>
              {topIssue ? (
                <div className="lab-tip-top">
                  <span className="iss-sev" data-sev={topIssue.severity}>
                    {topIssue.severity}
                  </span>{" "}
                  {fx.text(topIssue.title)}
                </div>
              ) : null}
              <div className="lab-tip-hint">{hover.c.total < 10 ? t("heat.lowHint") : t("heat.clickHint")}</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
