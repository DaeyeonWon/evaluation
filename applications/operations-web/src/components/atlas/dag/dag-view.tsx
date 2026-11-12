"use client";
/**
 * Reusable Pipeline DAG renderer (SVG, Atlas blueprint style).
 *
 *   <DagView model={vm} selected={path} onSelect={…} onDrill={…} resolveChild={…} />
 *
 * - Layered left→right auto-layout (./layout.ts), stable across live updates.
 * - Component nodes = instrument plates; sub-pipeline nodes = a "stacked frame" (pipeline@version,
 *   child job status). With `inline` on, a sub-pipeline node expands in place into a nested group
 *   (resolveChild gives its DAG); otherwise activating it calls onDrill (drill-in navigation).
 * - Job mode (status per node) or aggregate mode (counts per status, p50/p95, hotspot heat).
 * - Running edges animate; the failed path is drawn in the failed tone; skipped edges are dashed.
 * - d3-zoom pan/zoom (drag; ⌘/Ctrl + wheel; pinch), fit-to-view, keyboard: Tab / arrow keys move
 *   between nodes, Enter opens, +/−/0 zoom. prefers-reduced-motion: no transitions or dash flow.
 * Node ids at nested levels are paths joined with "/" (e.g. "response_judge/safety_check/pii_scan").
 */
import clsx from "clsx";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { ChevronRight, Layers, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CatalogIcon } from "@/components/shared";
import { NODE_STATUS_META } from "@/lib/catalog";
import { useLocale, useT } from "@/i18n/client";
import { statusLabel } from "@/i18n";
import type { JobStatus, Tone } from "@/lib/types";
import { useReducedMotionSafe } from "../ui";

/** d3-zoom pulls in d3-transition at runtime (Selection#transition); @types/d3-transition is not installed. */
type Callable = { call: (fn: (...a: never[]) => void, ...args: unknown[]) => unknown };
function animated(sel: unknown, ms: number): Callable {
  return (sel as { transition: () => { duration: (n: number) => Callable } }).transition().duration(ms);
}
import { edgePath, layeredLayout } from "./layout";

export type DagCounts = Partial<Record<JobStatus, number>>;

export interface DagNodeVM {
  id: string;
  kind: "component" | "subpipeline";
  deps: string[];
  title: string;
  /** small secondary line (e.g. Korean label) */
  subtitle?: string;
  /** mono meta line (component id · machine type) */
  meta?: string;
  /** "policy-guard@1.0.0" for sub-pipeline nodes */
  refLabel?: string;
  /** job mode */
  status?: JobStatus | null;
  /** aggregate mode */
  counts?: DagCounts;
  /** right-aligned readout (duration, or "p50 · p95") */
  readout?: string;
  /** 0..1 progress for running nodes */
  progress?: number | null;
  errorCode?: string | null;
  /** 0..1 hotspot intensity (aggregate mode) */
  heat?: number;
  hot?: boolean;
  /** on the failure path (failed leaf or an ancestor sub-pipeline of it) */
  onFailPath?: boolean;
}
export interface DagVM {
  nodes: DagNodeVM[];
}

const CW = 220;
/** node heights: job mode (status) / aggregate mode (counts + p50/p95 line) */
const CH = 90;
const CH_AGG = 100;
const SW = 236;
const SH = 112;
const SH_AGG = 122;
const G_PAD = 16;
const G_HEAD = 40;

interface Placed {
  path: string;
  node: DagNodeVM;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  child?: Built;
}
interface Built {
  placed: Placed[];
  edges: { from: Placed; to: Placed }[];
  w: number;
  h: number;
}

function toneOf(n: DagNodeVM): Tone {
  if (n.status) return NODE_STATUS_META[n.status]?.tone ?? "queued";
  const c = n.counts ?? {};
  if (n.hot) return "failed";
  if ((c.RUNNING ?? 0) > 0) return "running";
  if ((c.SUCCEEDED ?? 0) > 0) return "success";
  if ((c.FAILED ?? 0) > 0) return "failed";
  return "queued";
}

function build(model: DagVM, prefix: string, opts: { inline: boolean; collapsed: Set<string>; resolveChild?: (path: string, n: DagNodeVM) => DagVM | null }, depth: number): Built {
  const children = new Map<string, Built>();
  const inputs = model.nodes.map((n) => {
    const path = prefix ? `${prefix}/${n.id}` : n.id;
    if (opts.inline && n.kind === "subpipeline" && !opts.collapsed.has(path) && depth < 4) {
      const sub = opts.resolveChild?.(path, n);
      if (sub && sub.nodes.length) {
        const b = build(sub, path, opts, depth + 1);
        children.set(n.id, b);
        return { id: n.id, deps: n.deps, w: b.w + G_PAD * 2, h: b.h + G_HEAD + G_PAD };
      }
    }
    const agg = !!n.counts;
    return { id: n.id, deps: n.deps, w: n.kind === "subpipeline" ? SW : CW, h: n.kind === "subpipeline" ? (agg ? SH_AGG : SH) : agg ? CH_AGG : CH };
  });
  const L = layeredLayout(inputs, { colGap: 70, rowGap: 24 });
  const placed: Placed[] = model.nodes.map((n) => {
    const b = L.boxes[n.id];
    return { path: prefix ? `${prefix}/${n.id}` : n.id, node: n, x: b.x, y: b.y, w: b.w, h: b.h, layer: b.layer, child: children.get(n.id) };
  });
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const edges = placed.flatMap((p) => p.node.deps.filter((d) => byId.has(d)).map((d) => ({ from: byId.get(d)!, to: p })));
  return { placed, edges, w: L.width, h: L.height };
}

/** absolute boxes of every rendered node (for keyboard navigation) */
function flatten(b: Built, ox = 0, oy = 0, out: { path: string; x: number; y: number; w: number; h: number }[] = []) {
  for (const p of b.placed) {
    out.push({ path: p.path, x: ox + p.x, y: oy + p.y, w: p.w, h: p.h });
    if (p.child) flatten(p.child, ox + p.x + G_PAD, oy + p.y + G_HEAD, out);
  }
  return out;
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s);

export interface DagViewProps {
  model: DagVM;
  label: string;
  selected?: string | null;
  onSelect?: (path: string, node: DagNodeVM) => void;
  onDrill?: (path: string, node: DagNodeVM) => void;
  /** inline-expand mode: activating a sub-pipeline node toggles its nested group instead of drilling */
  inline?: boolean;
  onInlineChange?: (on: boolean) => void;
  /** inline mode: sub-pipeline paths the user collapsed (everything else is expanded) */
  collapsed?: Set<string>;
  onToggleExpand?: (path: string) => void;
  resolveChild?: (path: string, node: DagNodeVM) => DagVM | null;
  height?: number;
  toolbar?: ReactNode;
  /** a legend / footer line under the canvas */
  footer?: ReactNode;
}

export function DagView({ model, label, selected, onSelect, onDrill, inline = false, onInlineChange, collapsed, onToggleExpand, resolveChild, height = 380, toolbar, footer }: DagViewProps) {
  const t = useT("pipelines");
  const locale = useLocale();
  const reduced = useReducedMotionSafe();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const exp = useMemo(() => collapsed ?? new Set<string>(), [collapsed]);
  const built = useMemo(() => build(model, "", { inline, collapsed: exp, resolveChild }, 0), [model, inline, exp, resolveChild]);
  const flat = useMemo(() => flatten(built), [built]);
  const PAD = 28;
  const W = built.w + PAD * 2;
  const H = built.h + PAD * 2;
  // structure key: refit only when the graph shape changes (not on every live status update)
  const shapeKey = useMemo(() => flat.map((f) => `${f.path}:${Math.round(f.w)}x${Math.round(f.h)}`).join("|"), [flat]);

  const fit = useCallback(
    (animate = true) => {
      const svg = svgRef.current;
      const z = zoomRef.current;
      if (!svg || !z) return;
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // narrow screens: keep nodes legible (min scale) and let the user pan instead of shrinking to dots
      const minK = r.width < 700 ? 0.55 : 0.25;
      const k = Math.max(minK, Math.min(r.width / W, r.height / H, 1.15));
      const tx = W * k > r.width ? 8 : (r.width - W * k) / 2;
      const ty = H * k > r.height ? 8 : (r.height - H * k) / 2;
      const tr = zoomIdentity.translate(tx, ty).scale(k);
      const sel = select(svg);
      if (animate && !reduced) animated(sel, 420).call(z.transform as never, tr);
      else sel.call(z.transform, tr);
    },
    [W, H, reduced],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 3])
      .filter((ev: Event) => {
        if (ev.type === "wheel") return (ev as WheelEvent).ctrlKey || (ev as WheelEvent).metaKey;
        if (ev.type === "touchstart") return (ev as TouchEvent).touches.length >= 2;
        if (ev.type === "dblclick") return false;
        return !(ev as MouseEvent).button;
      })
      .on("zoom", (ev) => {
        gRef.current?.setAttribute("transform", ev.transform.toString());
      });
    zoomRef.current = z;
    select(svg).call(z);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => fit(false));
    return () => cancelAnimationFrame(id);
  }, [shapeKey, fit]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    let last = svg.getBoundingClientRect().width;
    const ro = new ResizeObserver(() => {
      const w = svg.getBoundingClientRect().width;
      if (Math.abs(w - last) > 24) {
        last = w;
        fit(false);
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);

  const zoomBy = (f: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    const sel = select(svg);
    if (reduced) sel.call(z.scaleBy, f);
    else animated(sel, 220).call(z.scaleBy as never, f);
  };

  const activate = (p: Placed) => {
    onSelect?.(p.path, p.node);
    if (p.node.kind !== "subpipeline") return;
    if (inline) onToggleExpand?.(p.path);
    else onDrill?.(p.path, p.node);
  };

  const onNodeKey = (e: KeyboardEvent<SVGGElement>, p: Placed) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      activate(p);
      return;
    }
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const me = flat.find((f) => f.path === p.path);
    if (!me) return;
    const cx = me.x + me.w / 2;
    const cy = me.y + me.h / 2;
    let best: { path: string; d: number } | null = null;
    for (const f of flat) {
      if (f.path === p.path) continue;
      const dx = f.x + f.w / 2 - cx;
      const dy = f.y + f.h / 2 - cy;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const d = along + across * 2.2;
      if (!best || d < best.d) best = { path: f.path, d };
    }
    if (best) e.currentTarget.ownerSVGElement?.querySelector<SVGGElement>(`[data-dag-node="${CSS.escape(best.path)}"]`)?.focus();
  };

  const onSvgKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(0.8);
    else if (e.key === "0") fit();
  };

  const renderNode = (p: Placed, depth: number): ReactNode => {
    const n = p.node;
    const tone = toneOf(n);
    const st = n.status ?? null;
    const meta = st ? NODE_STATUS_META[st] : null;
    const isSel = selected === p.path;
    const failed = st === "FAILED" || !!n.onFailPath;
    const dim = st === "SKIPPED" || st === "PENDING" || st === "CANCELLED";
    const pct = Math.max(0, Math.min(1, n.progress ?? 0));
    const stLabel = st ? statusLabel("node", st, locale) : null;
    const countsTxt = n.counts
      ? (["RUNNING", "SUCCEEDED", "FAILED", "PENDING"] as JobStatus[]).map((s) => `${statusLabel("node", s, locale)} ${n.counts?.[s] ?? 0}`).join(", ")
      : "";
    const aria = t("dag.nodeAria", {
      kind: n.kind === "subpipeline" ? t("dag.kindSub") : t("dag.kindComponent"),
      title: n.title,
      status: stLabel ?? countsTxt,
    });
    const common = {
      "data-dag-node": p.path,
      tabIndex: 0,
      role: "button" as const,
      "aria-label": aria + (n.kind === "subpipeline" ? " · " + (inline ? t("dag.hintExpand") : t("dag.hintDrill")) : ""),
      "aria-pressed": isSel,
      "aria-expanded": n.kind === "subpipeline" && inline ? !!p.child : undefined,
      className: clsx("dg-node", `tone-${tone}`, n.kind === "subpipeline" && "sub", failed && "failed", dim && "dim", isSel && "sel", n.hot && "hot", st === "RUNNING" && "run"),
      style: { ["--d" as string]: `${p.layer * 70 + depth * 40}ms` },
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        activate(p);
      },
      onKeyDown: (e: KeyboardEvent<SVGGElement>) => onNodeKey(e, p),
    };

    // ── expanded group (inline nested DAG) ──
    if (p.child) {
      return (
        <g key={p.path} transform={`translate(${p.x},${p.y})`}>
          <g {...common} className={clsx(common.className, "grp")}>
            <rect className="dg-grp" width={p.w} height={p.h} rx={3} />
            <rect className="dg-grp-head" width={p.w} height={30} rx={3} />
            <CatalogIcon name="layers" x={10} y={8} width={14} height={14} style={{ color: "var(--tc)" }} aria-hidden />
            <text className="dg-t" x={30} y={20}>
              {clip(n.title, Math.floor((p.w - 150) / 7.4))}
            </text>
            <text className="dg-m" x={p.w - 12} y={20} textAnchor="end">
              {n.refLabel ?? ""}
              {stLabel ? ` · ${stLabel}` : ""}
            </text>
          </g>
          <g transform={`translate(${G_PAD},${G_HEAD})`}>{renderLevel(p.child, depth + 1)}</g>
        </g>
      );
    }

    const w = p.w;
    const h = p.h;
    const maxTitle = Math.floor((w - 70) / 7.6);
    const c = n.counts;
    const total = c ? Object.values(c).reduce((s, v) => s + (v ?? 0), 0) : 0;
    const segs: { s: JobStatus; tone: Tone }[] = [
      { s: "SUCCEEDED", tone: "success" },
      { s: "RUNNING", tone: "running" },
      { s: "FAILED", tone: "failed" },
      { s: "CANCELLED", tone: "cancelled" },
      { s: "PENDING", tone: "queued" },
      { s: "SKIPPED", tone: "queued" },
    ];
    let acc = 0;
    return (
      <g key={p.path} transform={`translate(${p.x},${p.y})`}>
        <g {...common}>
          {n.kind === "subpipeline" ? (
            <>
              <rect className="dg-stack s2" x={8} y={8} width={w - 8} height={h - 8} rx={2} />
              <rect className="dg-stack s1" x={4} y={4} width={w - 8} height={h - 8} rx={2} />
            </>
          ) : null}
          {isSel ? <rect className="dg-selring" x={-6} y={-6} width={w + 12} height={h + 12} rx={4} /> : null}
          {n.heat ? <rect className="dg-heat" x={-5} y={-5} width={(n.kind === "subpipeline" ? w - 8 : w) + 10} height={(n.kind === "subpipeline" ? h - 8 : h) + 10} rx={5} style={{ opacity: 0.12 + n.heat * 0.55 }} /> : null}
          <g>
            <rect className="dg-b" width={n.kind === "subpipeline" ? w - 8 : w} height={n.kind === "subpipeline" ? h - 8 : h} rx={2} />
            <rect className="dg-bar" width={4} height={n.kind === "subpipeline" ? h - 8 : h} />
            {n.kind === "subpipeline" ? (
              <>
                <rect className="dg-subhead" x={4} y={0} width={w - 12} height={18} />
                <CatalogIcon name="layers" x={11} y={3} width={12} height={12} style={{ color: "var(--tc)" }} aria-hidden />
                <text className="dg-tag" x={27} y={13}>
                  {clip(n.refLabel ?? t("dag.kindSub"), 30)}
                </text>
                <g transform={`translate(${w - 30},2)`} className="dg-drill">
                  {inline ? <path d="M4,7 L11,7 M7.5,3.5 L7.5,10.5" /> : <path d="M5,3 L10,7 L5,11" />}
                </g>
              </>
            ) : null}
            {(() => {
              const y0 = n.kind === "subpipeline" ? 20 : 0;
              const iw = n.kind === "subpipeline" ? w - 8 : w;
              return (
                <>
                  <text className="dg-t" x={14} y={y0 + 20}>
                    {clip(n.title, maxTitle)}
                  </text>
                  {n.subtitle ? (
                    <text className="dg-st" x={iw - 10} y={y0 + 20} textAnchor="end">
                      {clip(n.subtitle, 10)}
                    </text>
                  ) : null}
                  {n.meta ? (
                    <text className="dg-m" x={14} y={y0 + 35}>
                      {clip(n.meta, Math.floor((iw - 24) / 6.4))}
                    </text>
                  ) : null}
                  {st && meta ? (
                    <>
                      <CatalogIcon name={meta.icon} x={13} y={y0 + 44} width={13} height={13} className={clsx(st === "RUNNING" && "dg-spin")} style={{ color: "var(--tc)" }} aria-hidden />
                      <text className="dg-s" x={31} y={y0 + 55}>
                        {stLabel}
                      </text>
                    </>
                  ) : c ? (
                    <text className="dg-cnt" x={14} y={y0 + 53}>
                      <tspan className="k">▶</tspan>
                      <tspan className="v r">{c.RUNNING ?? 0}</tspan>
                      <tspan className="k" dx={6}>
                        ✓
                      </tspan>
                      <tspan className="v s">{c.SUCCEEDED ?? 0}</tspan>
                      <tspan className="k" dx={6}>
                        ✕
                      </tspan>
                      <tspan className="v f">{c.FAILED ?? 0}</tspan>
                      <tspan className="k" dx={6}>
                        ◷
                      </tspan>
                      <tspan className="v">{(c.PENDING ?? 0) + (c.SKIPPED ?? 0) + (c.CANCELLED ?? 0)}</tspan>
                    </text>
                  ) : null}
                  {n.readout ? (
                    <text className={c ? "dg-r agg" : "dg-r"} x={c ? 14 : iw - 10} y={y0 + (c ? 69 : 55)} textAnchor={c ? "start" : "end"}>
                      {n.readout}
                    </text>
                  ) : null}
                  {c && total ? (
                    <g transform={`translate(14,${y0 + 76})`}>
                      {segs.map(({ s, tone: tn }) => {
                        const v = c[s] ?? 0;
                        if (!v) return null;
                        const sw = ((iw - 28) * v) / total;
                        const x = acc;
                        acc += sw;
                        return <rect key={s} x={x} y={0} width={Math.max(0, sw - 1)} height={4} fill={`var(--st-${tn})`} opacity={s === "SKIPPED" || s === "PENDING" ? 0.35 : 1} />;
                      })}
                    </g>
                  ) : st ? (
                    <>
                      <rect className="dg-pb" x={14} y={y0 + 64} width={iw - 28} height={3} />
                      <rect className={clsx("dg-pf", st === "RUNNING" && "run")} x={14} y={y0 + 64} width={(iw - 28) * (st === "SUCCEEDED" ? 1 : pct)} height={3} />
                    </>
                  ) : null}
                  {n.errorCode ? (
                    <text className="dg-err" x={14} y={y0 + (c ? 93 : 81)}>
                      {clip(n.errorCode, Math.floor((iw - 24) / 6.2))}
                    </text>
                  ) : null}
                </>
              );
            })()}
            {n.hot ? (
              <g transform={`translate(${(n.kind === "subpipeline" ? w - 8 : w) - 38},-9)`} className="dg-hot">
                <rect width={34} height={16} rx={2} />
                <text x={17} y={11.5} textAnchor="middle">
                  HOT
                </text>
              </g>
            ) : null}
          </g>
        </g>
      </g>
    );
  };

  const renderLevel = (b: Built, depth: number): ReactNode => (
    <>
      <g className="dg-edges">
        {b.edges.map(({ from, to }) => {
          const ts = to.node.status;
          const fs = from.node.status;
          const run = ts === "RUNNING" || (!ts && (to.node.counts?.RUNNING ?? 0) > 0);
          const fail = ts === "FAILED" || (to.node.onFailPath && (fs === "SUCCEEDED" || !fs));
          const skip = ts === "SKIPPED" || ts === "PENDING" || ts === "CANCELLED";
          const done = ts === "SUCCEEDED";
          return (
            <path
              key={from.path + ">" + to.path}
              className={clsx("dg-edge", run && "run", fail && "fail", skip && "skip", done && "done")}
              d={edgePath(from, to)}
              markerEnd={`url(#dg-arr-${fail ? "f" : run ? "r" : "n"})`}
            />
          );
        })}
      </g>
      {b.placed.map((p) => renderNode(p, depth))}
    </>
  );

  const hasSub = model.nodes.some((n) => n.kind === "subpipeline");
  return (
    <div className="dg-wrap" style={{ ["--dg-h" as string]: `${height}px` }}>
      <div className="dg-tools" role="toolbar" aria-label={t("dag.toolbar")}>
        {toolbar}
        <span className="dg-sp" />
        {hasSub && onInlineChange ? (
          <label className="dg-inline">
            <input type="checkbox" className="switch" checked={inline} onChange={(e) => onInlineChange(e.target.checked)} />
            <Layers aria-hidden />
            <span>{t("dag.inlineExpand")}</span>
          </label>
        ) : null}
        <div className="seg" role="group" aria-label={t("dag.zoomGroup")}>
          <button type="button" onClick={() => zoomBy(0.8)} aria-label={t("dag.zoomOut")} title={t("dag.zoomOut")}>
            <Minus aria-hidden />
          </button>
          <button type="button" onClick={() => fit()} aria-label={t("dag.fit")} title={t("dag.fit")}>
            <Maximize2 aria-hidden />
          </button>
          <button type="button" onClick={() => zoomBy(1.25)} aria-label={t("dag.zoomIn")} title={t("dag.zoomIn")}>
            <Plus aria-hidden />
          </button>
        </div>
      </div>
      <svg ref={svgRef} className="dg-svg" role="group" aria-label={label} aria-roledescription={t("dag.roleDesc")} onKeyDown={onSvgKey}>
        <defs>
          {(
            [
              ["n", "var(--ink-3)"],
              ["r", "var(--st-running)"],
              ["f", "var(--st-failed)"],
            ] as const
          ).map(([k, c]) => (
            <marker key={k} id={`dg-arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,1 L9,5 L0,9z" fill={c} />
            </marker>
          ))}
        </defs>
        <g ref={gRef}>
          <g transform={`translate(${PAD},${PAD})`}>{renderLevel(built, 0)}</g>
        </g>
      </svg>
      <div className="dg-foot">
        <span className="dg-hint">
          <ChevronRight aria-hidden />
          {t("dag.hint")}
        </span>
        {footer}
        <span className="mono muted dg-fmt">{t("dag.nodeCount", { count: flat.length })}</span>
      </div>
    </div>
  );
}
