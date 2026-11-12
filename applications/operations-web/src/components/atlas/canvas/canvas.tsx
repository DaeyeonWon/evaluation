"use client";
/**
 * A-00 · Orchestration canvas (U2 + U3). The §3.1 architecture drawn as a pannable blueprint.
 * Live data: SSE `tick` snapshot (token positions, capacity, stage counts), `transition`
 * (comets along edges, edge throughput, lingering success/DLQ tokens, ticker), plus
 * /api/v1/stages/{id} metric bags (revalidated on tick) for the node instrument panels.
 * Selected stage lives in the URL (?stage=) so the inspector survives reload/back.
 */
import { useReducedMotionSafe } from "../ui";
import clsx from "clsx";
import { Maximize, Minus, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/components/shared";
import { LANG_CODES, LANGUAGE_BY_CODE, STAGES, STATE_TO_STAGE, STATUS_META, TERMINAL_STATES } from "@/lib/catalog";
import { api, useApi, useLiveStream, useQueryState, useSimNow, useStreamEvent } from "@/lib/client";
import type { ActiveWorkflowPos, StageId, TransitionMessage, WorkflowStatus } from "@/lib/types";
import { bounds, computePositions, edgeKeysFor, edgesDef, layout, overflowPos, startPointFor, type NodeId } from "./geometry";
import { NodeShell, type Metrics, type NodeData } from "./nodes";
import { Inspector } from "./inspector";
import { useSim } from "../shell";

const STAGE_IDS = STAGES.map((s) => s.id);
const TERMINAL = new Set<WorkflowStatus>(TERMINAL_STATES);
const MIN_K = 0.16;
const MAX_K = 2.4;

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

function Annotations({ N }: { N: ReturnType<typeof layout> }) {
  const a = (x: number, y: number, tx: number, ty: number, text: string, anchor: "start" | "end" = "start") => (
    <g key={text}>
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
      {a(wf.x + wf.w - 24, wf.y + wf.h, wf.x + wf.w - 24, wf.y + wf.h + 26, "ADR-001 · 상위 Orchestrator = Cloud Workflows", "end")}
      {a(rq.x + 60, rq.y + rq.h, rq.x + 60, rq.y + rq.h + 20, "ADR-003 · Firestore = Operational State", "end")}
      {a(sc.x + sc.w / 2 - 6, sc.y + sc.h + 30, sc.x + sc.w / 2 - 40, sc.y + sc.h + 30, "ADR-002 · Cloud Tasks 미사용", "end")}
      {a(ing.x + 18, ing.y + ing.h, ing.x + 18, ing.y + ing.h + 22, "§4.1 Idempotency = SHA256(project+bucket+object+generation+version)")}
      {a(res.x, res.y + 50, res.x - 30, res.y + 50, "ADR-004 · 상태 Firestore / 이력 BigQuery / 로그 Logging", "end")}
      {a(vx.x + 20, vx.y + vx.h, vx.x + 20, vx.y + vx.h + 24, "PipelineJob ID = {workflow_id}-cycle-{n}-attempt-{n}")}
      <path className="dim" d={`M20,10 L20,20 M20,15 L${sc.x + sc.w},15 M${sc.x + sc.w},10 L${sc.x + sc.w},20`} />
      {/* right-aligned so the HUD title block (top-left) never hides the dimension label */}
      <text className="anno ink" x={sc.x + sc.w - 6} y={7} textAnchor="end">
        INTAKE → ADMISSION · Event 등록 p95 SLO 10s · Capacity 확보 후 시작 지연 p95 SLO 30s
      </text>
      <text className="anno ink" x={20} y={N.dlq_mgr.y - 14}>
        RECOVERY LAYER · Pub/Sub · Cloud Run
      </text>
      <text className="anno ink" x={vx.x} y={vx.y - 12}>
        EXECUTION LAYER · Vertex AI
      </text>
      <text className="anno ink" x={N.retry.x} y={N.retry.y - 12}>
        §4.3 Retry max 2 · 60s→300s
      </text>
    </g>
  );
}

export function CanvasScreen() {
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const { snapshot } = useLiveStream();
  const now = useSimNow();
  const { running: simRunning } = useSim();
  const [stageQ, setStageQ] = useQueryState("stage");
  const selStage = stageQ && (STAGE_IDS as string[]).includes(stageQ) ? (stageQ as StageId) : null;
  const [expanded, setExpanded] = useState(true);
  const N = useMemo(() => layout(expanded), [expanded]);
  const E = useMemo(() => edgesDef(N), [N]);
  const B = useMemo(() => bounds(N), [N]);

  /* ── data ── */
  // Per-stage KPI bags only exist on /stages/{id}; live counts already arrive with every SSE tick
  // (snapshot.stageCounts), so the bags are refreshed at a relaxed pace and not at all while the
  // tab is hidden (~1.25 req/s instead of ~5 req/s).
  const metricsRef = useRef<Metrics | undefined>(undefined);
  const stagesQ = useApi(
    ["atlas-stage-metrics"],
    async () => {
      if (metricsRef.current && typeof document !== "undefined" && document.hidden) return metricsRef.current;
      const all = await Promise.all(STAGE_IDS.map((id) => api.stage(id, { limit: 1 })));
      const out: Metrics = {};
      all.forEach((d) => (out[d.stage.id] = d.metrics));
      metricsRef.current = out;
      return out;
    },
    { revalidateOn: ["tick"], throttleMs: 8000 },
  );
  const replaysQ = useApi(["replays", "atlas"], () => api.replays(), { revalidateOn: ["dlq"] });
  const pendQ = useApi(["dead-letters", "atlas-pending"], () => api.deadLetters({ status: ["PENDING_REVIEW"], pageSize: 100 }), { revalidateOn: ["dlq"] });
  const fileQ = useApi(["results-file", "atlas"], () => api.resultFile(), { revalidateOn: ["transition"], throttleMs: 4000 });

  const nodeData: NodeData = {
    metrics: stagesQ.data ?? {},
    capacity: snapshot?.capacity ?? null,
    replays: replaysQ.data,
    pending: pendQ.data?.items,
    resultFile: fileQ.data,
    now,
    stageCounts: snapshot?.stageCounts,
  };

  /* ── lingering terminal tokens + ticker + edge throughput ── */
  const [linger, setLinger] = useState<Map<string, { wf: ActiveWorkflowPos; stage: StageId; until: number }>>(new Map());
  const [ticker, setTicker] = useState<TickerItem[]>([]);
  const hitsRef = useRef<Record<string, number[]>>({});
  const [rates, setRates] = useState<Record<string, number>>({});
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const cometRef = useRef<SVGGElement>(null);
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
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        let dd = e * total;
        let i = 0;
        while (i < lens.length - 1 && dd > lens[i]) {
          dd -= lens[i];
          i++;
        }
        const q = paths[i].getPointAtLength(Math.min(dd, lens[i]));
        g.setAttribute("transform", `translate(${q.x},${q.y})`);
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
      const n = Object.values(N).find((x) => x.stage === stage && !x.sub);
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

  useStreamEvent("transition", (t: TransitionMessage) => {
    const fromStage = t.from ? STATE_TO_STAGE[t.from] : "null";
    const keys = edgeKeysFor(fromStage, t.stage);
    if (t.to === "SUCCEEDED" || t.to === "DEAD_LETTERED") {
      setLinger((m) => new Map(m).set(t.workflow_id, { wf: t.workflow, stage: t.stage, until: performance.now() + 5200 }));
    }
    const tone = STATUS_META[t.to]?.tone ?? "queued";
    if (keys) {
      const nowP = performance.now();
      keys.forEach((k) => (hitsRef.current[k] ??= []).push(nowP));
      comet(keys, t.language, tone);
    }
    if (t.to === "SUCCEEDED" || t.to === "DEAD_LETTERED" || t.to === "RETRY_WAIT") pulse(t.stage);
    setTicker((cur) => [{ id: t.workflow_id + t.at + t.to, wf: t.workflow_id, from: t.from, to: t.to, at: t.at }, ...cur].sort((a, b) => b.at - a.at).slice(0, 3));
  });

  useStreamEvent("tick", () => {
    const p = performance.now();
    const next: Record<string, number> = {};
    for (const e of E) {
      const h = (hitsRef.current[e.k] ?? []).filter((t) => p - t < 30000);
      hitsRef.current[e.k] = h;
      next[e.k] = h.length;
    }
    setRates(next);
    setLinger((m) => {
      let changed = false;
      const n2 = new Map(m);
      for (const [k, v] of m)
        if (v.until < p) {
          n2.delete(k);
          changed = true;
        }
      return changed ? n2 : m;
    });
  });

  /* ── token placement ── */
  const live = useMemo(() => (snapshot?.active ?? []).filter((w) => !TERMINAL.has(w.status)), [snapshot]);
  const lingerList = useMemo(() => [...linger.values()].filter((l) => !live.some((w) => w.workflow_id === l.wf.workflow_id)), [linger, live]);
  const placed = useMemo(() => computePositions(N, expanded, live, lingerList), [N, expanded, live, lingerList]);
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
  const [zoom, setZoom] = useState(0.7);
  const [hint, setHint] = useState(false);
  const [booting, setBooting] = useState(true);
  const fitted = useRef(false);
  const selRef = useRef<StageId | null>(null);
  useEffect(() => {
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
    const mv = miniViewRef.current;
    if (mv) {
      mv.setAttribute("x", String(-v.x / v.k));
      mv.setAttribute("y", String(-v.y / v.k));
      mv.setAttribute("width", String(w.clientWidth / v.k));
      mv.setAttribute("height", String(w.clientHeight / v.k));
    }
    setZoom((z) => (Math.abs(z - v.k) > 0.004 ? v.k : z));
  }, []);

  /** Smart default: fit the whole drawing when that stays legible (≥ 0.62); otherwise open at a
   *  readable scale on the intake → execution core; ⤢ always fits everything. */
  const fit = useCallback(
    (mode: "auto" | "all" = "auto") => {
      const w = wrapRef.current;
      if (!w) return;
      const W = w.clientWidth;
      const H = w.clientHeight;
      const bw = B.x1 - B.x0;
      const bh = B.y1 - B.y0;
      const wide = W > 760;
      // keep the drawing clear of the HUD: below the title block, above the bottom band (measured)
      const tb = w.querySelector<HTMLElement>(".hud.title-block");
      const band = w.querySelector<HTMLElement>(".hud-band");
      const tbBottom = tb && tb.offsetParent ? tb.offsetTop + tb.offsetHeight : 0;
      const bandH = band ? w.clientHeight - band.offsetTop : 0;
      const padTop = wide ? Math.max(46, tbBottom - 18) : 12;
      const padBot = wide ? Math.max(66, bandH + 4) : 60;
      const kAll = Math.max(MIN_K, Math.min(1.1, Math.min((W - 32) / bw, (H - padTop - padBot) / bh)));
      if (mode === "all" || kAll >= 0.62) {
        vw.current = { k: kAll, x: (W - bw * kAll) / 2 - B.x0 * kAll, y: padTop + (H - padTop - padBot - bh * kAll) / 2 - B.y0 * kAll };
        setHint(false);
      } else {
        const k = wide ? Math.min(0.85, Math.max(0.62, (W - 32) / bw)) : 0.62;
        vw.current = { k, x: wide ? (W - bw * k) / 2 - B.x0 * k : 12 - (N.gcs_input.x - 6) * k, y: padTop - (B.y0 + 10) * k };
        setHint(true);
      }
      apply();
    },
    [B, N, apply],
  );

  const zoomAt = useCallback(
    (f: number, cx: number, cy: number) => {
      const v = vw.current;
      const k2 = Math.max(MIN_K, Math.min(MAX_K, v.k * f));
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
      setStageQ(s, { history: "push" });
      setFlashSel((x) => x + 1);
    },
    [setStageQ],
  );

  // when a stage gets selected, make sure its node is on-screen (the inspector narrows the canvas)
  useEffect(() => {
    if (!selStage) return;
    const raf = requestAnimationFrame(() => {
      const w = wrapRef.current;
      const n = Object.values(N).find((x) => x.stage === selStage && !x.sub);
      if (!w || !n) return;
      const v = vw.current;
      const sx0 = v.x + n.x * v.k;
      const sx1 = v.x + (n.x + n.w) * v.k;
      const sy0 = v.y + n.y * v.k;
      const sy1 = v.y + (n.y + n.h) * v.k;
      if (sx0 < 0 || sx1 > w.clientWidth || sy0 < 0 || sy1 > w.clientHeight - 60) {
        vw.current = { ...v, x: w.clientWidth / 2 - (n.x + n.w / 2) * v.k, y: w.clientHeight / 2 - (n.y + n.h / 2) * v.k };
        apply();
      }
      if (window.matchMedia("(max-width: 900px)").matches) document.getElementById("atlas-inspector")?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selStage, flashSel, N, apply, reduced]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".hud") || e.button !== 0) return;
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
    if (tok?.dataset.tok) return router.push(`/atlas/workflows/${tok.dataset.tok}`);
    const node = hit.closest<SVGGElement>("[data-stage]");
    if (node?.dataset.stage) selectStage(node.dataset.stage as StageId);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target as Element;
    const tok = t.closest<SVGGElement>("[data-tok]");
    if (tok?.dataset.tok) {
      e.preventDefault();
      return router.push(`/atlas/workflows/${tok.dataset.tok}`);
    }
    const node = t.closest<SVGGElement>(".node");
    if (node?.dataset.stage) {
      e.preventDefault();
      selectStage(node.dataset.stage as StageId);
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
    vw.current = { ...v, x: w.clientWidth / 2 - wx * v.k, y: w.clientHeight / 2 - wy * v.k };
    apply();
  };

  const lod = lodFor(zoom);
  const toggleDag = useCallback(() => setExpanded((x) => !x), []);
  const liveCount = live.length;

  /* ── inspector width (resizable) ── */
  const [inspW, setInspW] = useState<number | null>(null);

  return (
    <div className="atlas" style={inspW ? { ["--insp-w" as string]: inspW + "px" } : undefined}>
      <div
        className="stage-wrap"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        <svg className={clsx("atlas-svg", booting && "boot")} role="group" aria-label="AIPO 논리 구성 토폴로지: 이벤트 생산자부터 결과 저장, Retry, DLQ, Manual Replay까지. 단계를 선택하면 인스펙터가 열립니다.">
          <defs>
            {(["def", "success", "failed", "retry", "dlq"] as const).map((t) => (
              <marker key={t} id={`at-arr-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" fill={t === "def" ? "var(--ink-3)" : `var(--st-${t})`} />
              </marker>
            ))}
          </defs>
          <g ref={worldRef}>
            <Annotations N={N} />
            <g>
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
            <g>
              {(Object.keys(N) as NodeId[]).map((id) => (
                <NodeShell key={id} id={id} n={N[id]} selected={selStage === N[id].stage} data={nodeData} lod={lod} expanded={expanded} onToggle={toggleDag} />
              ))}
            </g>
            <g>
              {E.filter((e) => e.label).map((e) => (
                <text key={e.k} className="e-label" style={{ ["--ec" as string]: e.tone ? `var(--st-${e.tone})` : "var(--ink-2)" }} x={e.lx} y={e.ly} textAnchor={e.anchor ?? "middle"}>
                  {e.label}
                </text>
              ))}
            </g>
            <g ref={cometRef} />
            <g>
              <AnimatePresence initial={false}>
                {[...placed.pos.entries()].map(([id, [x, y]]) => {
                  const w = tokenWf.get(id);
                  if (!w) return null;
                  const meta = STATUS_META[w.status];
                  const [sx, sy] = startPointFor(N, w, [x, y]);
                  const ringless = ["QUEUED", "RECEIVED", "VALIDATED"].includes(w.status);
                  return (
                    <motion.g
                      key={id}
                      data-tok={id}
                      className={clsx("tok", w.status === "RUNNING" && "running")}
                      tabIndex={-1}
                      initial={reduced ? false : { x: sx, y: sy, opacity: 0 }}
                      animate={{ x, y, opacity: 1 }}
                      exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.4 }}
                      transition={{ duration: reduced ? 0 : 0.7, ease: [0.3, 0.7, 0.2, 1] }}
                    >
                      <title>{`${id}\n${meta.label} · ${w.language} · attempt ${w.attempt}${w.pct ? ` · ${fmt.pct(w.pct, 0)}` : ""}${w.current_node ? " · " + w.current_node : ""}\n클릭하면 Pipeline 상세로 이동`}</title>
                      {ringless ? null : <circle className="ring" r={8.5} stroke={`var(--st-${meta.tone})`} />}
                      <circle className="c" r={5.5} fill={`var(--lg-${w.language})`} />
                      {lod === 2 ? (
                        <text className="tok-lbl" transform="translate(3,-10) rotate(-55)" textAnchor="start">
                          {fmt.shortWorkflowId(id)}
                        </text>
                      ) : null}
                    </motion.g>
                  );
                })}
              </AnimatePresence>
              {Object.entries(placed.overflow).map(([k, v]) => {
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

        <div className="hud title-block" aria-label="도면 정보">
          <div className="tb-h">논리 구성 · 빅스비 실발화 평가</div>
          <div>
            <span className="tb-k">DWG</span>
            <span className="tb-v">AIPO-ORCH-001</span>
          </div>
          <div>
            <span className="tb-k">REF</span>
            <span className="tb-v">§3.1 · §5.1</span>
          </div>
          <div>
            <span className="tb-k">SCALE</span>
            <span className="tb-v">1 : {(1 / zoom).toFixed(2)}</span>
          </div>
          <div>
            <span className="tb-k">LIVE</span>
            <span className="tb-v" suppressHydrationWarning>
              {liveCount} · {fmt.time(now)}
            </span>
          </div>
        </div>

        <div className="hud-band">
          <div className="hud mini" aria-label="미니맵 (클릭하여 이동)">
            <svg viewBox={`${B.x0} ${B.y0} ${B.x1 - B.x0} ${B.y1 - B.y0}`} preserveAspectRatio="xMidYMid meet" onClick={onMini}>
              {(Object.keys(N) as NodeId[]).map((id) => (
                <rect key={id} className="mini-n" x={N[id].x} y={N[id].y} width={N[id].w} height={N[id].h} style={selStage === N[id].stage ? { stroke: "var(--accent)" } : undefined} />
              ))}
              {[...placed.pos.entries()].map(([id, [x, y]]) => {
                const w = tokenWf.get(id);
                return w ? <circle key={id} cx={x} cy={y} r={9} fill={`var(--lg-${w.language})`} /> : null;
              })}
              <rect ref={miniViewRef} className="mini-v" />
            </svg>
          </div>
          <div className="hud legend" aria-label="범례">
            <span className="lt">BATCH TOKEN · 링 = 상태 · 선 굵기·속도 = 처리량</span>
            {LANG_CODES.map((c) => (
              <span key={c} className={`lg-${c}`} title={LANGUAGE_BY_CODE[c].name}>
                <i />
                {c.toUpperCase()} {LANGUAGE_BY_CODE[c].name}
              </span>
            ))}
          </div>
          <div className="hud ticker" aria-label="실시간 상태 전이">
            <div className="th">
              <span>STATE TRANSITIONS</span>
              <span>
                <span className={clsx("live-dot", !simRunning && "off")} /> {simRunning ? "LIVE" : "PAUSED"}
              </span>
            </div>
            <ol>
              <AnimatePresence initial={false}>
                {ticker.map((t) => {
                  const m = STATUS_META[t.to];
                  return (
                    <motion.li
                      key={t.id}
                      initial={reduced ? false : { opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0 } }}
                      transition={{ duration: 0.35 }}
                      className={m ? `tone-${m.tone}` : ""}
                    >
                      <span>{fmt.time(t.at)}</span>
                      <span>
                        <b>{fmt.shortWorkflowId(t.wf)}</b>{" "}
                        <span style={{ color: "var(--tc)" }}>
                          {t.from ? `${t.from} → ` : ""}
                          {t.to}
                        </span>
                      </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </div>
          {hint ? (
            <div className="hud pan-hint" title="드래그해 이동 · ⤢ 버튼으로 전체 도면 보기">
              드래그 · <b>⤢</b> 전체
            </div>
          ) : null}
          <div className="hud zoom">
            <button aria-label="확대" onClick={() => zoomAt(1.2, (wrapRef.current?.clientWidth ?? 0) / 2, (wrapRef.current?.clientHeight ?? 0) / 2)}>
              <Plus />
            </button>
            <div className="zl" aria-live="polite">
              {Math.round(zoom * 100)}%
            </div>
            <button aria-label="축소" onClick={() => zoomAt(1 / 1.2, (wrapRef.current?.clientWidth ?? 0) / 2, (wrapRef.current?.clientHeight ?? 0) / 2)}>
              <Minus />
            </button>
            <button aria-label="전체 도면 맞추기" onClick={() => fit("all")}>
              <Maximize />
            </button>
          </div>
        </div>
      </div>
      {selStage ? <Inspector key={selStage} stage={selStage} onClose={() => selectStage(null)} onWidth={setInspW} /> : null}
    </div>
  );
}
