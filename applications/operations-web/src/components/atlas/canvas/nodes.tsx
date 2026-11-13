"use client";
/**
 * Blueprint node bodies (SVG). Three levels of detail driven by zoom:
 *  - lod 0 (far):   title + one oversized readout per node, so a fit-all overview stays legible
 *  - lod 1 (normal): the full instrument panel (prototype parity, larger type)
 *  - lod 2 (near):  + per-language breakdowns, token IDs (rendered by the token layer)
 * The Vertex AI node shows the mix of pipelines running right now (counts per pipeline) and draws the
 * inner DAG of the selected pipeline (sub-pipeline calls as stacked frames), with a link to /pipelines.
 * Strings: orchestration.nodes.* (range-labelled counters) + pipelines.canvas.* (node bodies).
 */
import { useRouter } from "next/navigation";
import { memo, useMemo, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { CatalogIcon } from "@/components/shared";
import { failureCategoryLabel, stageLabel, type Locale } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { COMPONENTS, DAG_TEMPLATE, LANG_CODES, PIPELINE_BY_ID, PIPELINE_REGISTRY, STAGE_BY_ID } from "@/lib/catalog";
import type { LocaleFmt } from "@/lib/format";
import type { CapacitySnapshot, DeadLetter, PipelineDef, Replay, ResultFileMeta, StageId, Tone } from "@/lib/types";
import { layeredLayout } from "../dag/layout";
import { useQueryState } from "@/lib/client";
import { useRangeHref } from "../time-range";
import "@/styles/atlas-pipelines.css";
import { dagLayout, LANE_H, LANE_Y0, ROW, type Layout, type NodeBox, type NodeId, type Rect } from "./geometry";

export type Metrics = Partial<Record<StageId, Record<string, unknown>>>;

export interface NodeData {
  metrics: Metrics;
  capacity: CapacitySnapshot | null;
  replays: Replay[] | undefined;
  pending: DeadLetter[] | undefined;
  resultFile: ResultFileMeta | undefined;
  now: number;
  stageCounts: Partial<Record<StageId, number>> | undefined;
  /** localized label of the active period (e.g. "오늘 · 11월 13일 (금)"), optional */
  rangeLabel?: string;
  /** short label of the active period ("오늘" / "7d"), optional */
  rangeShort?: string;
}

type TP = ReturnType<typeof useT<"pipelines">>;
type TO = ReturnType<typeof useT<"orchestration">>;
interface Ctx {
  t: TP;
  to: TO;
  f: LocaleFmt;
  locale: Locale;
  range: string;
  toggle?: () => void;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/* ───────────── svg atoms ───────────── */
function T({ x, y, c = "n-txt", a, children, style }: { x: number; y: number; c?: string; a?: "start" | "middle" | "end"; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <text className={c} x={x} y={y} textAnchor={a} style={style}>
      {children}
    </text>
  );
}
const textW = (t: string) => 12 + [...t].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 11 : 6.6), 0);
function Badge({ xr, y, text, tone }: { xr: number; y: number; text: string; tone?: Tone | null }) {
  const w = textW(text);
  const c = tone ? `var(--st-${tone})` : "var(--ink)";
  return (
    <g transform={`translate(${xr - w},${y})`}>
      {y < 0 ? <path d={`M${w - 8},18 L${w - 8},22`} stroke={c} /> : null}
      <rect width={w} height={18} rx={2} fill={`color-mix(in srgb, ${c} 14%, var(--sheet))`} stroke={c} strokeWidth={1} />
      <text x={w / 2} y={12.8} textAnchor="middle" style={{ font: "500 10.5px var(--f-mono)", fill: c }}>
        {text}
      </text>
    </g>
  );
}
function KV({ y, k, v, w, tone }: { y: number; k: string; v: ReactNode; w: number; tone?: Tone | null }) {
  return (
    <>
      <T x={12} y={y}>
        {k}
      </T>
      <text className="n-val" x={w - 12} y={y} textAnchor="end" style={tone ? { fill: `var(--st-${tone})` } : undefined}>
        {v}
      </text>
    </>
  );
}
const Line = ({ y, w }: { y: number; w: number }) => <path d={`M12,${y} L${w - 12},${y}`} stroke="var(--rule-2)" />;

function Header({ n, stage, badge, icon, svc }: { n: NodeBox; stage: StageId; badge?: { text: string; tone?: Tone | null } | null; icon?: string; svc?: string }) {
  const st = STAGE_BY_ID[stage];
  return (
    <>
      <CatalogIcon name={icon ?? st.icon} x={12} y={13} width={17} height={17} strokeWidth={1.8} style={{ color: "var(--ink)" }} aria-hidden />
      <T x={37} y={27} c="n-title">
        {n.title}
      </T>
      <T x={37} y={42} c="n-svc">
        {(svc ?? st.gcpService).toUpperCase()}
      </T>
      {badge ? <Badge xr={n.w} y={-22} text={badge.text} tone={badge.tone} /> : null}
    </>
  );
}

/** lod-0 body: one big readout */
function Far({ n, value, label, tone }: { n: NodeBox; value: ReactNode; label: string; tone?: Tone | null }) {
  return (
    <>
      <text x={14} y={Math.min(n.h - 30, 104)} className="n-big" style={{ fontSize: 46, fill: tone ? `var(--st-${tone})` : "var(--ink)" }}>
        {value}
      </text>
      <T x={14} y={Math.min(n.h - 10, 130)} style={{ fontSize: 17, fontWeight: 600 }}>
        {label}
      </T>
    </>
  );
}

/* ───────────── Vertex AI: pipeline mix + inner DAG ───────────── */
type ByPipeline = Record<string, { kind: string; runs: number; running: number; succeeded: number; failed: number; successRate: number | null; avgDurationSec: number; runningByNode: Record<string, number> }>;
const SHORT: Record<string, string> = {
  "bixby-eval-full": "full",
  "bixby-eval-quick": "quick",
  "bixby-regression-nightly": "nightly",
  "tts-quality": "tts",
  "asr-eval": "asr",
  "nlu-eval": "nlu",
  "response-judge": "judge",
  "policy-guard": "guard",
};
const shortId = (id: string) => SHORT[id] ?? id;
const PIPE_COLORS = ["var(--cost-1)", "var(--cost-2)", "var(--cost-3)", "var(--cost-4)", "var(--cost-5)", "var(--cost-6)", "var(--accent-2)", "var(--cost-7)"];
const pipeColor = (id: string) => PIPE_COLORS[Math.max(0, PIPELINE_REGISTRY.findIndex((p) => p.id === id)) % PIPE_COLORS.length];

function liveVersion(p: PipelineDef) {
  const live = p.versions.filter((v) => v.status !== "DEPRECATED");
  return live[live.length - 1] ?? p.versions[p.versions.length - 1];
}
const nodeLabel = (n: PipelineDef["versions"][number]["nodes"][number]) =>
  n.label ?? (n.kind === "component" ? (COMPONENTS[n.component]?.label ?? n.component) : (PIPELINE_BY_ID[n.ref.pipeline]?.label ?? n.ref.pipeline));

/** root pipeline whose live version maps 1:1 onto the legacy phases (preprocess … persist) */
function onLegacyPhases(p: PipelineDef): boolean {
  const phases = liveVersion(p).nodes.map((x) => x.legacyPhase);
  return p.kind === "root" && phases.every(Boolean) && new Set(phases).size === phases.length;
}
/** …and covers EVERY legacy phase, so each batch token (positioned by phase) lands on a drawn box */
function coversAllPhases(p: PipelineDef): boolean {
  return onLegacyPhases(p) && liveVersion(p).nodes.length === DAG_TEMPLATE.length;
}

/**
 * Which pipeline the expanded Vertex AI node draws (?pipeline= on the canvas URL, else the busiest
 * root) and whether its inner DAG occupies every legacy phase slot. Batch tokens (SSE tick) only carry
 * a legacy `current_node`, so the canvas draws them inside Vertex only when `aligned`; otherwise
 * (sub-pipelines, or a root such as quick that skips phases) it hides them and the node shows
 * per-node running count badges instead.
 */
export function vertexPick(byPipeline: unknown, picked: string | null): { sel: string | undefined; aligned: boolean } {
  const by = (byPipeline ?? {}) as ByPipeline;
  const roots = PIPELINE_REGISTRY.filter((p) => p.kind === "root");
  const valid = picked && PIPELINE_BY_ID[picked] ? picked : null;
  const busiest = [...roots].sort((a, b) => (by[b.id]?.running ?? 0) - (by[a.id]?.running ?? 0))[0]?.id;
  const sel = valid ?? busiest ?? roots[0]?.id;
  const def = sel ? PIPELINE_BY_ID[sel] : undefined;
  return { sel, aligned: !!def && coversAllPhases(def) };
}

/** inner DAG boxes inside the node frame; root nodes reuse the legacy-phase slots when they map 1:1 so batch tokens line up */
function innerBoxes(p: PipelineDef, frame: Rect, n: NodeBox): Record<string, Rect> {
  const v = liveVersion(p);
  const legacy = dagLayout(n);
  if (onLegacyPhases(p)) return Object.fromEntries(v.nodes.map((x) => [x.id, legacy[x.legacyPhase!]]));
  const L = layeredLayout(
    v.nodes.map((x) => ({ id: x.id, deps: x.deps, w: 120, h: 54 })),
    { colGap: 30, rowGap: 14 },
  );
  const k = Math.min(1, (frame.w - 20) / Math.max(1, L.width), (frame.h - 26) / Math.max(1, L.height));
  const ox = frame.x + (frame.w - L.width * k) / 2;
  const oy = frame.y + 18 + (frame.h - 18 - L.height * k) / 2;
  return Object.fromEntries(Object.entries(L.boxes).map(([id, b]) => [id, { x: ox + b.x * k, y: oy + b.y * k, w: b.w * k, h: b.h * k }]));
}

/** a focusable SVG control that does not start a canvas drag (the canvas pans on pointerdown) */
function SvgBtn({ x, y, w, h, label, pressed, onAct, children, className }: { x: number; y: number; w: number; h: number; label: string; pressed?: boolean; onAct: () => void; children: ReactNode; className?: string }) {
  return (
    <g
      className={className}
      transform={`translate(${x},${y})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={pressed}
      style={{ cursor: "pointer" }}
      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
      onPointerUp={(e: PointerEvent) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onAct();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onAct();
        }
      }}
    >
      <rect width={w} height={h} rx={2} className="vx-btn" />
      {children}
    </g>
  );
}

function VertexBody({ n, d, lod, expanded, c }: { n: NodeBox; d: NodeData; lod: number; expanded: boolean; c: Ctx }) {
  const { t, f } = c;
  const router = useRouter();
  const rh = useRangeHref();
  const x = d.metrics.vertex ?? {};
  const by = useMemo(() => (x.byPipeline ?? {}) as ByPipeline, [x.byPipeline]);
  const running = num(x.running);
  const rr = num(d.metrics.retry?.retryRate);
  const W = n.w;
  const roots = PIPELINE_REGISTRY.filter((p) => p.kind === "root");
  const subs = PIPELINE_REGISTRY.filter((p) => p.kind === "sub");
  // selection lives in the URL so the canvas (token layer) and this node agree on it
  const [picked, setPicked] = useQueryState("pipeline");
  const { sel, aligned } = useMemo(() => vertexPick(by, picked), [by, picked]);
  const def = sel ? PIPELINE_BY_ID[sel] : undefined;
  const openHref = rh(`/pipelines/${encodeURIComponent(sel ?? "")}`);
  const open = () => router.push(openHref);

  const toggleEl = (
    <g
      data-toggle="vertex"
      role="button"
      tabIndex={0}
      aria-label={expanded ? t("canvas.dagCollapse") : t("canvas.dagExpand")}
      style={{ cursor: "pointer" }}
      transform={`translate(${W - 100},14)`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          c.toggle?.();
        }
      }}
    >
      <rect width={88} height={20} rx={2} fill="var(--sheet-2)" stroke="var(--rule)" />
      <text x={44} y={14} textAnchor="middle" style={{ font: "500 10.5px var(--f-mono)", fill: "var(--accent)" }}>
        {expanded ? t("canvas.dagCollapse") : t("canvas.dagExpand")}
      </text>
    </g>
  );

  if (lod === 0)
    return (
      <>
        <Header n={n} stage="vertex" />
        <Far n={n} value={running} label={t("canvas.runningFar")} tone="running" />
      </>
    );

  const badgeText = t("canvas.runningBadge", { count: running });
  const footer = (
    <>
      <Line y={n.h - 36} w={W} />
      <T x={12} y={n.h - 16} c="n-mono">
        {t("canvas.vertexFooter", {
          gpu: `${num(x.gpuInUse)}/${num(x.gpuQuota)}`,
          utt: f.number(num(x.utterancesInFlight)),
          avg: f.duration(num(x.avgDurationSec) * 1000, { style: "short" }),
          children: num(x.runningChildJobs),
        })}
      </T>
      <SvgBtn x={W - 132} y={n.h - 30} w={120} h={20} label={t("canvas.openInPipelinesAria", { id: sel ?? "" })} onAct={open} className="vx-link">
        <text x={60} y={14} textAnchor="middle" style={{ font: "600 10.5px var(--f-mono)", fill: "var(--accent)" }}>
          {t("canvas.openInPipelines")} ↗
        </text>
      </SvgBtn>
    </>
  );

  if (!expanded) {
    // compact: token slot + per-pipeline running counts
    const list = roots.map((p) => ({ id: p.id, k: by[p.id]?.running ?? 0 }));
    const max = Math.max(1, ...list.map((l) => l.k));
    return (
      <>
        <Header n={n} stage="vertex" badge={{ text: badgeText, tone: "running" }} />
        <Badge xr={W - textW(badgeText) - 6} y={-22} text={t("canvas.retryRate", { pct: f.pct(rr, 1) })} tone={rr > 0.12 ? "failed" : null} />
        {toggleEl}
        <rect x={12} y={58} width={W - 24} height={64} className="slot" strokeDasharray="3 3" />
        {list.map((l, i) => {
          const cx = 12 + i * ((W - 24) / list.length);
          const cw = (W - 24) / list.length - 8;
          return (
            <g key={l.id}>
              <text className="n-mono" x={cx + 2} y={140} style={{ fontSize: 9.5 }}>
                {shortId(l.id)}
              </text>
              <text className="n-val" x={cx + 2} y={158} style={{ fill: l.k ? "var(--st-running)" : undefined }}>
                {l.k}
              </text>
              <rect x={cx + 2} y={164} width={cw} height={3} fill="var(--paper-2)" />
              <rect x={cx + 2} y={164} width={(cw * l.k) / max} height={3} fill={pipeColor(l.id)} style={{ transition: "width .5s" }} />
            </g>
          );
        })}
        {footer}
      </>
    );
  }

  // expanded: inner DAG of the selected pipeline + pipeline selector
  const frame: Rect = { x: 12, y: 54, w: W - 24, h: n.h - 54 - 74 };
  const boxes = def ? innerBoxes(def, frame, n) : {};
  const v = def ? liveVersion(def) : undefined;
  const rbn = (sel && by[sel]?.runningByNode) || {};
  const chipsY = n.h - 66;
  const all = [...roots, ...subs];
  const chipW = (W - 24 - (all.length - 1) * 4) / all.length;
  return (
    <>
      <Header n={n} stage="vertex" badge={{ text: badgeText, tone: "running" }} />
      <Badge xr={W - textW(badgeText) - 6} y={-22} text={t("canvas.retryRate", { pct: f.pct(rr, 1) })} tone={rr > 0.12 ? "failed" : null} />
      {toggleEl}
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="none" stroke="var(--rule)" strokeDasharray="4 3" />
      <T x={frame.x + 6} y={frame.y + 12} c="n-tag" style={{ fontSize: 9 }}>
        {t("canvas.innerDag", { id: sel ?? "", version: v?.version ?? "" })}
      </T>
      {!aligned ? (
        <T x={frame.x + frame.w - 6} y={frame.y + frame.h - 6} c="n-tag" a="end" style={{ fontSize: 9, fill: "var(--ink-3)" }}>
          {t("canvas.tokensHidden", { count: running })}
        </T>
      ) : null}
      {v
        ? v.nodes.flatMap((nd) =>
            nd.deps.map((p) => {
              const a = boxes[p];
              const b = boxes[nd.id];
              if (!a || !b) return null;
              const ax = a.x + a.w;
              const ay = a.y + a.h / 2;
              const bx = b.x;
              const by2 = b.y + b.h / 2;
              const on = (rbn[nd.id] ?? 0) > 0;
              return <path key={p + nd.id} className={on ? "dedge on" : "dedge"} d={`M${ax},${ay} C${ax + 20},${ay} ${bx - 20},${by2} ${bx},${by2}`} />;
            }),
          )
        : null}
      {v
        ? v.nodes.map((nd) => {
            const b = boxes[nd.id];
            if (!b) return null;
            const k = rbn[nd.id] ?? 0;
            const sub = nd.kind === "subpipeline";
            const meta = nd.kind === "component" ? COMPONENTS[nd.component] : null;
            return (
              <g key={nd.id}>
                {sub ? (
                  <>
                    <rect className="dagn" x={b.x + 6} y={b.y + 6} width={b.w - 6} height={b.h - 6} opacity={0.5} />
                    <rect className="dagn" x={b.x + 3} y={b.y + 3} width={b.w - 6} height={b.h - 6} opacity={0.75} />
                  </>
                ) : null}
                <rect className={k ? "dagn on" : "dagn"} x={b.x} y={b.y} width={sub ? b.w - 6 : b.w} height={sub ? b.h - 6 : b.h} />
                <text x={b.x + 7} y={b.y + 16} style={{ font: "700 12px var(--f-ui)", fill: "var(--ink)", letterSpacing: "-0.02em" }}>
                  {nodeLabel(nd).slice(0, Math.max(6, Math.floor((b.w - 30) / 6.6)))}
                </text>
                <text x={b.x + 7} y={b.y + 29} style={{ font: "400 9.5px var(--f-mono)", fill: sub ? "var(--accent)" : "var(--ink-3)" }}>
                  {sub ? `⧉ ${nd.ref.pipeline}@${nd.ref.version}`.slice(0, Math.floor((b.w - 12) / 5.8)) : `${meta?.machineType ?? ""}${meta?.gpu ? " · L4" : ""}`}
                </text>
                {!aligned && k > 0 ? (
                  // tokens are hidden on non-phase DAGs: a filled count badge marks where batches are
                  <g className="vx-nbadge" transform={`translate(${b.x + (sub ? b.w - 6 : b.w) - 4},${b.y - 7})`}>
                    <title>{t("canvas.nodeRunning", { count: k })}</title>
                    <rect x={-(14 + String(k).length * 7)} y={0} width={14 + String(k).length * 7} height={15} rx={7.5} fill="var(--st-running)" />
                    <text x={-(7 + String(k).length * 3.5)} y={11} textAnchor="middle" style={{ font: "700 10px var(--f-mono)", fill: "var(--sheet)" }}>
                      {k}
                    </text>
                  </g>
                ) : (
                  <text x={b.x + (sub ? b.w - 6 : b.w) - 6} y={b.y + 16} textAnchor="end" style={{ font: "600 12px var(--f-mono)", fill: k ? "var(--st-running)" : "var(--ink-3)" }}>
                    {k}
                  </text>
                )}
                {lod === 2 && meta ? (
                  <text x={b.x + 7} y={b.y + b.h + 11} style={{ font: "400 8px var(--f-mono)", fill: "var(--ink-3)" }}>
                    {meta.image}
                  </text>
                ) : null}
              </g>
            );
          })
        : null}
      <g role="group" aria-label={t("canvas.pickerAria")}>
        {all.map((p, i) => {
          const k = by[p.id]?.running ?? 0;
          const on = p.id === sel;
          return (
            <SvgBtn key={p.id} x={12 + i * (chipW + 4)} y={chipsY} w={chipW} h={24} label={t("canvas.pickAria", { id: p.id, count: k })} pressed={on} onAct={() => setPicked(p.id)} className={on ? "vx-chip on" : "vx-chip"}>
              <rect x={0} y={0} width={3} height={24} fill={pipeColor(p.id)} />
              <text x={8} y={16} style={{ font: `${on ? 700 : 500} 10.5px var(--f-mono)`, fill: on ? "var(--ink)" : "var(--ink-2)" }}>
                {p.kind === "sub" ? "⧉" : ""}
                {shortId(p.id)}
              </text>
              <text x={chipW - 6} y={16} textAnchor="end" style={{ font: "600 11px var(--f-mono)", fill: k ? "var(--st-running)" : "var(--ink-3)" }}>
                {k}
              </text>
            </SvgBtn>
          );
        })}
      </g>
      {footer}
    </>
  );
}

/* ───────────── per-node bodies ───────────── */
function body(id: NodeId, n: NodeBox, d: NodeData, lod: number, expanded: boolean, c: Ctx): ReactNode {
  const { t, to, f, locale, range } = c;
  const m = (s: StageId) => d.metrics[s] ?? {};
  const W = n.w;
  switch (id) {
    case "gcs_input": {
      const x = m("gcs_input");
      const by = (x.byLanguage ?? {}) as Record<string, number>;
      if (lod === 0) return <><Header n={n} stage="gcs_input" /><Far n={n} value={f.number(num(x.objectsToday))} label={to("nodes.uploadedObjects", { range })} /></>;
      return (
        <>
          <Header n={n} stage="gcs_input" badge={{ text: "+" + num(x.objectsToday) }} />
          {(
            [
              ["GCS", "Object Finalized", "upload-cloud"],
              ["API", "POST /events", "send"],
              ["Scheduler", "cron", "clock"],
            ] as const
          ).map((p, i) => (
            <g key={p[0]} transform={`translate(12,${54 + i * 25})`}>
              <rect width={W - 24} height={21} fill="var(--sheet-2)" stroke="var(--rule-2)" />
              <CatalogIcon name={p[2]} x={5} y={3.5} width={14} height={14} style={{ color: "var(--ink-2)" }} aria-hidden />
              <text className="n-txt" x={24} y={15} style={{ fontWeight: 700, fill: "var(--ink)", fontSize: 12.5 }}>
                {p[0]}
              </text>
              <text className="n-mono" x={W - 30} y={15} textAnchor="end" style={{ fontSize: 11 }}>
                {p[1]}
              </text>
            </g>
          ))}
          <Line y={136} w={W} />
          <KV y={156} k={to("nodes.uploaded", { range })} v={`${f.number(num(x.objectsToday))} obj`} w={W} />
          <KV y={156 + ROW} k={t("canvas.utterances")} v={f.number(num(x.utterancesToday))} w={W} />
          <KV y={156 + ROW * 2} k={t("canvas.lastUpload")} v={x.lastUploadAt ? f.relative(num(x.lastUploadAt), d.now) : "—"} w={W} />
          {lod === 2 ? (
            <T x={12} y={n.h + 16} c="n-lod">
              {LANG_CODES.map((cc) => `${cc.toUpperCase()} ${by[cc] ?? 0}`).join(" · ")}
            </T>
          ) : null}
        </>
      );
    }
    case "event_bus": {
      const x = m("event_bus");
      const re = num(x.redeliveriesToday);
      if (lod === 0) return <><Header n={n} stage="event_bus" /><Far n={n} value={f.number(num(x.deliveredToday))} label={to("nodes.delivered", { range })} /></>;
      return (
        <>
          <Header n={n} stage="event_bus" badge={re ? { text: t("canvas.redelivered", { count: re }), tone: "retry" } : null} />
          <T x={12} y={64} c="n-mono" style={{ fontSize: 11.5 }}>
            topic pipeline-batch-requested
          </T>
          <Line y={76} w={W} />
          <KV y={96} k={to("nodes.delivered", { range })} v={f.number(num(x.deliveredToday))} w={W} />
          <KV y={96 + ROW} k={t("canvas.deliveryP95")} v={f.duration(num(x.p95DeliveryLatencyMs), { style: "short" })} w={W} />
          <KV y={96 + ROW * 2} k={t("canvas.subBacklog")} v={f.number(num(x.subscriptionBacklog))} w={W} />
          <KV y={96 + ROW * 3} k={t("canvas.dltMessages")} v={f.number(num(x.deadLetterTopicMessages))} w={W} tone={num(x.deadLetterTopicMessages) ? "dlq" : null} />
        </>
      );
    }
    case "ingress": {
      const x = m("ingress");
      const k = d.stageCounts?.ingress ?? 0;
      if (lod === 0) return <><Header n={n} stage="ingress" /><Far n={n} value={k} label={t("canvas.ingressFar")} tone={k ? "running" : null} /></>;
      return (
        <>
          <Header n={n} stage="ingress" badge={{ text: t("canvas.processing", { count: k }), tone: k ? "running" : null }} />
          {["Schema Validation", "Event Deduplication", "Idempotency Key"].map((s, i) => (
            <g key={s} transform={`translate(12,${54 + i * 19})`}>
              <CatalogIcon name="check" x={0} y={0} width={13} height={13} strokeWidth={2.4} style={{ color: "var(--st-success)" }} aria-hidden />
              <T x={19} y={11}>
                {s}
              </T>
            </g>
          ))}
          <T x={14} y={124} c="n-tag">
            RECEIVED · VALIDATED
          </T>
          <rect x={12} y={130} width={W - 24} height={32} className="slot" strokeDasharray="3 3" />
          <Line y={174} w={W} />
          <KV y={193} k={t("canvas.receivedValidated")} v={`${num(x.receivedToday)} / ${num(x.validatedToday)}`} w={W} />
          <KV y={193 + ROW} k={t("canvas.duplicates")} v={f.number(num(x.duplicatesIgnoredToday))} w={W} tone={num(x.duplicatesIgnoredToday) ? "queued" : null} />
          <KV y={193 + ROW * 2} k={t("canvas.registerP95")} v={f.duration(num(x.p95RegistrationLatencyMs), { style: "short" })} w={W} />
        </>
      );
    }
    case "registry_queue": {
      const x = m("registry_queue");
      const by = (x.byLanguage ?? {}) as Record<string, number>;
      const q = num(x.queued);
      if (lod === 0) return <><Header n={n} stage="registry_queue" /><Far n={n} value={q} label={t("canvas.queueFar")} tone={q ? "queued" : null} /></>;
      return (
        <>
          <Header n={n} stage="registry_queue" badge={{ text: `${q} QUEUED`, tone: q ? "queued" : null }} />
          <T x={12} y={60} c="n-mono" style={{ fontSize: 10.5 }}>
            event_registry · workflows/{"{id}"} · pending_jobs/{"{lang}"}
          </T>
          {LANG_CODES.map((cc, i) => {
            const y = LANE_Y0 + i * LANE_H;
            const L = d.capacity?.languages.find((l) => l.code === cc);
            const qn = by[cc] ?? 0;
            return (
              <g key={cc}>
                <rect x={12} y={y} width={W - 24} height={30} fill="var(--sheet-2)" stroke="var(--rule-2)" />
                <rect x={12} y={y} width={3} height={30} fill={`var(--lg-${cc})`} />
                <text className="n-mono" x={21} y={y + 13} style={{ fontWeight: 600, fill: "var(--ink)" }}>
                  {cc.toUpperCase()}
                </text>
                <text className="n-mono" x={21} y={y + 25} style={{ fontSize: 9.5 }}>
                  {t("canvas.waiting", { count: qn })}
                  {L?.paused ? ` · ${t("canvas.paused")}` : ""}
                </text>
                {L && qn >= L.backlogAlertThreshold ? <Badge xr={W - 14} y={y + 6} text={t("canvas.threshold", { count: L.backlogAlertThreshold })} tone="retry" /> : null}
              </g>
            );
          })}
          <Line y={222} w={W} />
          <KV y={241} k={t("canvas.oldestWait")} v={x.oldestQueuedAt ? f.relative(num(x.oldestQueuedAt), d.now) : t("canvas.noWait")} w={W} />
          <KV y={241 + ROW} k={t("canvas.waitP95")} v={f.duration(num(x.p95WaitSec) * 1000, { style: "short" })} w={W} tone={num(x.p95WaitSec) > 900 ? "retry" : null} />
        </>
      );
    }
    case "scheduler": {
      const x = m("scheduler");
      const cap = d.capacity;
      const g = cap?.global;
      if (lod === 0)
        return (
          <>
            <Header n={n} stage="scheduler" />
            <Far n={n} value={g ? `${g.active}/${g.max}` : "—"} label={t("canvas.globalSlots")} tone={g && g.utilization > 0.9 ? "retry" : null} />
          </>
        );
      return (
        <>
          <Header n={n} stage="scheduler" badge={g ? { text: `${g.active}/${g.max}`, tone: g.utilization > 0.9 ? "retry" : null } : null} />
          <T x={12} y={60} c="n-mono" style={{ fontSize: 10.5 }}>
            Admission · Per-language · Global · Priority
          </T>
          {(cap?.languages ?? []).map((L, i) => {
            const y = LANE_Y0 + i * LANE_H;
            const u = Math.min(1, L.active / Math.max(1, L.max));
            const tone: Tone | null = L.status === "SATURATED" || L.status === "BACKLOGGED" ? "retry" : L.status === "PAUSED" || L.status === "DISABLED" ? "cancelled" : null;
            const bw = W - 24 - 80;
            return (
              <g key={L.code}>
                <rect x={12} y={y} width={W - 24} height={30} fill="var(--sheet-2)" stroke="var(--rule-2)" />
                <circle cx={W - 12} cy={y + 15} r={4} fill={`var(--lg-${L.code})`} stroke="var(--sheet)" strokeWidth={1.5} />
                <text className="n-mono" x={18} y={y + 13} style={{ fontWeight: 600, fill: "var(--ink)" }}>
                  {L.code.toUpperCase()}
                </text>
                <text className="n-mono" x={76} y={y + 13} textAnchor="end" style={{ fontSize: 11, fontWeight: 600, fill: tone ? `var(--st-${tone})` : "var(--ink)" }}>
                  {L.active}/{L.max}
                </text>
                <rect className="port-bar" x={18} y={y + 19} width={56} height={4} />
                <rect className="port-fill" x={18} y={y + 19} width={56 * u} height={4} fill={tone ? `var(--st-${tone})` : `var(--lg-${L.code})`} />
                <rect x={80} y={y + 4} width={bw - 4} height={22} className="slot" strokeDasharray="2 3" />
                {L.status !== "OK" ? (
                  <text className="n-tag" x={80 + bw - 8} y={y + 28} textAnchor="end" style={{ fill: tone ? `var(--st-${tone})` : "var(--ink-3)", fontSize: 8 }}>
                    {L.status}
                  </text>
                ) : null}
              </g>
            );
          })}
          <Line y={222} w={W} />
          <KV y={241} k="Global Active" v={g ? `${g.active} / ${g.max} (${f.pct(g.utilization, 0)})` : "—"} w={W} />
          <KV y={241 + ROW} k={t("canvas.admissions1h")} v={`${num(x.admissionsLastHour)} · ${num(x.reservationsOrphaned)}`} w={W} tone={num(x.reservationsOrphaned) ? "failed" : null} />
        </>
      );
    }
    case "workflows": {
      const x = m("workflows");
      const disp = num(x.dispatching);
      if (lod === 0) return <><Header n={n} stage="workflows" /><Far n={n} value={f.number(num(x.executionsToday))} label={to("nodes.executions", { range })} /></>;
      return (
        <>
          <Header n={n} stage="workflows" badge={disp ? { text: `${disp} DISPATCH`, tone: "running" } : null} />
          {["Pipeline Start", "Completion Monitor", "Error Handling", "Failure Routing"].map((s, i) => (
            <T key={s} x={12 + (i % 2) * 126} y={62 + Math.floor(i / 2) * 16} style={{ fontSize: 11 }}>
              · {s}
            </T>
          ))}
          <T x={14} y={98} c="n-tag">
            DISPATCHING
          </T>
          <rect x={12} y={102} width={W - 24} height={32} className="slot" strokeDasharray="3 3" />
          <Line y={146} w={W} />
          <KV y={165} k={to("nodes.executionsRun", { range })} v={f.number(num(x.executionsToday))} w={W} />
          <KV y={165 + ROW} k={t("canvas.cancelTimeout")} v={`${num(x.cancelledToday)} · ${num(x.timedOut7d)}`} w={W} tone={num(x.timedOut7d) ? "failed" : null} />
          <KV y={165 + ROW * 2} k={t("canvas.startP95")} v={f.duration(num(x.p95StartLatencyMs), { style: "short" })} w={W} />
        </>
      );
    }
    case "vertex":
      return <VertexBody n={n} d={d} lod={lod} expanded={expanded} c={c} />;
    case "results": {
      const x = m("results");
      const pr = num(x.passRateToday);
      const s = num(x.succeededToday);
      if (lod === 0) return <><Header n={n} stage="results" /><Far n={n} value={s} label={`${to("nodes.succeeded", { range })} · pass ${f.pct(pr, 1)}`} tone="success" /></>;
      return (
        <>
          <Header n={n} stage="results" badge={{ text: "+" + s, tone: "success" }} />
          <T x={12} y={62} c="n-tag">
            SUCCEEDED · {range}
          </T>
          <text className="n-big" x={12} y={94} style={{ fill: "var(--st-success)" }}>
            {s}
          </text>
          <T x={W - 12} y={76} c="n-mono" a="end">
            pass rate
          </T>
          <text className="n-val" x={W - 12} y={94} textAnchor="end" style={{ fontSize: 16 }}>
            {f.pct(pr, 1)}
          </text>
          <rect x={12} y={104} width={W - 24} height={6} fill="var(--paper-2)" />
          <rect x={12} y={104} width={(W - 24) * pr} height={6} fill="var(--st-success)" />
          <rect x={12 + (W - 24) * pr} y={104} width={(W - 24) * (1 - pr)} height={6} fill="var(--st-failed)" opacity={0.75} />
          <Line y={124} w={W} />
          <KV y={143} k={t("canvas.rowsWritten")} v={f.number(num(x.rowsWrittenToday))} w={W} />
          <KV y={143 + ROW} k={t("canvas.csvSize")} v={f.bytes(num(x.csvBytesToday))} w={W} />
          <T x={12} y={186} c="n-mono" style={{ fill: "var(--st-success)", fontSize: 10.5 }}>
            → Completion Event · WORKFLOW_COMPLETED
          </T>
        </>
      );
    }
    case "res_csv": {
      const fl = d.resultFile?.file;
      return (
        <>
          <T x={10} y={22} c="n-title" style={{ fontSize: 13 }}>
            GCS · results.csv
          </T>
          <T x={10} y={38} c="n-svc">
            gs://bixby-eval-results
          </T>
          <T x={10} y={60} c="n-val">
            {fl ? `${f.number(fl.rowCount)} rows` : "—"}
          </T>
          <T x={10} y={78} c="n-mono">
            {fl ? f.bytes(fl.sizeBytes) : ""}
          </T>
        </>
      );
    }
    case "res_bq": {
      const b = d.resultFile?.bigquery;
      return (
        <>
          <T x={10} y={22} c="n-title" style={{ fontSize: 13 }}>
            BigQuery
          </T>
          <T x={10} y={38} c="n-svc">
            bixby_eval.utterance_results
          </T>
          <T x={10} y={60} c="n-val">
            {b ? `${f.number(b.rows)} rows` : "—"}
          </T>
          <T x={10} y={78} c="n-mono">
            streaming insert
          </T>
        </>
      );
    }
    case "retry": {
      const x = m("retry");
      const rw = num(x.retryWait);
      const pol = (x.policy ?? {}) as { backoffSeconds?: number[] };
      const bo = pol.backoffSeconds?.length ? pol.backoffSeconds.map((s) => s + "s").join(" → ") : "60s → 300s";
      if (lod === 0) return <><Header n={n} stage="retry" /><Far n={n} value={rw} label="RETRY_WAIT" tone={rw ? "retry" : null} /></>;
      return (
        <>
          <Header n={n} stage="retry" badge={{ text: `${rw} WAIT`, tone: rw ? "retry" : null }} />
          <T x={12} y={62} c="n-mono">
            Attempts &lt; 3 ? Re-run : DLQ
          </T>
          <rect x={12} y={74} width={W - 24} height={42} className="slot" strokeDasharray="3 3" />
          <T x={14} y={130} c="n-tag">
            RETRY_WAIT · backoff {bo}
          </T>
          <Line y={140} w={W} />
          <KV y={159} k={to("nodes.retries", { range })} v={f.number(num(x.retriesToday))} w={W} />
          <KV y={159 + ROW} k={t("canvas.retryRatio")} v={f.pct(num(x.retryRate), 1)} w={W} tone={num(x.retryRate) > 0.12 ? "retry" : null} />
          <KV y={159 + ROW * 2} k={t("canvas.nextRetry")} v={x.nextRetryAt ? f.relative(num(x.nextRetryAt), d.now) : "—"} w={W} />
        </>
      );
    }
    case "dlq": {
      const x = m("dlq");
      const pend = num(x.pendingReview);
      const cats = Object.entries((x.byCategory ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
      if (lod === 0) return <><Header n={n} stage="dlq" /><Far n={n} value={pend} label={t("canvas.dlqFar")} tone={pend ? "dlq" : null} /></>;
      return (
        <>
          <Header n={n} stage="dlq" badge={{ text: t("canvas.reviewBadge", { count: pend }), tone: pend ? "dlq" : null }} />
          <T x={12} y={62} c="n-mono">
            topic pipeline-dead-letter
          </T>
          <rect x={12} y={74} width={W - 24} height={42} className="slot" strokeDasharray="3 3" />
          <Line y={128} w={W} />
          <KV y={147} k={t("canvas.totalPending")} v={`${num(x.total)} / ${pend}`} w={W} tone={pend ? "dlq" : null} />
          {cats.slice(0, 3).map(([cat, v], i) => (
            <KV key={cat} y={147 + ROW * (i + 1)} k={failureCategoryLabel(cat, locale)} v={v} w={W} />
          ))}
        </>
      );
    }
    case "dlq_mgr": {
      const x = m("dlq");
      const bs = (x.byStatus ?? {}) as Record<string, number>;
      const pend = d.pending ?? [];
      const assigned = pend.filter((p) => p.assigned_operator).length;
      if (lod === 0) return <><Header n={n} stage="dlq" svc="Cloud Run · dlq-manager" /><Far n={n} value={bs.REPLAYING ?? 0} label={t("canvas.replaying")} tone="running" /></>;
      return (
        <>
          <Header n={n} stage="dlq" svc="Cloud Run · dlq-manager" />
          <T x={12} y={64}>
            {t("canvas.dlqPolicy1")}
          </T>
          <T x={12} y={82}>
            {t("canvas.dlqPolicy2")}
          </T>
          <Line y={94} w={W} />
          <KV y={113} k={t("canvas.pendingAssigned")} v={`${pend.length} · ${assigned}`} w={W} tone={pend.length ? "dlq" : null} />
          <KV y={113 + ROW} k={t("canvas.closed")} v={bs.CLOSED ?? 0} w={W} />
          <KV y={113 + ROW * 2} k={t("canvas.replaying")} v={bs.REPLAYING ?? 0} w={W} tone="running" />
        </>
      );
    }
    case "replay": {
      const r = d.replays ?? [];
      const last = r[0];
      if (lod === 0)
        return (
          <>
            <Header n={n} stage="dlq" icon="refresh-cw" svc="Pub/Sub · replay.requested" />
            <Far n={n} value={r.length} label={t("canvas.replayTotal")} tone="retry" />
          </>
        );
      return (
        <>
          <Header n={n} stage="dlq" icon="refresh-cw" svc="Pub/Sub · replay.requested" badge={{ text: t("canvas.times", { count: r.length }), tone: "retry" }} />
          <KV y={68} k={t("canvas.succFail")} v={`${r.filter((x) => x.status === "SUCCEEDED").length} / ${r.filter((x) => x.status === "FAILED").length}`} w={W} />
          <KV y={68 + ROW} k={t("canvas.inProgress")} v={r.filter((x) => ["APPROVED", "QUEUED", "RUNNING"].includes(x.status)).length} w={W} tone="running" />
          {last ? (
            <T x={12} y={110} c="n-mono" style={{ fontSize: 11 }}>
              {t("canvas.latestReplay", { id: last.replay_id, from: last.pipeline_version_from, to: last.pipeline_version_to })}
            </T>
          ) : null}
        </>
      );
    }
  }
}

export const NodeShell = memo(function NodeShell({
  id,
  n,
  selected,
  data,
  lod,
  expanded,
  onToggle,
}: {
  id: NodeId;
  n: NodeBox;
  selected: boolean;
  data: NodeData;
  lod: number;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const t = useT("pipelines");
  const to = useT("orchestration");
  const f = useFmt();
  const locale = useLocale();
  const ctx: Ctx = { t, to, f, locale, range: data.rangeShort ?? data.rangeLabel ?? t("canvas.today"), toggle: onToggle };
  return (
    <g
      className={selected ? "node sel" : "node"}
      data-node={id}
      data-stage={n.stage}
      tabIndex={0}
      role="button"
      aria-label={t("canvas.openAria", { stage: stageLabel(n.stage, locale), title: n.title })}
      aria-pressed={selected}
      transform={`translate(${n.x},${n.y})`}
      style={{ ["--i" as string]: n.i }}
    >
      <rect className="sel-ring" x={-6} y={-6} width={n.w + 12} height={n.h + 12} />
      <rect className={n.sub ? "n-box sub" : "n-box main"} width={n.w} height={n.h} />
      {n.sub ? null : <rect x={0} y={0} width={n.w} height={3} className="n-head" />}
      {body(id, n, data, lod, expanded, ctx)}
    </g>
  );
});

export type { Layout };
