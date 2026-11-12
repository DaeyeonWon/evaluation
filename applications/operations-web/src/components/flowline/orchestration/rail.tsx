"use client";
/**
 * The orchestration rail: the whole AIPO flow drawn as one SVG. Batch tokens dock above each stage
 * (one token = one Workflow), fly along the edges on every SSE `transition`, and stage counts tween.
 */
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CatalogIcon, StatusPill, useTween, usePrefersReducedMotion } from "@/components/shared";
import { LANG_CODES, LANG_LABEL, STAGE_BY_ID, STAGE_EDGES, STATE_TO_STAGE, STATUS_META } from "@/lib/catalog";
import { useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import type { LangCode, StageId, TransitionMessage, WorkflowStatus } from "@/lib/types";
import { wfHref } from "../nav-store";
import { Lang } from "../ui";

export const MAIN: StageId[] = ["gcs_input", "event_bus", "ingress", "registry_queue", "scheduler", "workflows", "vertex", "results"];
export const ALL_STAGES: StageId[] = [...MAIN, "retry", "dlq"];

export const SHORT: Record<StageId, [string, string]> = {
  gcs_input: ["실발화 입력", "Cloud Storage"],
  event_bus: ["이벤트 버스", "Eventarc · Pub/Sub"],
  ingress: ["Event Ingress", "Cloud Run"],
  registry_queue: ["등록 · 대기열", "Firestore"],
  scheduler: ["언어별 스케줄러", "Cloud Run · Txn"],
  workflows: ["Workflows", "Cloud Workflows"],
  vertex: ["Vertex AI", "Pipelines"],
  results: ["결과 CSV · BQ", "GCS · BigQuery"],
  retry: ["재시도 제어", "Retry Controller"],
  dlq: ["DLQ · Replay", "DLQ Manager"],
};
const UNIT: Record<StageId, string> = {
  gcs_input: "오늘 업로드",
  event_bus: "오늘 전달",
  ingress: "검증 중",
  registry_queue: "대기",
  scheduler: "슬롯 확보",
  workflows: "실행 요청",
  vertex: "실행 중",
  results: "오늘 성공",
  retry: "재시도 대기",
  dlq: "검토 대기",
};

const G = { W: 132, H: 96, Y: 64, BW: 150, BH: 70, BY: 232 };
type Pos = { cx: number; y: number; w: number; h: number };
const POS = {} as Record<StageId, Pos>;
MAIN.forEach((id, i) => {
  POS[id] = { cx: 86 + i * 175.43, y: G.Y, w: G.W, h: G.H };
});
POS.retry = { cx: 1051, y: G.BY, w: G.BW, h: G.BH };
POS.dlq = { cx: 700, y: G.BY, w: G.BW, h: G.BH };
const midY = G.Y + G.H / 2;

interface EdgeDef {
  id: string;
  d: string;
  cls: string;
  i: number;
  label?: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "middle" | "end";
}
const EDGES: EdgeDef[] = [];
for (let i = 0; i < MAIN.length - 1; i++) {
  const a = POS[MAIN[i]];
  const b = POS[MAIN[i + 1]];
  EDGES.push({ id: `${MAIN[i]}>${MAIN[i + 1]}`, d: `M${a.cx + a.w / 2},${midY} L${b.cx - b.w / 2},${midY}`, cls: MAIN[i] === "vertex" ? "tone t-success" : "flow", i });
}
EDGES.push({ id: "vertex>retry", d: `M1150,${G.Y + G.H} C1150,${G.BY + 6} 1160,${G.BY + 35} 1126,${G.BY + 35}`, cls: "tone t-failed", label: "FAILURE", lx: 1166, ly: 214, i: 8 });
EDGES.push({ id: "retry>workflows", d: `M1000,${G.BY} C1000,196 963,204 963,${G.Y + G.H}`, cls: "tone t-retry", label: "attempt < 3 · backoff 60s / 300s", lx: 948, ly: 204, anchor: "end", i: 9 });
EDGES.push({ id: "retry>dlq", d: `M976,${G.BY + 35} L775,${G.BY + 35}`, cls: "tone t-dlq", label: "attempt = 3 · 재시도 불가", lx: 875, ly: G.BY + 27, anchor: "middle", i: 10 });
EDGES.push({ id: "dlq>registry_queue", d: `M640,${G.BY} C640,196 612,204 612,${G.Y + G.H}`, cls: "tone t-retry dashed", label: "Manual Replay · 새 Replay Cycle", lx: 598, ly: 204, anchor: "end", i: 11 });

const NODE_TONE: Partial<Record<StageId, string>> = { results: "success", retry: "retry", dlq: "dlq", vertex: "running", workflows: "running" };

function route(from: StageId, to: StageId): string[] {
  const ia = MAIN.indexOf(from);
  const ib = MAIN.indexOf(to);
  if (ia >= 0 && ib > ia) {
    const r: string[] = [];
    for (let i = ia; i < ib; i++) r.push(`${MAIN[i]}>${MAIN[i + 1]}`);
    return r;
  }
  const special: Record<string, string[]> = {
    "vertex>retry": ["vertex>retry"],
    "retry>vertex": ["retry>workflows", "workflows>vertex"],
    "retry>scheduler": ["retry>workflows"],
    "retry>registry_queue": ["retry>workflows"],
    "vertex>dlq": ["vertex>retry", "retry>dlq"],
    "retry>dlq": ["retry>dlq"],
    "dlq>registry_queue": ["dlq>registry_queue"],
    "retry>workflows": ["retry>workflows"],
  };
  return special[`${from}>${to}`] ?? [];
}

export function sparkPath(arr: number[], x: number, y: number, w: number, h: number) {
  const a = arr.length > 1 ? arr : [arr[0] ?? 0, arr[0] ?? 0];
  const max = Math.max(1, ...a);
  const min = Math.min(...a);
  const span = Math.max(1, max - min);
  const pts = a.map((v, i) => [x + (i / (a.length - 1)) * w, y + h - ((v - min) / span) * h]);
  const line = "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" L");
  return { line, area: line + ` L${x + w},${y + h} L${x},${y + h} Z`, end: pts[pts.length - 1] };
}

export interface DockToken {
  workflow_id: string;
  language: LangCode;
  status: WorkflowStatus;
  retry: boolean;
  pct?: number;
}

function TweenText({ value, x, y, className }: { value: number; x: number; y: number; className: string }) {
  const v = useTween(value);
  return (
    <text className={className} x={x} y={y}>
      {fmt.number(v)}
    </text>
  );
}

const Node = memo(function Node({
  id,
  i,
  count,
  hist,
  active,
  onOpen,
  setRef,
}: {
  id: StageId;
  i: number;
  count: number;
  hist: number[];
  active: boolean;
  onOpen: (id: StageId) => void;
  setRef: (id: StageId, el: SVGGElement | null) => void;
}) {
  const p = POS[id];
  const st = STAGE_BY_ID[id];
  const br = st.kind === "branch";
  const x = p.cx - p.w / 2;
  const [lab, sub] = SHORT[id];
  const sp = br ? sparkPath(hist, x + 110, p.y + 44, 30, 18) : sparkPath(hist, x + 74, p.y + 56, 48, 24);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  };
  return (
    <g
      ref={(el) => setRef(id, el)}
      className={clsx("node", br && "branch", `t-${NODE_TONE[id] ?? "accent"}`, active && "active")}
      data-stage={id}
      tabIndex={0}
      role="button"
      aria-label={`${st.label.ko} 상세 열기 · ${count}`}
      style={{ ["--i" as string]: i }}
      onClick={() => onOpen(id)}
      onKeyDown={onKey}
    >
      <rect className="box" x={x} y={p.y} width={p.w} height={p.h} rx={10} />
      <rect className="hot" x={x - 3} y={p.y - 3} width={p.w + 6} height={p.h + 6} rx={12} />
      <g transform={`translate(${x + 10},${p.y + 10})`} className="n-icon">
        <CatalogIcon name={st.icon} size={16} strokeWidth={1.8} />
      </g>
      <text className="n-label" x={x + 31} y={p.y + 23}>
        {lab}
      </text>
      <text className="n-sub" x={x + 12} y={p.y + 41}>
        {sub}
      </text>
      <TweenText className="n-count" x={x + 12} y={p.y + (br ? 63 : 74)} value={count} />
      {br ? (
        <text className="n-unit" x={x + 52} y={p.y + 62}>
          {UNIT[id]}
        </text>
      ) : (
        <text className="n-unit" x={x + 12} y={p.y + 88}>
          {UNIT[id]}
        </text>
      )}
      <path className="spark-a" d={sp.area} />
      <path className="spark" d={sp.line} />
      <circle className="spark-dot" r={2.2} cx={sp.end[0]} cy={sp.end[1]} />
      <title>{`${st.label.ko} — ${st.gcpService}`}</title>
    </g>
  );
});

function Docks({ docks }: { docks: Record<StageId, DockToken[]> }) {
  const router = useRouter();
  const out: React.ReactNode[] = [];
  for (const id of ALL_STAGES) {
    const list = docks[id] ?? [];
    const p = POS[id];
    const br = STAGE_BY_ID[id].kind === "branch";
    const per = br ? 13 : 11;
    const rows = br ? 1 : 2;
    const cap = per * rows;
    const gap = 10.5;
    const show = list.slice(0, cap);
    show.forEach((w, k) => {
      const row = Math.floor(k / per);
      const col = k % per;
      const n = Math.min(per, show.length - row * per);
      const x = p.cx - ((n - 1) * gap) / 2 + col * gap;
      const y = br ? p.y + p.h + 14 : p.y - 12 - row * 12;
      out.push(
        <circle
          key={w.workflow_id}
          className={clsx("tok", `lc-${w.language}`, w.retry && "retry", id === "results" && "dim")}
          cx={+x.toFixed(1)}
          cy={y}
          r={4}
          style={{ cx: +x.toFixed(1), cy: y } as React.CSSProperties}
          onClick={(e) => {
            e.stopPropagation();
            router.push(wfHref(w.workflow_id, { screen: "orch", stage: id }));
          }}
          role="link"
          aria-label={`${w.workflow_id} 상세`}
        >
          <title>{`${w.workflow_id} · ${STATUS_META[w.status]?.label ?? w.status}${w.pct != null && w.status === "RUNNING" ? ` · ${Math.round(w.pct * 100)}%` : ""}`}</title>
        </circle>,
      );
    });
    if (list.length > cap)
      out.push(
        <text key={`more-${id}`} className="more" x={p.cx + p.w / 2 - 2} y={br ? p.y + p.h + 26 : p.y - 34} textAnchor="end">
          +{list.length - cap}
        </text>,
      );
  }
  return <g className="docks">{out}</g>;
}

export function OrchestrationRail({
  counts,
  hist,
  docks,
  activeStage,
  onOpenStage,
  speed,
}: {
  counts: Record<StageId, number>;
  hist: Record<StageId, number[]>;
  docks: Record<StageId, DockToken[]>;
  activeStage: StageId | null;
  onOpenStage: (id: StageId) => void;
  speed: number;
}) {
  const reduced = usePrefersReducedMotion();
  const edgeEls = useRef(new Map<string, SVGPathElement>());
  const nodeEls = useRef(new Map<StageId, SVGGElement>());
  const flyLayer = useRef<SVGGElement>(null);
  const flying = useRef(0);
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  const [ticks, setTicks] = useState<(TransitionMessage & { k: number })[]>([]);
  const seq = useRef(0);

  const setNodeRef = useCallback((id: StageId, el: SVGGElement | null) => {
    if (el) nodeEls.current.set(id, el);
    else nodeEls.current.delete(id);
  }, []);

  const ping = useCallback((id: StageId, tone?: string) => {
    const n = nodeEls.current.get(id);
    if (!n) return;
    if (tone) n.style.setProperty("--tone", `var(--st-${tone})`);
    n.classList.remove("pinged");
    void n.getBBox();
    n.classList.add("pinged");
  }, []);

  const fly = useCallback(
    (lang: LangCode, edges: string[], end: StageId, tone?: string) => {
      const layer = flyLayer.current;
      if (!layer) return;
      if (reduced || !edges.length || flying.current > 24 || document.hidden) {
        ping(end, tone);
        return;
      }
      const paths = edges.map((e) => edgeEls.current.get(e)).filter(Boolean) as SVGPathElement[];
      if (!paths.length) return ping(end, tone);
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", "5");
      c.setAttribute("class", `fly lc-${lang}`);
      layer.appendChild(c);
      flying.current++;
      const lens = paths.map((p) => p.getTotalLength());
      const total = lens.reduce((a, b) => a + b, 0);
      const D = Math.min(2400, 520 + total * 1.6) / Math.sqrt(Math.max(0.25, speedRef.current));
      const t0 = performance.now();
      const step = (t: number) => {
        let k = Math.min(1, (t - t0) / D);
        k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        let dist = k * total;
        let i = 0;
        while (i < lens.length - 1 && dist > lens[i]) {
          dist -= lens[i];
          i++;
        }
        const pt = paths[i].getPointAtLength(Math.min(dist, lens[i]));
        c.setAttribute("cx", String(pt.x));
        c.setAttribute("cy", String(pt.y));
        if (k < 1 && c.isConnected) requestAnimationFrame(step);
        else {
          c.remove();
          flying.current--;
          ping(end, tone);
        }
      };
      requestAnimationFrame(step);
    },
    [reduced, ping],
  );

  useStreamEvent("transition", (t) => {
    const toStage: StageId = t.to === "DEAD_LETTERED" ? "dlq" : STATE_TO_STAGE[t.to] ?? "ingress";
    const tone = STATUS_META[t.to]?.tone;
    if (t.from == null) {
      if ((t.workflow?.replay_cycle ?? 0) > 0) fly(t.language, ["dlq>registry_queue"], "registry_queue", tone);
      else fly(t.language, ["gcs_input>event_bus", "event_bus>ingress"], "ingress", tone);
    } else {
      const fromStage = STATE_TO_STAGE[t.from] ?? "ingress";
      const r = fromStage === toStage ? [] : route(fromStage, toStage);
      fly(t.language, r, toStage, tone);
    }
    const k = ++seq.current;
    setTicks((xs) => [{ ...t, k }, ...xs].slice(0, 4));
  });

  const edgeTitle = useMemo(() => Object.fromEntries(STAGE_EDGES.map((s) => [`${s.from}>${s.to}`, s.label])), []);

  return (
    <div className="rail-panel">
      <div className="rail-head">
        <div>
          <div className="eyebrow">Orchestration · 실시간</div>
          <div className="h2" style={{ marginTop: 3 }}>
            GCS 입력부터 결과 CSV까지, 배치가 지금 어디에 있는지
          </div>
        </div>
        <div className="rail-legend">
          {LANG_CODES.map((l) => (
            <span key={l} className={`lc-${l}`}>
              <i />
              {l.toUpperCase()} {LANG_LABEL[l]}
            </span>
          ))}
          <span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <circle cx="6" cy="6" r="4" fill="none" stroke="var(--st-retry)" strokeWidth="1.6" />
            </svg>
            재시도 중
          </span>
        </div>
      </div>
      <div className="rail-scroll">
        <svg className="rail-svg" viewBox="0 0 1400 350" role="group" aria-label="End-to-end 오케스트레이션 흐름">
          <defs>
            <pattern id="fl-dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle className="grid-dots" cx="1" cy="1" r="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="1400" height="350" fill="url(#fl-dots)" opacity=".55" />
          <text className="lane-label" x="20" y="22">
            MAIN PATH · 배치 토큰 = 1 Workflow
          </text>
          <text className="lane-label" x="20" y={G.BY + 30}>
            RECOVERY LOOP
          </text>
          <text className="n-sub" x="20" y={G.BY + 48}>
            실패 → Retry Controller (최대 3회 실행)
          </text>
          <text className="n-sub" x="20" y={G.BY + 63}>
            → DLQ 격리 → 운영자 승인 → 수동 Replay
          </text>
          <g>
            {EDGES.map((e) => (
              <path
                key={e.id}
                ref={(el) => {
                  if (el) edgeEls.current.set(e.id, el);
                  else edgeEls.current.delete(e.id);
                }}
                className={`edge ${e.cls}`}
                d={e.d}
                style={{ ["--i" as string]: e.i }}
              >
                <title>{edgeTitle[e.id] ?? e.id}</title>
              </path>
            ))}
          </g>
          {EDGES.filter((e) => e.label).map((e) => (
            <text key={`l-${e.id}`} className={`edge-label tone ${e.cls.split(" ").filter((c) => c.startsWith("t-")).join(" ")}`} x={e.lx} y={e.ly} textAnchor={e.anchor ?? "start"}>
              {e.label}
            </text>
          ))}
          <text className="edge-label tone t-success" x="1226" y={midY - 8} textAnchor="middle">
            SUCCESS
          </text>
          <g>
            {ALL_STAGES.map((id, i) => (
              <Node key={id} id={id} i={i} count={counts[id] ?? 0} hist={hist[id] ?? [0]} active={activeStage === id} onOpen={onOpenStage} setRef={setNodeRef} />
            ))}
          </g>
          <Docks docks={docks} />
          <g ref={flyLayer} />
        </svg>
      </div>
      <div className="rail-foot">
        <span>스테이지 클릭 → 인스펙터 · 토큰 클릭 → Pipeline Detail</span>
        <div className="ticker" aria-live="off">
          {ticks.length ? (
            <AnimatePresence initial={false} mode="popLayout">
              {ticks.map((x) => (
                <motion.span
                  key={x.k}
                  className="tk"
                  layout
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                >
                  <Lang code={x.language} />
                  <b>{x.workflow_id.replace("wf-", "")}</b>
                  {x.from && <StatusPill status={x.from} size="sm" />}
                  <ChevronRight aria-hidden />
                  <StatusPill status={x.to} size="sm" />
                </motion.span>
              ))}
            </AnimatePresence>
          ) : (
            <span>상태 전이를 기다리는 중…</span>
          )}
        </div>
      </div>
    </div>
  );
}
