"use client";
/**
 * A-00 · Orchestration canvas (U2 + U3). The §3.1 architecture drawn as a pannable blueprint.
 * Live data: SSE `tick` snapshot (token positions, capacity, stage counts), `transition`
 * (comets along edges, edge throughput, lingering success/DLQ tokens, ticker), plus
 * /api/v1/stages/{id} metric bags (range-aware, revalidated on tick) for the node instrument panels.
 *
 * URL state (all shareable, survives reload/back):
 *   ?stage=   selected stage → inspector
 *   ?tab=gcs  inspector tab (set when a file-search hit is picked)
 *   ?q=       file-name search: highlights matching stages + batch tokens; the inspector's GCS tab
 *             filters to the same text
 *   ?pipeline= pipeline drawn inside the expanded Vertex AI node (default: busiest root). Batch
 *             tokens only know their legacy phase, so on a DAG that isn't phase-aligned (sub-pipelines)
 *             the Vertex tokens are hidden and the node shows per-node running counts instead.
 *   ?range= / ?from=&to=  global period (shell RangePicker): counters + search follow it; tokens,
 *             slots and the ticker stay real-time.
 */
import { useReducedMotionSafe } from "../ui";
import clsx from "clsx";
import { Maximize, Minus, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { languageName, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { LANG_CODES, STAGES, STATE_TO_STAGE, STATUS_META, TERMINAL_STATES } from "@/lib/catalog";
import { api, parseAsString, useApi, useLiveStream, useQueryStates, useSimNow, useStreamEvent, useTimeRange } from "@/lib/client";
import type { ActiveWorkflowPos, FileSearchHit, StageId, TransitionMessage, WorkflowStatus } from "@/lib/types";
import { bounds, computePositions, edgeKeysFor, edgesDef, layout, overflowPos, primaryNode, startPointFor, type NodeBox, type NodeId } from "./geometry";
import { NodeShell, vertexPick, type Metrics, type NodeData } from "./nodes";
import { Inspector } from "./inspector";
import { useSim } from "../shell";
import { useRangeHref, useRangeLabel } from "../time-range";
import { CanvasSearch, type CanvasSearchHandle } from "../files/canvas-search";
import { useAuthGuard } from "../files/common";
import "@/styles/atlas-files.css";

const STAGE_IDS = STAGES.map((s) => s.id);
const TERMINAL = new Set<WorkflowStatus>(TERMINAL_STATES);
const MIN_K = 0.16;
const MAX_K = 2.4;
const SEARCH_LIMIT = 400;
const URL_PARSERS = { stage: parseAsString, tab: parseAsString, q: parseAsString, pipeline: parseAsString };

interface View {
  x: number;
  y: number;
  k: number;
}
interface TickerItem {
  id: string;
  wf: string;
  from: WorkflowStatus | null;
  to: WorkflowStatus;
  at: number;
}
const EVENT_TO_STATUS: Record<string, WorkflowStatus> = {
  QUEUED: "QUEUED",
  CAPACITY_RESERVED: "RESERVED",
  PIPELINE_STARTED: "RUNNING",
  PIPELINE_SUCCEEDED: "SUCCEEDED",
  RETRY_SCHEDULED: "RETRY_WAIT",
  DEAD_LETTER_PUBLISHED: "DEAD_LETTERED",
  EVENT_RECEIVED: "RECEIVED",
};

const lodFor = (k: number) => (k < 0.5 ? 0 : k >= 1.1 ? 2 : 1);
/** Text boost so node copy stays ≥ ~11 screen px at fit zoom (quantized to limit style recalcs). */
const textBoost = (k: number) => Math.round(Math.min(1.25, Math.max(1, 0.8 / k)) * 20) / 20;

function Annotations({ N }: { N: ReturnType<typeof layout> }) {
  const t = useT("orchestration");
  const a = (key: string, x: number, y: number, tx: number, ty: number, text: string, anchor: "start" | "end" = "start") => (
    <g key={key}>
      <path className="anno-line" d={`M${x},${y} L${tx},${ty}`} />
      <circle cx={x} cy={y} r={2} fill="var(--mark)" />
      <text className="anno" x={tx + (anchor === "start" ? 4 : -4)} y={ty + 3} textAnchor={anchor}>
        {text}
      </text>
    </g>
  );
  const wf = N.workflows,
    rq = N.registry_queue,
    ing = N.ingress,
    vx = N.vertex,
    res = N.results,
    sc = N.scheduler;
  return (
    <g className="annos">
      {a("adr001", wf.x + wf.w - 24, wf.y + wf.h, wf.x + wf.w - 24, wf.y + wf.h + 26, t("annotations.adr001"), "end")}
      {a("adr003", rq.x + 60, rq.y + rq.h, rq.x + 60, rq.y + rq.h + 20, t("annotations.adr003"), "end")}
      {a("adr002", sc.x + sc.w / 2 - 6, sc.y + sc.h + 30, sc.x + sc.w / 2 - 40, sc.y + sc.h + 30, t("annotations.adr002"), "end")}
      {a("idem", ing.x + 18, ing.y + ing.h, ing.x + 18, ing.y + ing.h + 22, t("annotations.idempotency"))}
      {a("adr004", res.x, res.y + 50, res.x - 30, res.y + 50, t("annotations.adr004"), "end")}
      {a("jobid", vx.x + 20, vx.y + vx.h, vx.x + 20, vx.y + vx.h + 24, t("annotations.jobId"))}
      <path className="dim" d={`M20,10 L20,20 M20,15 L${sc.x + sc.w},15 M${sc.x + sc.w},10 L${sc.x + sc.w},20`} />
      {/* right-aligned so the HUD title block (top-left) never hides the dimension label */}
      <text className="anno ink" x={sc.x + sc.w - 6} y={7} textAnchor="end">
        {t("annotations.slo")}
      </text>
      <text className="anno ink" x={20} y={N.dlq_mgr.y - 14}>
        {t("annotations.recovery")}
      </text>
      <text className="anno ink" x={vx.x} y={vx.y - 12}>
        {t("annotations.execution")}
      </text>
      <text className="anno ink" x={N.retry.x} y={N.retry.y - 12}>
        {t("annotations.retryPolicy")}
      </text>
    </g>
  );
}

/** Search overlay per matching stage, drawn in world units: `halo` (under the nodes) is a dashed
 *  outline, `tag` (over the nodes, so node badges never hide it) reads "N matches". */
function SearchMarks({ N, byStage, picked, part }: { N: ReturnType<typeof layout>; byStage: Partial<Record<StageId, number>>; picked: StageId | null; part: "halo" | "tag" }) {
  const t = useT("orchestration");
  return (
    <g className={clsx("cvs-marks", part === "tag" ? "tags" : "halos")} aria-hidden>
      {STAGE_IDS.filter((s) => (byStage[s] ?? 0) > 0).map((s) => {
        const n = primaryNode(N, s) as NodeBox;
        if (part === "halo")
          return (
            <g key={s} className={clsx("cvs-mark", picked === s && "picked")}>
              <rect className="halo" x={n.x - 8} y={n.y - 8} width={n.w + 16} height={n.h + 16} rx={3} />
            </g>
          );
        const label = t("search.stageBadge", { count: byStage[s] ?? 0 });
        const w = 22 + [...label].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 255 ? 12.5 : 7.4), 0);
        return (
          <g key={s} className={clsx("cvs-mark", picked === s && "picked")} transform={`translate(${n.x + 10},${n.y - 6})`}>
            {/* scaled with --tz (CSS) so the tag stays readable at fit zoom; grows upward from the node edge */}
            <g className="tagbox">
              <rect className="tag" y={-22} width={w} height={22} rx={2} />
              <circle cx={11} cy={-11} r={3.2} className="dot" />
              <text x={19} y={-6.6} className="tag-t">
                {label}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

export function CanvasScreen() {
  const router = useRouter();
  const t = useT("orchestration");
  const locale = useLocale();
  const f = useFmt();
  const reduced = useReducedMotionSafe();
  const { snapshot } = useLiveStream();
  const now = useSimNow();
  const { running: simRunning } = useSim();
  const tr = useTimeRange();
  const rangeLabel = useRangeLabel();
  const rangeHref = useRangeHref();
  const [url, setUrl] = useQueryStates(URL_PARSERS);
  const selStage = url.stage && (STAGE_IDS as string[]).includes(url.stage) ? (url.stage as StageId) : null;
  const [expanded, setExpanded] = useState(true);
  const N = useMemo(() => layout(expanded), [expanded]);
  const E = useMemo(() => edgesDef(N), [N]);
  const B = useMemo(() => bounds(N), [N]);

  /* ── data (range-aware counters) ── */
  // Per-stage KPI bags only exist on /stages/{id}; live counts already arrive with every SSE tick
  // (snapshot.stageCounts), so the bags are refreshed at a relaxed pace and not at all while the
  // tab is hidden. The cache is per range so switching the period never shows another range's bag.
  const metricsRef = useRef<{ key: string; data: Metrics } | undefined>(undefined);
  const stagesQ = useApi(
    ["atlas-stage-metrics", tr.key],
    async () => {
      const m = metricsRef.current;
      if (m && m.key === tr.key && typeof document !== "undefined" && document.hidden) return m.data;
      const all = await Promise.all(STAGE_IDS.map((id) => api.stage(id, { limit: 1, objects_limit: 1, ...tr.params })));
      const out: Metrics = {};
      all.forEach((d) => (out[d.stage.id] = d.metrics));
      metricsRef.current = { key: tr.key, data: out };
      return out;
    },
    { revalidateOn: ["tick"], throttleMs: 8000 },
  );
  const replaysQ = useApi(["replays", "atlas", tr.key], () => api.replays(tr.params), { revalidateOn: ["dlq"] });
  const pendQ = useApi(["dead-letters", "atlas-pending", tr.key], () => api.deadLetters({ status: ["PENDING_REVIEW"], pageSize: 100, ...tr.params }), { revalidateOn: ["dlq"] });
  const fileQ = useApi(["results-file", "atlas"], () => api.resultFile(), { revalidateOn: ["transition"], throttleMs: 4000 });
  useAuthGuard(stagesQ.error ?? replaysQ.error);

  // `rangeLabel`/`rangeShort` ride along for the node bodies (nodes.tsx) to label "오늘 …" counters
  // with the active period; keys live in orchestration.nodes.* ({range}).
  const nodeData: NodeData = Object.assign(
    {
      metrics: stagesQ.data ?? {},
      capacity: snapshot?.capacity ?? null,
      replays: replaysQ.data,
      pending: pendQ.data?.items,
      resultFile: fileQ.data,
      now,
      stageCounts: snapshot?.stageCounts,
    },
    { rangeLabel: rangeLabel.title, rangeShort: rangeLabel.short },
  );

  /* ── file-name search (?q=) ── */
  const [draft, setDraft] = useState(url.q ?? "");
  const lastWritten = useRef(url.q ?? "");
  useEffect(() => {
    // external URL changes (back/forward, links from /files) → input
    if ((url.q ?? "") !== lastWritten.current) {
      lastWritten.current = url.q ?? "";
      setDraft(url.q ?? "");
    }
  }, [url.q]);
  useEffect(() => {
    const v = draft.trim();
    if (v === (url.q ?? "")) return;
    const h = setTimeout(() => {
      lastWritten.current = v;
      setUrl({ q: v || null });
    }, 260);
    return () => clearTimeout(h);
  }, [draft, url.q, setUrl]);
  const q = (url.q ?? "").trim();
  const searchQ = useApi(q ? ["file-search", "canvas", tr.key, q] : null, () => api.fileSearch({ q, limit: SEARCH_LIMIT, ...tr.params }), {
    revalidateOn: ["transition"],
    throttleMs: 6000,
  });
  const result = q && searchQ.data?.q === q ? searchQ.data : undefined;
  const searching = !!q;
  const byStage = useMemo(() => (result ? result.byStage : {}), [result]);
  const hitWf = useMemo(() => {
    const s = new Set<string>();
    result?.items.forEach((h) => h.workflow_id && s.add(h.workflow_id));
    return s;
  }, [result]);
  const ql = q.toLowerCase();
  const tokenHit = useCallback((id: string) => hitWf.has(id) || (!!ql && id.toLowerCase().includes(ql)), [hitWf, ql]);
  const searchRef = useRef<CanvasSearchHandle>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ── lingering terminal tokens + ticker + edge throughput ── */
  const [linger, setLinger] = useState<Map<string, { wf: ActiveWorkflowPos; stage: StageId; until: number }>>(new Map());
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const hitsRef = useRef<Record<string, number[]>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const cometRef = useRef<SVGGElement>(null);
  // arriving with ?stage=…&tab=gcs (a deep link from /files or a shared URL) flies to that stage once laid out
  const [focusReq, setFocusReq] = useState<{ stage: StageId; n: number } | null>(() => (selStage && url.tab === "gcs" ? { stage: selStage, n: 0 } : null));
  const [flashSel, setFlashSel] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .events({ limit: 8, name: Object.keys(EVENT_TO_STATUS) })
      .then((ev) => {
        if (!alive) return;
        setTicker((cur) =>
          cur.length
            ? cur
            : ev.slice(0, 3).map((e) => ({ id: e.event_id, wf: e.workflow_id ?? "system", from: null, to: EVENT_TO_STATUS[e.name], at: e.ts })),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const comet = useCallback(
    (keys: string[], lang: string, tone: string) => {
      const layer = cometRef.current;
      if (reduced || !layer || document.hidden) return;
      const paths = keys.map((k) => pathRefs.current.get(k)).filter((p): p is SVGPathElement => !!p);
      if (!paths.length) return;
      const lens = paths.map((p) => p.getTotalLength());
      const total = lens.reduce((a, b) => a + b, 0);
      const NS = "http://www.w3.org/2000/svg";
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "comet");
      g.setAttribute("pointer-events", "none");
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("r", "11");
      halo.setAttribute("fill", `var(--st-${tone})`);
      halo.setAttribute("opacity", ".2");
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("r", "5.5");
      dot.setAttribute("fill", `var(--lg-${lang})`);
      dot.setAttribute("stroke", "var(--sheet)");
      dot.setAttribute("stroke-width", "1.5");
      g.append(halo, dot);
      layer.appendChild(g);
      const dur = 600 + Math.min(900, total * 0.9);
      const t0 = performance.now();
      const step = (tm: number) => {
        const p = Math.min(1, (tm - t0) / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        let dd = e * total;
        let i = 0;
        while (i < lens.length - 1 && dd > lens[i]) {
          dd -= lens[i];
          i++;
        }
        const pt = paths[i].getPointAtLength(Math.min(dd, lens[i]));
        g.setAttribute("transform", `translate(${pt.x},${pt.y})`);
        if (p < 1) requestAnimationFrame(step);
        else g.remove();
      };
      requestAnimationFrame(step);
    },
    [reduced],
  );

  const pulse = useCallback(
    (stage: StageId) => {
      const layer = cometRef.current;
      if (reduced || !layer) return;
      const n = primaryNode(N, stage);
      if (!n) return;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("class", "pulse-ring");
      r.setAttribute("x", String(n.x));
      r.setAttribute("y", String(n.y));
      r.setAttribute("width", String(n.w));
      r.setAttribute("height", String(n.h));
      layer.appendChild(r);
      setTimeout(() => r.remove(), 1000);
    },
    [N, reduced],
  );

  useStreamEvent("transition", (m: TransitionMessage) => {
    const fromStage = m.from ? STATE_TO_STAGE[m.from] : "null";
    const keys = edgeKeysFor(fromStage, m.stage);
    if (m.to === "SUCCEEDED" || m.to === "DEAD_LETTERED") {
      setLinger((mp) => new Map(mp).set(m.workflow_id, { wf: m.workflow, stage: m.stage, until: performance.now() + 5200 }));
    }
    const tone = STATUS_META[m.to]?.tone ?? "queued";
    if (keys) {
      const nowP = performance.now();
      keys.forEach((k) => (hitsRef.current[k] ??= []).push(nowP));
      comet(keys, m.language, tone);
    }
    if (m.to === "SUCCEEDED" || m.to === "DEAD_LETTERED" || m.to === "RETRY_WAIT") pulse(m.stage);
    setTicker((cur) => [{ id: m.workflow_id + m.at + m.to, wf: m.workflow_id, from: m.from, to: m.to, at: m.at }, ...cur].sort((a, b) => b.at - a.at).slice(0, 3));
  });

  useStreamEvent("tick", () => {
    const p = performance.now();
    const next: Record<string, number> = {};
    for (const e of E) {
      const h = (hitsRef.current[e.k] ?? []).filter((x) => p - x < 30000);
      hitsRef.current[e.k] = h;
      next[e.k] = h.length;
    }
    setRates(next);
    setLinger((mp) => {
      let changed = false;
      const n2 = new Map(mp);
      for (const [k, v] of mp)
        if (v.until < p) {
          n2.delete(k);
          changed = true;
        }
      return changed ? n2 : mp;
    });
  });

  /* ── token placement (always live, never range-filtered) ── */
  const live = useMemo(() => (snapshot?.active ?? []).filter((w) => !TERMINAL.has(w.status)), [snapshot]);
  const lingerList = useMemo(() => [...linger.values()].filter((l) => !live.some((w) => w.workflow_id === l.wf.workflow_id)), [linger, live]);
  const placed = useMemo(() => computePositions(N, expanded, live, lingerList), [N, expanded, live, lingerList]);
  // Vertex tokens sit on legacy phase slots: draw them only when the selected inner DAG uses those slots
  const vxByPipeline = (stagesQ.data?.vertex as { byPipeline?: unknown } | undefined)?.byPipeline;
  const hideVertexTokens = expanded && !vertexPick(vxByPipeline, url.pipeline).aligned;
  const tokenWf = useMemo(() => {
    const m = new Map<string, ActiveWorkflowPos>();
    live.forEach((w) => m.set(w.workflow_id, w));
    lingerList.forEach((l) => m.set(l.wf.workflow_id, { ...l.wf, status: l.stage === "results" ? "SUCCEEDED" : "DEAD_LETTERED" }));
    return m;
  }, [live, lingerList]);

  /* ── pan / zoom (imperative transform, React state only for zoom label + LOD) ── */
  const wrapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const miniViewRef = useRef<SVGRectElement>(null);
  const vw = useRef<View>({ x: 0, y: 0, k: 0.7 });
  const anim = useRef(0);
  const [zoom, setZoom] = useState(0.7);
  const [hint, setHint] = useState(false);
  const [booting, setBooting] = useState(true);
  const fitted = useRef(false);
  // read by the ResizeObserver, which fires before passive effects when the inspector mounts
  const selRef = useRef<StageId | null>(null);
  useLayoutEffect(() => {
    selRef.current = selStage;
  }, [selStage]);

  const apply = useCallback(() => {
    const w = wrapRef.current;
    const g = worldRef.current;
    if (!w || !g) return;
    const v = vw.current;
    g.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
    const gs = 20 * v.k;
    w.style.setProperty("--gs", gs + "px");
    w.style.setProperty("--gs5", gs * 5 + "px");
    w.style.setProperty("--gx", v.x + "px");
    w.style.setProperty("--gy", v.y + "px");
    const tz = String(textBoost(v.k));
    if (w.style.getPropertyValue("--tz") !== tz) w.style.setProperty("--tz", tz);
    const mv = miniViewRef.current;
    if (mv) {
      mv.setAttribute("x", String(-v.x / v.k));
      mv.setAttribute("y", String(-v.y / v.k));
      mv.setAttribute("width", String(w.clientWidth / v.k));
      mv.setAttribute("height", String(w.clientHeight / v.k));
    }
    setZoom((z) => (Math.abs(z - v.k) > 0.004 ? v.k : z));
  }, []);

  /** Animate the view to `to` (instant under reduced motion). */
  const animateTo = useCallback(
    (to: View, ms = 520) => {
      cancelAnimationFrame(anim.current);
      if (reduced) {
        vw.current = to;
        apply();
        return;
      }
      const from = { ...vw.current };
      const t0 = performance.now();
      const step = (tm: number) => {
        const p = Math.min(1, (tm - t0) / ms);
        const e = 1 - Math.pow(1 - p, 3);
        // interpolate the scale geometrically so zooming feels even
        const k = from.k * Math.pow(to.k / from.k, e);
        vw.current = { k, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        apply();
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [apply, reduced],
  );

  /** Keep the drawing clear of the HUD: below the title block / toolbar, above the bottom band (measured). */
  const hudPads = useCallback(() => {
    const w = wrapRef.current!;
    const wide = w.clientWidth > 760;
    const bottomOf = (sel: string) => {
      const el = w.querySelector<HTMLElement>(sel);
      return el && el.offsetParent ? el.offsetTop + el.offsetHeight : 0;
    };
    const band = w.querySelector<HTMLElement>(".hud-band");
    const bandH = band ? w.clientHeight - band.offsetTop : 0;
    const top = Math.max(bottomOf(".hud.title-block"), bottomOf(".hud.cvs-tools"));
    return { wide, padTop: wide ? Math.max(46, top - 12) : Math.max(12, top + 6), padBot: wide ? Math.max(66, bandH + 4) : 60 };
  }, []);

  /** Smart default: fit the whole drawing when that stays legible (≥ 0.6, text is boosted below 0.8);
   *  otherwise open at a readable scale on the intake → execution core; ⤢ always fits everything. */
  const fit = useCallback(
    (mode: "auto" | "all" = "auto", animate = false) => {
      const w = wrapRef.current;
      if (!w) return;
      const W = w.clientWidth;
      const H = w.clientHeight;
      const bw = B.x1 - B.x0;
      const bh = B.y1 - B.y0;
      const { wide, padTop, padBot } = hudPads();
      const kAll = Math.max(MIN_K, Math.min(1.1, Math.min((W - 32) / bw, (H - padTop - padBot) / bh)));
      let next: View;
      if (mode === "all" || kAll >= 0.6) {
        next = { k: kAll, x: (W - bw * kAll) / 2 - B.x0 * kAll, y: padTop + (H - padTop - padBot - bh * kAll) / 2 - B.y0 * kAll };
        setHint(false);
      } else {
        const k = wide ? Math.min(0.85, Math.max(0.62, (W - 32) / bw)) : 0.62;
        next = { k, x: wide ? (W - bw * k) / 2 - B.x0 * k : 12 - (N.gcs_input.x - 6) * k, y: padTop - (B.y0 + 10) * k };
        setHint(true);
      }
      if (animate) animateTo(next, 420);
      else {
        vw.current = next;
        apply();
      }
    },
    [B, N, apply, animateTo, hudPads],
  );

  const zoomAt = useCallback(
    (fz: number, cx: number, cy: number) => {
      cancelAnimationFrame(anim.current);
      const v = vw.current;
      const k2 = Math.max(MIN_K, Math.min(MAX_K, v.k * fz));
      vw.current = { k: k2, x: cx - (cx - v.x) * (k2 / v.k), y: cy - (cy - v.y) * (k2 / v.k) };
      apply();
    },
    [apply],
  );

  useEffect(() => {
    const w = wrapRef.current;
    if (!w) return;
    let lastW = w.clientWidth;
    const raf = requestAnimationFrame(() => {
      fit();
      fitted.current = true;
    });
    const ro = new ResizeObserver(() => {
      if (!fitted.current) return;
      if (Math.abs(w.clientWidth - lastW) > 40 && !selRef.current) {
        lastW = w.clientWidth;
        fit();
      } else apply();
    });
    ro.observe(w);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = w.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    w.addEventListener("wheel", onWheel, { passive: false });
    const bt = setTimeout(() => setBooting(false), 2200);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      w.removeEventListener("wheel", onWheel);
      clearTimeout(bt);
    };
  }, [fit, apply, zoomAt]);

  const selectStage = useCallback(
    (s: StageId | null) => {
      setUrl({ stage: s, tab: null }, { history: "push" });
      setFlashSel((x) => x + 1);
    },
    [setUrl],
  );

  /** A search hit / stage group was picked: open the inspector on its GCS tab filtered to the query, then fly to the node. */
  const openStageSearch = useCallback(
    (s: StageId) => {
      setUrl({ stage: s, tab: "gcs", q: q || null }, { history: "push" });
      setFocusReq((r) => ({ stage: s, n: (r?.n ?? 0) + 1 }));
    },
    [setUrl, q],
  );
  const onPickHit = useCallback((h: FileSearchHit) => openStageSearch(h.stage), [openStageSearch]);

  // plain selection: make sure the node is on-screen (the inspector narrows the canvas)
  useEffect(() => {
    if (!selStage) return;
    const raf = requestAnimationFrame(() => {
      const w = wrapRef.current;
      const n = primaryNode(N, selStage);
      if (!w || !n) return;
      const v = vw.current;
      const sx0 = v.x + n.x * v.k;
      const sx1 = v.x + (n.x + n.w) * v.k;
      const sy0 = v.y + n.y * v.k;
      const sy1 = v.y + (n.y + n.h) * v.k;
      if (sx0 < 0 || sx1 > w.clientWidth || sy0 < 0 || sy1 > w.clientHeight - 60) {
        animateTo({ ...v, x: w.clientWidth / 2 - (n.x + n.w / 2) * v.k, y: w.clientHeight / 2 - (n.y + n.h / 2) * v.k }, 380);
      }
      if (window.matchMedia("(max-width: 900px)").matches) document.getElementById("atlas-inspector")?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selStage, flashSel, N, animateTo, reduced]);

  // search pick: zoom so the stage node fills a comfortable part of the (already narrowed) canvas
  useEffect(() => {
    if (!focusReq) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const w = wrapRef.current;
        const n = primaryNode(N, focusReq.stage);
        if (!w || !n) return;
        const { padTop, padBot } = hudPads();
        const W = w.clientWidth;
        const H = w.clientHeight;
        const availH = Math.max(160, H - padTop - padBot);
        const k = Math.max(0.7, Math.min(1.25, (W - 96) / (n.w + 60), (availH - 40) / (n.h + 60)));
        animateTo({ k, x: W / 2 - (n.x + n.w / 2) * k, y: padTop + availH / 2 - (n.y + n.h / 2) * k }, 560);
        setHint(false);
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [focusReq, N, animateTo, hudPads]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".hud") || e.button !== 0) return;
    cancelAnimationFrame(anim.current);
    setHint(false);
    drag.current = { x: e.clientX, y: e.clientY, vx: vw.current.x, vy: vw.current.y, moved: false };
    try {
      wrapRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    wrapRef.current?.classList.add("dragging");
    vw.current = { ...vw.current, x: d.vx + dx, y: d.vy + dy };
    apply();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    wrapRef.current?.classList.remove("dragging");
    if (!d || d.moved) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit) return;
    if (hit.closest('[data-toggle="vertex"]')) return setExpanded((x) => !x);
    const tok = hit.closest<SVGGElement>("[data-tok]");
    if (tok?.dataset.tok) return router.push(rangeHref(`/workflows/${tok.dataset.tok}`));
    const node = hit.closest<SVGGElement>("[data-stage]");
    if (node?.dataset.stage) {
      const s = node.dataset.stage as StageId;
      // with an active search, clicking a matching node opens it pre-filtered like a picked hit
      if (q && (byStage[s] ?? 0) > 0) openStageSearch(s);
      else selectStage(s);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target as Element;
    if (el.closest(".hud")) return;
    const tok = el.closest<SVGGElement>("[data-tok]");
    if (tok?.dataset.tok) {
      e.preventDefault();
      return router.push(rangeHref(`/workflows/${tok.dataset.tok}`));
    }
    const node = el.closest<SVGGElement>(".node");
    if (node?.dataset.stage) {
      e.preventDefault();
      const s = node.dataset.stage as StageId;
      if (q && (byStage[s] ?? 0) > 0) openStageSearch(s);
      else selectStage(s);
    }
  };
  const onMini = (e: React.MouseEvent<SVGSVGElement>) => {
    const w = wrapRef.current;
    if (!w) return;
    const r = e.currentTarget.getBoundingClientRect();
    const bw = B.x1 - B.x0;
    const bh = B.y1 - B.y0;
    const sc = Math.min(r.width / bw, r.height / bh);
    const ox = (r.width - bw * sc) / 2;
    const oy = (r.height - bh * sc) / 2;
    const wx = B.x0 + (e.clientX - r.left - ox) / sc;
    const wy = B.y0 + (e.clientY - r.top - oy) / sc;
    const v = vw.current;
    animateTo({ ...v, x: w.clientWidth / 2 - wx * v.k, y: w.clientHeight / 2 - wy * v.k }, 320);
  };

  const lod = lodFor(zoom);
  const toggleDag = useCallback(() => setExpanded((x) => !x), []);
  const liveCount = live.length;
  const filesHref = useCallback(
    (stage?: StageId) => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (stage) p.set("stage", stage);
      const s = p.toString();
      return rangeHref(`/files${s ? "?" + s : ""}`);
    },
    [q, rangeHref],
  );

  /* ── inspector width (resizable) ── */
  const [inspW, setInspW] = useState<number | null>(null);
  const centerX = () => (wrapRef.current?.clientWidth ?? 0) / 2;
  const centerY = () => (wrapRef.current?.clientHeight ?? 0) / 2;

  return (
    <div className="atlas" style={inspW ? { ["--insp-w" as string]: inspW + "px" } : undefined}>
      <div
        className={clsx("stage-wrap", searching && "cvs-searching")}
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        <svg className={clsx("atlas-svg", booting && "boot")} role="group" aria-label={t("drawing.aria")}>
          <defs>
            {(["def", "success", "failed", "retry", "dlq"] as const).map((tn) => (
              <marker key={tn} id={`at-arr-${tn}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" fill={tn === "def" ? "var(--ink-3)" : `var(--st-${tn})`} />
              </marker>
            ))}
          </defs>
          <g ref={worldRef}>
            <Annotations N={N} />
            <g className="cvs-edges">
              {E.map((e) => {
                const base = /res_|dlq>dlq_mgr|dlq_mgr/.test(e.k) ? 0 : 0.4;
                const rate = (rates[e.k] ?? 0) + base;
                return (
                  <g key={e.k} className="edge-g" style={{ ["--ec" as string]: e.tone ? `var(--st-${e.tone})` : "var(--accent)", ["--i" as string]: e.i }}>
                    <path
                      className={clsx("edge base", e.dashed && "dashed")}
                      d={e.d}
                      ref={(el) => {
                        if (el) pathRefs.current.set(e.k, el);
                        else pathRefs.current.delete(e.k);
                      }}
                      markerEnd={`url(#at-arr-${e.tone ?? "def"})`}
                    />
                    <path
                      className="edge flow"
                      d={e.d}
                      style={{
                        strokeWidth: (1.3 + Math.min(4.2, rate * 0.9)).toFixed(2),
                        ["--spd" as string]: Math.max(0.55, 3.4 - rate * 0.5).toFixed(2) + "s",
                        opacity: rate > 0 ? 0.95 : 0.18,
                      }}
                    />
                  </g>
                );
              })}
            </g>
            {result ? <SearchMarks N={N} byStage={byStage} picked={selStage} part="halo" /> : null}
            <g>
              {(Object.keys(N) as NodeId[]).map((id) => {
                const s = N[id].stage;
                return (
                  <g key={id} className={clsx("cvs-n", searching && result && ((byStage[s] ?? 0) > 0 ? "cvs-on" : "cvs-off"))}>
                    <NodeShell id={id} n={N[id]} selected={selStage === s} data={nodeData} lod={lod} expanded={expanded} onToggle={toggleDag} />
                  </g>
                );
              })}
            </g>
            <g className="cvs-elabels">
              {E.filter((e) => e.label).map((e) => (
                <text key={e.k} className="e-label" style={{ ["--ec" as string]: e.tone ? `var(--st-${e.tone})` : "var(--ink-2)" }} x={e.lx} y={e.ly} textAnchor={e.anchor ?? "middle"}>
                  {e.label ? t(`edges.${e.label}`) : null}
                </text>
              ))}
            </g>
            {result ? <SearchMarks N={N} byStage={byStage} picked={selStage} part="tag" /> : null}
            <g ref={cometRef} />
            <g>
              <AnimatePresence initial={false}>
                {[...placed.pos.entries()].map(([id, [x, y]]) => {
                  const w = tokenWf.get(id);
                  if (!w || (hideVertexTokens && w.stage === "vertex")) return null;
                  const meta = STATUS_META[w.status];
                  const [sx, sy] = startPointFor(N, w, [x, y]);
                  const ringless = ["QUEUED", "RECEIVED", "VALIDATED"].includes(w.status);
                  const isHit = searching && result ? tokenHit(id) : false;
                  const tip = [
                    t("token.title", { id, status: statusLabel("workflow", w.status, locale), lang: languageName(w.language, locale), attempt: w.attempt }) +
                      (w.pct ? ` · ${f.pct(w.pct, 0)}` : "") +
                      (w.current_node ? ` · ${w.current_node}` : ""),
                    isHit ? t("token.searchHit") : null,
                    t("token.open"),
                  ]
                    .filter(Boolean)
                    .join("\n");
                  return (
                    <motion.g
                      key={id}
                      data-tok={id}
                      className={clsx("tok", w.status === "RUNNING" && "running", searching && result && (isHit ? "tok-hit" : "tok-dim"))}
                      tabIndex={-1}
                      initial={reduced ? false : { x: sx, y: sy, opacity: 0 }}
                      animate={{ x, y, opacity: 1 }}
                      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.4 }}
                      transition={{ duration: reduced ? 0 : 0.7, ease: [0.3, 0.7, 0.2, 1] }}
                    >
                      <title>{tip}</title>
                      {isHit ? <circle className="hit-ring" r={12} /> : null}
                      {ringless ? null : <circle className="ring" r={8.5} stroke={`var(--st-${meta.tone})`} />}
                      <circle className="c" r={5.5} fill={`var(--lg-${w.language})`} />
                      {lod === 2 || isHit ? (
                        <text className={clsx("tok-lbl", isHit && "hit")} transform="translate(3,-10) rotate(-55)" textAnchor="start">
                          {f.shortWorkflowId(id)}
                        </text>
                      ) : null}
                    </motion.g>
                  );
                })}
              </AnimatePresence>
              {Object.entries(placed.overflow).map(([k, v]) => {
                if (hideVertexTokens && k.startsWith("v-")) return null;
                const [x, y] = overflowPos(N, k);
                return (
                  <text key={k} x={x} y={y} textAnchor="end" style={{ font: "600 11px var(--f-mono)", fill: "var(--ink-2)" }}>
                    +{v}
                  </text>
                );
              })}
            </g>
          </g>
        </svg>

        <div className="hud title-block" aria-label={t("drawing.titleBlock")}>
          <div className="tb-head">
            <span className="tb-h">{t("drawing.heading")}</span>
          </div>
          <div className="tb-dwg">
            <span className="tb-k">{t("drawing.dwg")}</span>
            <span className="tb-v">AIPO-ORCH-001</span>
          </div>
          <div className="tb-ref">
            <span className="tb-k">{t("drawing.ref")}</span>
            <span className="tb-v">§3.1 · §5.1</span>
          </div>
          <div className="tb-scale">
            <span className="tb-k">{t("drawing.scale")}</span>
            <span className="tb-v">1 : {(1 / zoom).toFixed(2)}</span>
          </div>
          <div className="tb-range" title={`${rangeLabel.span}\n${t("range.hint")}`}>
            <span className="tb-k">{t("drawing.range")}</span>
            <span className="tb-v" suppressHydrationWarning>
              {rangeLabel.title}
            </span>
          </div>
          <div title={t("drawing.liveHint")}>
            <span className="tb-k">{t("drawing.live")}</span>
            <span className="tb-v" suppressHydrationWarning>
              {liveCount} · {f.time(now)}
            </span>
          </div>
        </div>

        <div className="hud cvs-tools">
          <CanvasSearch
            ref={searchRef}
            value={draft}
            onChange={setDraft}
            result={result}
            loading={!!q && (searchQ.isLoading || searchQ.isValidating || draft.trim() !== q)}
            error={!!searchQ.error && !result}
            onPick={onPickHit}
            onPickStage={openStageSearch}
            filesHref={filesHref}
          />
        </div>

        <div className="hud-band">
          <div className="hud mini" aria-label={t("minimap.aria")} title={t("minimap.aria")}>
            <svg viewBox={`${B.x0} ${B.y0} ${B.x1 - B.x0} ${B.y1 - B.y0}`} preserveAspectRatio="xMidYMid meet" onClick={onMini}>
              {(Object.keys(N) as NodeId[]).map((id) => {
                const s = N[id].stage;
                const hit = searching && result && (byStage[s] ?? 0) > 0;
                return (
                  <rect
                    key={id}
                    className={clsx("mini-n", hit && "hit")}
                    x={N[id].x}
                    y={N[id].y}
                    width={N[id].w}
                    height={N[id].h}
                    style={selStage === s ? { stroke: "var(--accent)" } : undefined}
                  />
                );
              })}
              {[...placed.pos.entries()].map(([id, [x, y]]) => {
                const w = tokenWf.get(id);
                return w && !(hideVertexTokens && w.stage === "vertex") ? <circle key={id} cx={x} cy={y} r={9} fill={`var(--lg-${w.language})`} /> : null;
              })}
              <rect ref={miniViewRef} className="mini-v" />
            </svg>
          </div>
          <div className="hud legend" aria-label={t("legend.aria")}>
            <span className="lt">{t("legend.title")}</span>
            {LANG_CODES.map((c) => (
              <span key={c} className={`lg-${c}`} title={languageName(c, locale)}>
                <i />
                {c.toUpperCase()} {languageName(c, locale)}
              </span>
            ))}
          </div>
          <div className="hud ticker" aria-label={t("ticker.aria")}>
            <div className="th">
              <span>{t("ticker.title")}</span>
              <span>
                <span className={clsx("live-dot", !simRunning && "off")} /> {simRunning ? t("ticker.live") : t("ticker.paused")}
              </span>
            </div>
            <ol>
              <AnimatePresence initial={false}>
                {ticker.map((x) => {
                  const m = STATUS_META[x.to];
                  return (
                    <motion.li
                      key={x.id}
                      initial={reduced ? false : { opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0 } }}
                      transition={{ duration: 0.35 }}
                      className={m ? `tone-${m.tone}` : ""}
                    >
                      <span>{f.time(x.at)}</span>
                      <span>
                        <b>{f.shortWorkflowId(x.wf)}</b>{" "}
                        <span style={{ color: "var(--tc)" }}>
                          {x.from ? `${x.from} → ` : ""}
                          {x.to}
                        </span>
                      </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </div>
          {hint ? (
            <div className="hud pan-hint" title={t("hint.title")}>
              {t("hint.drag")} · <b>⤢</b> {t("hint.all")}
            </div>
          ) : null}
          <div className="hud zoom" role="group" aria-label={t("zoom.group")}>
            <button type="button" aria-label={t("zoom.in")} title={t("zoom.in")} onClick={() => zoomAt(1.2, centerX(), centerY())}>
              <Plus />
            </button>
            <div className="zl" aria-live="polite" aria-label={t("zoom.level")}>
              {Math.round(zoom * 100)}%
            </div>
            <button type="button" aria-label={t("zoom.out")} title={t("zoom.out")} onClick={() => zoomAt(1 / 1.2, centerX(), centerY())}>
              <Minus />
            </button>
            <button type="button" aria-label={t("zoom.fit")} title={t("zoom.fit")} onClick={() => fit("all", true)}>
              <Maximize />
            </button>
          </div>
        </div>
      </div>
      {selStage ? <Inspector key={selStage} stage={selStage} onClose={() => selectStage(null)} onWidth={setInspW} /> : null}
    </div>
  );
}
