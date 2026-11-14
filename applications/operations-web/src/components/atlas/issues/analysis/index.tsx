"use client";
/**
 * Issue Report — Analysis view (/issues/analysis; from candidate C "Signal Lab"): an analyst workspace of
 * linked views. OWNED BY THE ANALYSIS VIEW ENGINEER. The page header, view switcher, export buttons and
 * the unified FilterBar come from the frame (../frame); this view renders no filter UI.
 *
 *   metric tiles · signal readouts (auto insights)
 *   heatmap: free X × Y over MATRIX_DIMS, metric picker, presets  ──►  cell selection (hm)
 *   bubble quadrant (volume × trend z, colour-by)  ·  treemap (selectable 3-level hierarchy, tree)
 *   emerging patterns (stream + ladder + terms)    ·  issue ledger ──► split detail pane (?issue=…)
 *
 * View-local URL state (registered in issues-shared/links.ts VIEW_STATE_PARAMS.analysis):
 *   x, y, metric  heatmap axes + metric (defaults: division × agent_function, fail_rate)
 *   hm            selected heatmap cell "<x value>|<y value>"
 *   tree          treemap hierarchy "dim,dim,dim"
 *   quad, pat     bubble quadrant brush, new-pattern brush
 * The treemap node brush and the bubble colour-by are in-page state.
 *
 * Linked cross-filtering: every brush (cell, quadrant, pattern, treemap node) narrows the other views
 * client-side; FilterBar filters re-query everything.
 */
import { ArrowUpRight, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFmt, useT } from "@/i18n/client";
import { parseAsString, useQueryState } from "@/lib/client";
import {
  ISSUE_DIMS,
  useDimLabel,
  useIssueFilters,
  useIssueFormat,
  useIssueInsights,
  useIssueLive,
  useIssuePatterns,
  useIssues,
  useIssueSummary,
  useIssueViewLinks,
  type MatrixDim,
} from "../../issues-shared";
import { ErrorNote, Plate, Skeleton, useToast } from "../../ui";
import { Bubble } from "./bubble";
import { DetailPane } from "./detail";
import { Heatmap, type HeatAxes } from "./heatmap";
import { Insights } from "./insights";
import {
  DEFAULT_X,
  DEFAULT_Y,
  OTHER,
  QUADRANTS,
  brushActive,
  decodeCell,
  encodeCell,
  isMatrixDim,
  isMetric,
  matchesBrush,
  parseTree,
  volumeCut,
  type CellSel,
  type LabBrush,
  type LabDim,
  type Quadrant,
  type TreeNode,
} from "./lab";
import { Patterns } from "./patterns";
import { IssueTable } from "./table";
import { MetricTiles } from "./tiles";
import { Treemap } from "./treemap";
import "@/styles/atlas-issues.css";
import "@/styles/atlas-issues-analysis.css";

/** session memory of the concrete values behind an "Other" cell (the URL only keeps "__other__") */
type CellValues = { key: string; xs: string[]; ys: string[] };

export function IssuesAnalysis() {
  const t = useT("issuesAnalysis");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const dl = useDimLabel();
  const toast = useToast();
  const V = useIssueViewLinks();
  const f = useIssueFilters();
  const sum = useIssueSummary(f);
  const ins = useIssueInsights(f);
  const pats = useIssuePatterns(f);
  const list = useIssues(f, { pageSize: 500, page: 1 });
  const [quadRaw, setQuadRaw] = useQueryState("quad", parseAsString);
  const [patId, setPatId] = useQueryState("pat", parseAsString);
  const [xRaw, setXRaw] = useQueryState("x", parseAsString);
  const [yRaw, setYRaw] = useQueryState("y", parseAsString);
  const [metricRaw, setMetricRaw] = useQueryState("metric", parseAsString);
  const [hmRaw, setHm] = useQueryState("hm", parseAsString);
  const [treeRaw, setTreeRaw] = useQueryState("tree", parseAsString);
  const [node, setNode] = useState<TreeNode | null>(null);
  const [cellVals, setCellVals] = useState<CellValues | null>(null);

  useIssueLive((m) => {
    if (m.kind === "new_critical" && m.title) toast.ok(s("live.newCritical", { severity: m.severity ?? "", title: fx.text(m.title) }));
  });

  // ── heatmap axes (defaults stay out of the URL) ──
  let x: MatrixDim = isMatrixDim(xRaw) ? xRaw : DEFAULT_X;
  let y: MatrixDim = isMatrixDim(yRaw) ? yRaw : DEFAULT_Y;
  if (x === y) [x, y] = [DEFAULT_X === y ? DEFAULT_Y : DEFAULT_X, y];
  const metric = isMetric(metricRaw) ? metricRaw : "fail_rate";
  const axes: HeatAxes = { x, y, metric };
  const setAxes = useCallback(
    (a: Partial<HeatAxes>) => {
      const nx = a.x ?? x;
      const ny = a.y ?? y;
      if (nx === ny) return;
      if (a.x || a.y) {
        setXRaw(nx === DEFAULT_X && ny === DEFAULT_Y ? null : nx);
        setYRaw(nx === DEFAULT_X && ny === DEFAULT_Y ? null : ny);
        // a selection only makes sense on its own axes; a pure swap keeps it (mirrored)
        const c = decodeCell(hmRaw);
        setHm(c && nx === y && ny === x ? encodeCell(c.yv, c.xv) : null);
      }
      if (a.metric) setMetricRaw(a.metric === "fail_rate" ? null : a.metric);
    },
    [x, y, hmRaw, setXRaw, setYRaw, setHm, setMetricRaw],
  );

  // ── heatmap cell selection ──
  const cell: CellSel | null = useMemo(() => {
    const c = decodeCell(hmRaw);
    if (!c) return null;
    const mem = cellVals?.key === hmRaw + x + y ? cellVals : null;
    return { x, y, xv: c.xv, yv: c.yv, xs: c.xv === OTHER ? (mem?.xs ?? []) : [c.xv], ys: c.yv === OTHER ? (mem?.ys ?? []) : [c.yv] };
  }, [hmRaw, x, y, cellVals]);
  const onCell = useCallback(
    (c: { xv: string; yv: string; xs: string[]; ys: string[] } | null) => {
      if (!c) return void setHm(null);
      const raw = encodeCell(c.xv, c.yv);
      setCellVals({ key: raw + x + y, xs: c.xs, ys: c.ys });
      setHm(raw);
    },
    [setHm, x, y],
  );

  // ── treemap hierarchy ──
  const levels = parseTree(treeRaw);
  const setLevels = useCallback(
    (l: [LabDim, LabDim, LabDim]) => {
      setNode(null);
      setTreeRaw(l.join(",") === parseTree(null).join(",") ? null : l.join(","));
    },
    [setTreeRaw],
  );

  const quad = QUADRANTS.includes(quadRaw as Quadrant) ? (quadRaw as Quadrant) : null;
  const pattern = useMemo(() => pats.data?.items.find((p) => p.id === patId) ?? null, [pats.data, patId]);
  const brush: LabBrush = useMemo(() => ({ quad, pattern, cell, node }), [quad, pattern, cell, node]);

  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const vCut = useMemo(() => volumeCut(all), [all]);
  const ledger = useMemo(() => (brushActive(brush) ? all.filter((i) => matchesBrush(i, brush, vCut)) : all), [all, brush, vCut]);
  const ids = useMemo(() => ledger.map((i) => i.id), [ledger]);
  /** issues lit by every brush except the pattern brush: the pattern ladder narrows to these */
  const patScope = useMemo(() => (brush.cell || brush.quad || brush.node ? new Set(all.filter((i) => matchesBrush(i, { ...brush, pattern: null }, vCut)).map((i) => i.id)) : null), [all, brush, vCut]);

  const close = () => f.select(null);
  useEffect(() => {
    if (!f.selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.(".lab-detail input, .lab-detail textarea, .lab-detail select")) f.select(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [f]);

  /** Triage with both cell values ("Other" carries its folded values) */
  const cellDrill = useMemo(() => {
    if (!cell || !cell.xs.length || !cell.ys.length) return null;
    const href = V.drillHref(x, cell.xs.join(","));
    const [path, q = ""] = href.split("?");
    const sp = new URLSearchParams(q);
    sp.set(ISSUE_DIMS[y].param, cell.ys.join(","));
    return `${path}?${sp.toString()}`;
  }, [cell, V, x, y]);
  const nodeDrill = useMemo(() => {
    if (!node) return null;
    const [first, ...rest] = node;
    const [path, q = ""] = V.drillHref(first.dim, first.value).split("?");
    const sp = new URLSearchParams(q);
    for (const p of rest) sp.set(ISSUE_DIMS[p.dim].param, p.value);
    return `${path}?${sp.toString()}`;
  }, [node, V]);

  const valueLabel = (dim: LabDim, v: string) => (v === OTHER ? s("dimValue.other") : dim === "intent" ? v : dl.value(dim, v));
  const k = sum.data;
  const lit = ledger.length;
  const brushChips = (
    <>
      {cell ? (
        <span className="lab-chip brush cell">
          <span className="muted">{t("sel.cell")}</span> {valueLabel(y, cell.yv)} × {valueLabel(x, cell.xv)}
          {cellDrill ? (
            <Link className="lab-chip-a" href={cellDrill}>
              {t("sel.toTriage")} <ArrowUpRight aria-hidden />
            </Link>
          ) : null}
          <button type="button" className="lab-chip-x" onClick={() => setHm(null)} aria-label={t("sel.clear")}>
            <X aria-hidden />
          </button>
        </span>
      ) : null}
      {node ? (
        <span className="lab-chip brush">
          <span className="muted">{t("sel.node")}</span> {node.map((p) => valueLabel(p.dim, p.value)).join(" › ")}
          {nodeDrill ? (
            <Link className="lab-chip-a" href={nodeDrill}>
              {t("sel.toTriage")} <ArrowUpRight aria-hidden />
            </Link>
          ) : null}
          <button type="button" className="lab-chip-x" onClick={() => setNode(null)} aria-label={t("sel.clear")}>
            <X aria-hidden />
          </button>
        </span>
      ) : null}
      {quad ? (
        <button type="button" className="lab-chip brush" onClick={() => setQuadRaw(null)}>
          <span className="muted">{t("quad.label")}</span> {t(`quad.${quad}`)} <X aria-hidden />
        </button>
      ) : null}
      {pattern ? (
        <button type="button" className="lab-chip brush" onClick={() => setPatId(null)}>
          <span className="muted">{s("field.pattern")}</span> “{pattern.template}” <X aria-hidden />
        </button>
      ) : null}
    </>
  );
  const anyBrush = brushActive(brush);
  const clearAll = () => {
    setHm(null);
    setNode(null);
    setQuadRaw(null);
    setPatId(null);
  };

  return (
    <div className="iss-c iss-view">
      <div className="lab" data-open={f.selected ? "" : undefined}>
        <div className="lab-main">
          {sum.error ? <ErrorNote error={sum.error} /> : null}
          {k ? <MetricTiles sum={k} f={f} /> : <Skeleton rows={3} />}

          <Plate title={t("heat.title")} refText={t("heat.ref")} className="lab-plate">
            <Heatmap f={f} axes={axes} setAxes={setAxes} sel={cell} onCell={onCell} />
          </Plate>

          {anyBrush ? (
            <div className="lab-selbar" role="status">
              <span className="lab-selbar-k mono">{t("sel.title")}</span>
              <div className="lab-brushes">{brushChips}</div>
              <span className="mono muted lab-selbar-n">{t("sel.lit", { n: fm.number(lit), total: fm.number(all.length) })}</span>
              <button type="button" className="btn sm ghost" onClick={clearAll}>
                {t("sel.clearAll")}
              </button>
            </div>
          ) : null}

          <div className="lab-row r-tree">
            <Plate title={t("bubble.title")} refText={t("bubble.ref", { n: all.length })} className="lab-plate">
              {list.data ? <Bubble issues={all} vCut={vCut} brush={brush} setQuad={(q) => setQuadRaw(q)} selected={f.selected} onSelect={(id) => f.select(id)} /> : <Skeleton rows={8} />}
            </Plate>
            <Plate title={t("tree.title")} refText={levels.map((l) => (l === "intent" ? s("column.intent") : dl.dim(l))).join(" → ")} className="lab-plate">
              {list.data ? <Treemap issues={all} brush={brush} vCut={vCut} levels={levels} setLevels={setLevels} node={node} setNode={setNode} /> : <Skeleton rows={8} />}
            </Plate>
          </div>

          <div className="lab-row r-hm">
            <Plate title={t("pat.title")} refText={pats.data ? t("pat.ref", { n: pats.data.items.length }) : undefined} className="lab-plate">
              <Patterns data={pats.data} f={f} activeId={patId} onBrush={(p) => setPatId(p?.id ?? null)} scope={patScope} />
            </Plate>
            <Plate title={t("ins.title")} refText={t("ins.ref", { n: ins.data?.items.length ?? 0 })} className="lab-plate">
              <Insights data={ins.data} f={f} onIssue={(id) => f.select(id)} />
            </Plate>
          </div>

          <Plate title={t("table.title")} right={<div className="lab-brushes">{brushChips}</div>} className="lab-plate" id="lab-ledger">
            {list.error ? <ErrorNote error={list.error} /> : null}
            {list.data ? <IssueTable items={ledger} f={f} page={f.page} setPage={f.setPage} /> : <Skeleton rows={8} />}
          </Plate>
          <p className="lab-foot mono">{t("foot")}</p>
        </div>
        {f.selected ? (
          <>
            <div className="lab-scrim" onClick={close} aria-hidden />
            <DetailPane f={f} onClose={close} siblings={ids} />
          </>
        ) : null}
      </div>
    </div>
  );
}
