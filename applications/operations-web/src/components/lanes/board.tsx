"use client";
/**
 * U2 — Orchestration board (centerpiece). Rows = language lanes (capacity slots), columns = state-machine
 * phases. Cards migrate between cells (motion layoutId FLIP) as SSE ticks/transitions arrive; tokens run
 * along the flow-rail edges for every transition; a 2h "time river" shows per-lane spans.
 * Column headers / intake sources open the stage sheet (U3) via URL (?stage=&col=&tab=).
 */
import clsx from "clsx";
import Link from "next/link";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock,
  Gauge,
  Layers,
  PauseCircle,
  Radio,
  Repeat,
  ShieldCheck,
  Target,
  UploadCloud,
  Zap,
} from "lucide-react";
import { DAG_TEMPLATE, LANG_CODES, STAGE_BY_ID, STATUS_META, TERMINAL_STATES } from "@/lib/catalog";
import { api, parseAsInt, parseAsString, useApi, useLiveStream, useQueryStates, useSimNow, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon } from "@/components/shared";
import type { ActiveWorkflowPos, LangCode, StageId, TransitionMessage, WorkflowEvent, WorkflowStatus, WorkflowSummary } from "@/lib/types";
import { Empty, LangTag, Pill, Ring, Tween, dur, langName, pct, shortWf, toneOf, useToast, wfHref } from "./core";
import { StageSheet } from "./stage-sheet";

export interface BoardCol {
  id: string;
  k: string;
  t: string;
  states: WorkflowStatus[];
  stages: StageId[];
  tone: "queued" | "running" | "retry" | "success" | "dlq";
  icon: string;
  svc: string;
  cap?: number;
  mini?: boolean;
  recent?: boolean;
}

export const COLS: BoardCol[] = [
  { id: "intake", k: "01", t: "수신·검증", states: ["RECEIVED", "VALIDATED"], stages: ["ingress", "event_bus", "gcs_input"], tone: "queued", icon: "shield-check", svc: "Cloud Run Ingress" },
  { id: "queue", k: "02", t: "대기열", states: ["QUEUED"], stages: ["registry_queue"], tone: "queued", icon: "list-ordered", svc: "Firestore Pending Queue", cap: 8, mini: true },
  { id: "reserve", k: "03", t: "슬롯 예약", states: ["RESERVED"], stages: ["scheduler"], tone: "queued", icon: "lock", svc: "Language-aware Scheduler" },
  { id: "run", k: "04", t: "실행", states: ["DISPATCHING", "RUNNING"], stages: ["vertex", "workflows"], tone: "running", icon: "cpu", svc: "Cloud Workflows → Vertex AI", cap: 12 },
  { id: "retry", k: "05", t: "재시도 대기", states: ["RETRY_WAIT"], stages: ["retry"], tone: "retry", icon: "rotate-ccw", svc: "Retry Controller · 60s/300s" },
  { id: "done", k: "06", t: "완료", states: ["SUCCEEDED"], stages: ["results"], tone: "success", icon: "file-check", svc: "Result CSV → BigQuery", cap: 3, recent: true },
  { id: "dlq", k: "07", t: "DLQ · 종료", states: ["DEAD_LETTERED", "CANCELLED", "TIMED_OUT"], stages: ["dlq", "workflows"], tone: "dlq", icon: "archive-x", svc: "DLQ Manager · Manual Replay", cap: 3, recent: true },
];
const COL_OF: Partial<Record<WorkflowStatus, number>> = {};
COLS.forEach((c, i) => c.states.forEach((s) => (COL_OF[s] = i)));
const DAY = 864e5;
const MLink = motion.create(Link);

const SHEET_TABS = ["wf", "gcs", "ev", "log", "met"];
const SHEET_PARSERS = { stage: parseAsString, col: parseAsInt, tab: parseAsString.withDefault("wf") };

/** Board card model = summary (when known) + live position from the tick snapshot. */
interface Card {
  id: string;
  language: LangCode;
  status: WorkflowStatus;
  pct: number;
  current_node: string | null;
  attempt: number;
  priority: number;
  replay: boolean;
  queued_at: number | null;
  retry_at: number | null;
  updated_at: number;
  completed_at: number | null;
  errorCode: string | null;
  passRate: number | null;
  processed: number | null;
  total: number | null;
}

function toCard(s: WorkflowSummary | undefined, a: ActiveWorkflowPos | undefined): Card {
  const b = (a ?? s)!;
  return {
    id: b.workflow_id,
    language: b.language,
    status: b.status,
    pct: a ? a.pct : s ? s.progress.pct : 0,
    current_node: b.current_node,
    attempt: b.attempt,
    priority: b.priority,
    replay: (a ? a.replay_cycle : s?.replay_cycle ?? 0) > 0 || !!s?.replay_of,
    queued_at: b.queued_at,
    retry_at: b.retry_at,
    updated_at: b.updated_at,
    completed_at: s?.completed_at ?? null,
    errorCode: s?.error?.code ?? s?.lastErrorCode ?? null,
    passRate: s?.result?.passRate ?? null,
    processed: s?.progress.processed ?? null,
    total: s?.progress.total ?? null,
  };
}

function cardSub(w: Card, now: number): ReactNode {
  switch (w.status) {
    case "RUNNING": {
      const n = DAG_TEMPLATE.find((d) => d.id === w.current_node);
      return <span className="node-tag">{n ? n.labelKo.replace(/\s*\(.*\)$/, "") : "집계"}</span>;
    }
    case "DISPATCHING":
      return "PipelineJob 생성 중";
    case "QUEUED":
      return `대기 ${dur(now - (w.queued_at ?? w.updated_at))} · P${w.priority}`;
    case "RESERVED":
      return `슬롯 확보 · ${fmt.relative(w.updated_at, now)}`;
    case "RECEIVED":
      return "스키마 검증 중";
    case "VALIDATED":
      return "멱등성 확인 완료";
    case "RETRY_WAIT":
      return `재시도 ${w.retry_at ? fmt.relative(w.retry_at, now) : ""}${w.errorCode ? " · " + w.errorCode : ""}`;
    case "SUCCEEDED":
      return w.passRate != null ? `PASS ${Math.round(w.passRate * 100)}%` : "결과 커밋";
    case "DEAD_LETTERED":
      return w.errorCode ?? "DLQ";
    case "CANCELLED":
      return "운영자 취소";
    case "TIMED_OUT":
      return "시간 초과";
  }
}

// ───────────────────────────────────────────── data hook ──
function useBoardData() {
  const { snapshot } = useLiveStream();
  const activeQ = useApi(["lanes-wf-active"], () => api.workflows({ active: true, pageSize: 500 }), { revalidateOn: ["transition"] });
  const doneQ = useApi(
    ["lanes-wf-terminal"],
    () => api.workflows({ status: TERMINAL_STATES, sort: "updated_desc", pageSize: 200 }),
    { revalidateOn: ["transition"], throttleMs: 2500 },
  );
  const cards = useMemo(() => {
    const byId = new Map<string, WorkflowSummary>();
    activeQ.data?.items.forEach((w) => byId.set(w.workflow_id, w));
    doneQ.data?.items.forEach((w) => byId.set(w.workflow_id, w));
    const out = new Map<string, Card>();
    // terminal from the list; active positions from the live tick (fresher)
    doneQ.data?.items.forEach((w) => out.set(w.workflow_id, toCard(w, undefined)));
    if (snapshot) snapshot.active.forEach((a) => out.set(a.workflow_id, toCard(byId.get(a.workflow_id), a)));
    else activeQ.data?.items.forEach((w) => out.set(w.workflow_id, toCard(w, undefined)));
    return [...out.values()];
  }, [activeQ.data, doneQ.data, snapshot]);
  const summaries = useMemo(() => {
    const m = new Map<string, WorkflowSummary>();
    doneQ.data?.items.forEach((w) => m.set(w.workflow_id, w));
    activeQ.data?.items.forEach((w) => m.set(w.workflow_id, w));
    return [...m.values()];
  }, [activeQ.data, doneQ.data]);
  return { snapshot, cards, summaries, loading: !snapshot && activeQ.isLoading };
}

// ───────────────────────────────────────────── screen ──
export function BoardScreen() {
  const [sheet, setSheet] = useQueryStates(SHEET_PARSERS);
  const { snapshot, cards, summaries, loading } = useBoardData();
  const now = useSimNow();
  const openStage = useCallback(
    (stage: StageId, col: number) => setSheet({ stage, col, tab: sheet.stage ? sheet.tab : "wf" }, { history: sheet.stage ? "replace" : "push" }),
    [setSheet, sheet.stage, sheet.tab],
  );
  // URL robustness: an unknown ?stage= (or a bad ?col=/?tab=) is reported and cleared instead of silently ignored
  const toast = useToast();
  const warned = useRef<string | null>(null);
  useEffect(() => {
    if (!sheet.stage) return;
    if (!STAGE_BY_ID[sheet.stage as StageId]) {
      if (warned.current !== sheet.stage) toast(`알 수 없는 단계 '${sheet.stage}' — URL의 stage 값을 무시하고 보드로 돌아갑니다`, "retry");
      warned.current = sheet.stage;
      setSheet({ stage: null, col: null, tab: "wf" }, { history: "replace" });
      return;
    }
    const colOk = sheet.col == null || (COLS[sheet.col]?.stages.includes(sheet.stage as StageId) ?? false);
    const tabOk = SHEET_TABS.includes(sheet.tab ?? "wf");
    if (!colOk || !tabOk) setSheet({ col: colOk ? sheet.col : COLS.findIndex((c) => c.stages.includes(sheet.stage as StageId)), tab: tabOk ? sheet.tab : "wf" }, { history: "replace" });
  }, [sheet.stage, sheet.col, sheet.tab, setSheet, toast]);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [born, setBorn] = useState<Record<string, number>>({});
  useStreamEvent("transition", (t) => {
    const k = Date.now();
    if (!t.from || t.from === "RECEIVED") setBorn((b) => ({ ...b, [t.workflow_id]: k }));
    else setFlash((f) => ({ ...f, [t.workflow_id]: k }));
    setTimeout(() => {
      setFlash((f) => (f[t.workflow_id] === k ? omit(f, t.workflow_id) : f));
      setBorn((b) => (b[t.workflow_id] === k ? omit(b, t.workflow_id) : b));
    }, 1300);
  });

  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Orchestration · Live Board</div>
          <h1>언어 레인 스케줄러 보드</h1>
          <p>
            행은 언어별 레인(Capacity Slot), 열은 Workflow 상태 머신 단계입니다. 배치 카드는 서버 시뮬레이터 틱(SSE)마다 다음 단계로 이동합니다. <b>열 머리글</b>을 누르면 단계 상세(GCS 객체·이벤트·진행 로그·메트릭), <b>카드</b>를 누르면 Pipeline Detail로 이동합니다.
          </p>
        </div>
        <div className="legend">
          {LANG_CODES.map((c) => (
            <LangTag key={c} code={c} />
          ))}
        </div>
      </div>
      <Strip />
      <div style={{ height: 14 }} />
      <River summaries={summaries} now={now} />
      <Intake now={now} onOpen={(s) => openStage(s, 0)} />
      <div className="board-wrap">
        <BoardGrid cards={cards} now={now} loading={loading} flash={flash} born={born} openCol={sheet.stage ? sheet.col : null} onOpen={openStage} snapshotReady={!!snapshot} />
        <div className="board-foot">
          <span className="eyebrow">Legend</span>
          <div className="legend">
            {(
              [
                ["success", "성공"],
                ["running", "실행"],
                ["queued", "대기"],
                ["retry", "재시도"],
                ["failed", "실패"],
                ["dlq", "DLQ"],
                ["cancelled", "취소"],
              ] as const
            ).map(([t, l]) => (
              <span key={t} className={`t-${t}`}>
                <i className="dot" />
                {l}
              </span>
            ))}
          </div>
          <span className="muted" style={{ marginLeft: "auto", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
            카드 링 = 평가 진행률(발화 처리/전체) · A<i>n</i> = Attempt · <Repeat className="i sm" /> = Replay Cycle
          </span>
        </div>
      </div>
      <div className="grid g-12-8" style={{ marginTop: 14 }}>
        <Feed now={now} />
        <AlertsMini />
      </div>
      <StageSheet
        stage={(sheet.stage as StageId) ?? null}
        group={sheet.stage ? groupFor(sheet.stage as StageId, sheet.col) : []}
        title={sheet.col != null && COLS[sheet.col] ? COLS[sheet.col].t : ""}
        tab={sheet.tab ?? "wf"}
        onTab={(tab) => setSheet({ tab })}
        onPick={(stage) => setSheet({ stage })}
        onClose={() => setSheet({ stage: null, col: null, tab: "wf" })}
      />
    </section>
  );
}

function omit<T extends Record<string, unknown>>(o: T, k: string): T {
  const n = { ...o };
  delete n[k];
  return n;
}

function groupFor(stage: StageId, col: number | null): StageId[] {
  if (col != null && COLS[col]?.stages.includes(stage)) return COLS[col].stages;
  return COLS.find((c) => c.stages.includes(stage))?.stages ?? [stage];
}

// ───────────────────────────────────────────── strip ──
function Strip() {
  const { snapshot } = useLiveStream();
  const k = snapshot?.kpis;
  const g = snapshot?.capacity.global;
  const items: [ReactNode, string, number | null | undefined, string | null, ((v: number) => string)?][] = [
    [<Gauge key="g" className="i sm" />, "Global Slot", null, null],
    [<CatalogIcon key="r" name="loader" className="i sm" />, "실행 중", k?.running, "running"],
    [<Clock key="c" className="i sm" />, "대기", k?.pending, "queued"],
    [<CatalogIcon key="rt" name="rotate-ccw" className="i sm" />, "Retry 대기", k?.retryWaiting, "retry"],
    [<CatalogIcon key="d" name="archive-x" className="i sm" />, "DLQ 검토 대기", k?.dlqPendingReview, "dlq"],
    [<CheckCircle2 key="ok" className="i sm" />, "오늘 완료", k?.completedToday, "success"],
    [<Target key="t" className="i sm" />, "오늘 평가 발화", k?.utterancesEvaluatedToday, null],
    [<ShieldCheck key="s" className="i sm" />, "발화 PASS율", k?.utterancePassRateToday != null ? k.utterancePassRateToday * 100 : null, "success", (v) => v.toFixed(1) + "%"],
  ];
  return (
    <div className="strip" aria-label="실시간 요약">
      {items.map(([ic, l, v, tone, f], i) => (
        <div key={l} className={clsx("m", tone && `t-${tone}`)}>
          <span style={tone ? { color: "var(--tc)" } : undefined}>
            {ic}
            <span style={{ color: "var(--ink-3)" }}>{l}</span>
          </span>
          <b>
            {i === 0 ? (
              g ? (
                <>
                  <Tween value={g.active} />
                  <small>/{g.max}</small>
                </>
              ) : (
                "—"
              )
            ) : (
              <Tween value={v ?? null} f={f} />
            )}
          </b>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────── intake ──
function Intake({ now, onOpen }: { now: number; onOpen: (s: StageId) => void }) {
  const o = { revalidateOn: ["tick" as const], throttleMs: 5000, revalidateOnFocus: false };
  const g = useApi(["lanes-stage", "gcs_input", 1], () => api.stage("gcs_input", { limit: 1 }), o).data?.metrics;
  const e = useApi(["lanes-stage", "event_bus", 1], () => api.stage("event_bus", { limit: 1 }), o).data?.metrics;
  const i = useApi(["lanes-stage", "ingress", 1], () => api.stage("ingress", { limit: 1 }), o).data?.metrics;
  const n = (v: unknown) => (typeof v === "number" ? fmt.number(v) : "—");
  return (
    <div className="intake">
      <button type="button" className="src" onClick={() => onOpen("gcs_input")}>
        <span className="ic">
          <UploadCloud className="i" />
        </span>
        <span>
          <small>gs://bixby-utterance-input</small>
          <b>{n(g?.objectsToday)}</b>{" "}
          <span className="muted" style={{ fontSize: 11 }}>
            객체 오늘 · {n(g?.utterancesToday)} 발화 · 마지막 {typeof g?.lastUploadAt === "number" ? fmt.relative(g.lastUploadAt, now) : "—"}
          </span>
        </span>
      </button>
      <span className="wire" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <button type="button" className="src" onClick={() => onOpen("event_bus")}>
        <span className="ic">
          <Radio className="i" />
        </span>
        <span>
          <small>Eventarc · Pub/Sub</small>
          <b>{n(e?.deliveredToday)}</b>{" "}
          <span className="muted" style={{ fontSize: 11 }}>
            전달 · p95 {n(e?.p95DeliveryLatencyMs)}ms · backlog {n(e?.subscriptionBacklog)}
          </span>
        </span>
      </button>
      <span className="wire" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <button type="button" className="src" onClick={() => onOpen("ingress")}>
        <span className="ic">
          <ShieldCheck className="i" />
        </span>
        <span>
          <small>Cloud Run Event Ingress</small>
          <b>{n(i?.validatedToday)}</b>{" "}
          <span className="muted" style={{ fontSize: 11 }}>
            검증 · 중복 무시 {n(i?.duplicatesIgnoredToday)} · 오류 {n(i?.validationErrorsToday)}
          </span>
        </span>
      </button>
      <span className="wire" aria-hidden style={{ maxWidth: 80 }}>
        <i />
      </span>
      <span className="muted" style={{ alignSelf: "center", fontSize: 11, padding: "0 8px", whiteSpace: "nowrap", display: "inline-flex", gap: 4, alignItems: "center" }}>
        <ArrowRight className="i sm" /> 레인 대기열로
      </span>
    </div>
  );
}

// ───────────────────────────────────────────── board grid ──
function BoardGrid({
  cards,
  now,
  loading,
  flash,
  born,
  openCol,
  onOpen,
  snapshotReady,
}: {
  cards: Card[];
  now: number;
  loading: boolean;
  flash: Record<string, number>;
  born: Record<string, number>;
  openCol: number | null;
  onOpen: (s: StageId, col: number) => void;
  snapshotReady: boolean;
}) {
  const { snapshot } = useLiveStream();
  const boardRef = useRef<HTMLDivElement>(null);
  const today0 = now - DAY;
  const buckets = useMemo(() => {
    const b: Record<string, Card[]> = {};
    LANG_CODES.forEach((l) => COLS.forEach((_, i) => (b[l + ":" + i] = [])));
    cards.forEach((w) => {
      const i = COL_OF[w.status];
      if (i == null) return;
      b[w.language + ":" + i]?.push(w);
    });
    COLS.forEach((c, i) =>
      LANG_CODES.forEach((l) => {
        const k = l + ":" + i;
        if (c.recent) b[k].sort((x, y) => (y.completed_at ?? y.updated_at) - (x.completed_at ?? x.updated_at));
        else if (c.id === "queue") b[k].sort((x, y) => y.priority - x.priority || (x.queued_at ?? 0) - (y.queued_at ?? 0));
        else if (c.id === "run") b[k].sort((x, y) => Number(y.status === "RUNNING") - Number(x.status === "RUNNING") || y.pct - x.pct);
      }),
    );
    return b;
  }, [cards]);
  const colCount = (i: number) =>
    LANG_CODES.reduce((s, l) => s + (COLS[i].recent ? buckets[l + ":" + i].filter((w) => (w.completed_at ?? w.updated_at) > today0).length : buckets[l + ":" + i].length), 0);
  const capByLang = useMemo(() => new Map(snapshot?.capacity.languages.map((c) => [c.code, c]) ?? []), [snapshot]);
  const orphans = useApi(["lanes-res-orphan"], () => api.reservations({ status: "ORPHANED" }), { revalidateOn: ["tick"], throttleMs: 10000, revalidateOnFocus: false }).data;

  return (
    <div className="board-scroll">
      <div className="board" ref={boardRef}>
        <FlowRail boardRef={boardRef} />
        <div className="colh lead">
          <span className="k">
            <Layers className="i sm" />
            Lane
          </span>
          <span className="t">언어 · Capacity</span>
          <span className="s">active / max · backlog · 대기</span>
        </div>
        {COLS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`colh t-${c.tone}`}
            data-col={i}
            aria-expanded={openCol === i}
            aria-label={`${c.t} 단계 상세 열기`}
            onClick={() => onOpen(c.stages[0], i)}
          >
            <span className="k">
              {c.k} <CatalogIcon name={c.icon} className="i sm" />
            </span>
            <span className="t">{c.t}</span>
            <span className="n">
              <Tween value={snapshotReady ? colCount(i) : null} />
            </span>
            <span className="s">{c.svc}</span>
            <span className="colh-more">
              상세 <ArrowRight className="i sm" />
            </span>
            <span className="tick" />
          </button>
        ))}
        <LayoutGroup id="lanes-board">
          {LANG_CODES.map((code) => (
            <LaneRow
              key={code}
              code={code}
              cap={capByLang.get(code)}
              orphan={orphans?.filter((r) => r.language === code).length ?? 0}
              buckets={buckets}
              today0={today0}
              now={now}
              loading={loading}
              flash={flash}
              born={born}
            />
          ))}
        </LayoutGroup>
      </div>
    </div>
  );
}

const ST_TONE: Record<string, string> = { OK: "success", SATURATED: "retry", BACKLOGGED: "failed", PAUSED: "cancelled", DISABLED: "cancelled" };
const ST_LBL: Record<string, string> = { OK: "정상", SATURATED: "포화", BACKLOGGED: "적체", PAUSED: "일시중지", DISABLED: "비활성" };

export function Slots({ cap, orphan, lg }: { cap: { running: number; dispatching: number; reserved: number; max: number }; orphan: number; lg?: boolean }) {
  const cols = cap.max > 12 ? Math.ceil(cap.max / 2) : Math.max(cap.max, lg ? 1 : 5);
  const cells: ReactNode[] = [];
  let k = 0;
  for (let i = 0; i < cap.running; i++) cells.push(<i key={k++} className="slot on t-running" title="RUNNING" />);
  for (let i = 0; i < cap.dispatching; i++) cells.push(<i key={k++} className="slot on dim2 t-running" title="DISPATCHING" />);
  for (let i = 0; i < cap.reserved; i++) cells.push(<i key={k++} className="slot on t-queued" title="RESERVED" />);
  for (let i = 0; i < orphan; i++) cells.push(<i key={k++} className="slot orphan" title="ORPHANED reservation (Reconciler 복구 대기)" />);
  while (cells.length < cap.max) cells.push(<i key={k++} className="slot" />);
  return (
    <div className={clsx("slots", lg && "lg")} style={{ ["--cols" as string]: cols }}>
      {cells}
    </div>
  );
}

function LaneRow({
  code,
  cap,
  orphan,
  buckets,
  today0,
  now,
  loading,
  flash,
  born,
}: {
  code: LangCode;
  cap: import("@/lib/types").LanguageCapacity | undefined;
  orphan: number;
  buckets: Record<string, Card[]>;
  today0: number;
  now: number;
  loading: boolean;
  flash: Record<string, number>;
  born: Record<string, number>;
}) {
  const p95bad = cap ? cap.p95WaitSec > cap.p95WaitSloSec : false;
  return (
    <>
      <Link className={`lanehd L-${code}`} href={`/lanes/capacity?lang=${code}`} aria-label={`${langName(code)} Capacity 화면으로`}>
        {cap ? (
          <>
            <div className="nm">
              <b>{cap.name}</b>
              <code>
                {code} · w{cap.priorityWeight}
              </code>
              <span className="st">
                <Pill tone={ST_TONE[cap.status] as never} icon={cap.status === "OK" ? <CheckCircle2 /> : cap.status === "PAUSED" ? <PauseCircle /> : <AlertTriangle />}>
                  {ST_LBL[cap.status] ?? cap.status}
                </Pill>
              </span>
            </div>
            <div className="cap">
              <b>
                <Tween value={cap.active} />
              </b>
              <span>/ {cap.max}</span>
              <span className="muted">slot · {pct(cap.utilization, 0)}</span>
            </div>
            <Slots cap={cap} orphan={orphan} />
            <div className="meta">
              <span>
                Backlog <b className={cap.backlog > cap.backlogAlertThreshold ? "over" : ""}>{cap.backlog}</b>
              </span>
              <span>
                처리 <b>{cap.throughputPerHour}</b>/h
              </span>
              <span>
                평균 대기 <b>{dur(cap.avgWaitSec * 1000)}</b>
              </span>
              <span>
                p95 <b className={p95bad ? "over" : ""}>{dur(cap.p95WaitSec * 1000)}</b>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="nm">
              <b>{langName(code)}</b>
            </div>
            <div className="skel" style={{ height: 26, width: 80 }} />
            <div className="skel" style={{ height: 9, width: 150 }} />
          </>
        )}
      </Link>
      {COLS.map((c, i) => {
        const list = buckets[code + ":" + i];
        const total = c.recent ? list.filter((w) => (w.completed_at ?? w.updated_at) > today0).length : list.length;
        const vis = list.slice(0, c.cap ?? 99);
        const extra = list.length - vis.length;
        return (
          <div key={c.id} className={`cell c-${c.id}`} data-cell={`${code}:${i}`}>
            {vis.map((w) => (
              <BatchCard key={w.id} w={w} mini={!!c.mini} now={now} flash={!!flash[w.id]} born={!!born[w.id]} />
            ))}
            {!vis.length && <span className="zero">{loading ? "…" : "—"}</span>}
            {extra > 0 && (
              <Link className="more" href={`/lanes/explorer?language=${code}&status=${c.states.join(",")}`} title="Pipeline Explorer에서 모두 보기">
                +{extra}
                {c.recent ? ` · 오늘 ${total}` : ""}
              </Link>
            )}
          </div>
        );
      })}
    </>
  );
}

function BatchCard({ w, mini, now, flash, born }: { w: Card; mini: boolean; now: number; flash: boolean; born: boolean }) {
  const m = STATUS_META[w.status];
  const p = w.status === "SUCCEEDED" ? 1 : w.pct || 0;
  const txt = w.status === "RUNNING" || w.status === "SUCCEEDED" ? String(Math.round(p * 100)) : w.status === "QUEUED" ? "P" + w.priority : "";
  const sub = cardSub(w, now);
  const subText = typeof sub === "string" ? sub : DAG_TEMPLATE.find((d) => d.id === w.current_node)?.labelKo ?? "";
  return (
    <MLink
      layoutId={w.id}
      layout="position"
      transition={{ type: "spring", stiffness: 260, damping: 30, mass: 0.8 }}
      href={wfHref(w.id, "/lanes")}
      className={clsx("bc", `t-${m.tone}`, mini && "mini", flash && "flash", born && "born")}
      aria-label={`${w.id} ${m.label} attempt ${w.attempt}`}
      title={`${w.id} · ${m.label} · ${subText}${w.errorCode && w.status !== "SUCCEEDED" ? " · " + w.errorCode : ""}${w.status === "RUNNING" && w.total ? ` · ${Math.round(p * w.total)}/${w.total} 발화` : ""}`}
    >
      <Ring pct={p} text={txt} />
      <span className="bt">
        <span className="id">
          {w.replay && <Repeat className="i sm" aria-label="Replay" />}
          {mini ? "#" + shortWf(w.id).split("-").pop() : shortWf(w.id)}
        </span>
        <span className="sb">
          <CatalogIcon name={m.icon} aria-hidden />
          <span className="sbt">{sub}</span>
        </span>
      </span>
      {w.attempt > 0 && (
        <span className={clsx("att", w.attempt > 1 && "hot")} title={`attempt ${w.attempt}/3`}>
          A{w.attempt}
        </span>
      )}
    </MLink>
  );
}

// ───────────────────────────────────────────── flow rail + live tokens ──
interface RailGeo {
  X: number[];
  Y: number;
}
function FlowRail({ boardRef }: { boardRef: React.RefObject<HTMLDivElement | null> }) {
  const [geo, setGeo] = useState<RailGeo | null>(null);
  const geoRef = useRef<RailGeo | null>(null);
  const tokRef = useRef<SVGGElement>(null);
  const live = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const br = board.getBoundingClientRect();
      const xs = [...board.querySelectorAll<HTMLElement>(".colh[data-col]")].map((h) => {
        const r = h.getBoundingClientRect();
        return r.left - br.left + r.width / 2;
      });
      if (xs.length < 7) return;
      const g = { X: xs, Y: 56 };
      geoRef.current = g;
      setGeo(g);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    return () => ro.disconnect();
  }, [boardRef]);

  const paths = useMemo(() => (geo ? railPaths(geo) : null), [geo]);

  useStreamEvent("transition", (t: TransitionMessage) => {
    if (reduced || !t.from) return;
    const g = geoRef.current;
    const host = tokRef.current;
    if (!g || !host || live.current > 28 || document.hidden) return;
    const d = pathFor(g, t.from, t.to);
    if (!d) return;
    const ns = "http://www.w3.org/2000/svg";
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    const color = `var(--st-${toneOf(t.to)})`;
    const halo = document.createElementNS(ns, "circle");
    halo.setAttribute("r", "8");
    halo.setAttribute("fill", color);
    halo.setAttribute("opacity", ".22");
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("r", "4");
    c.setAttribute("fill", color);
    halo.setAttribute("class", "tok");
    c.setAttribute("class", "tok");
    host.append(p, halo, c);
    live.current++;
    const len = p.getTotalLength();
    const t0 = performance.now();
    const D = 900 + Math.min(900, len * 1.4) + Math.random() * 200;
    const step = (nowT: number) => {
      const k = Math.min(1, (nowT - t0) / D);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = p.getPointAtLength(e * len);
      c.setAttribute("cx", String(pt.x));
      c.setAttribute("cy", String(pt.y));
      halo.setAttribute("cx", String(pt.x));
      halo.setAttribute("cy", String(pt.y));
      if (k < 1) requestAnimationFrame(step);
      else {
        p.remove();
        c.remove();
        halo.remove();
        live.current--;
      }
    };
    requestAnimationFrame(step);
  });

  return (
    <div className="flowrail" aria-hidden>
      <span className="fr-lbl">State flow</span>
      <svg>
        {geo && paths && (
          <>
            {paths.main.map((d, i) => (
              <g key={i}>
                <path className={clsx("edge", i === 3 && "rt")} d={d} />
                <path d={`M${geo.X[i + 1] - 15},${geo.Y - 3.5} L${geo.X[i + 1] - 10},${geo.Y} L${geo.X[i + 1] - 15},${geo.Y + 3.5}`} fill="none" stroke="var(--line-2)" strokeWidth={1.5} />
              </g>
            ))}
            <path className="edge ok" d={paths.succ.d} />
            <path className="edge rt" d={paths.loop} />
            <path className="edge dl" d={paths.tod.d} />
            <path className="edge rp" d={paths.rep.d} />
            <text className="edge-lbl" x={paths.succ.lx} y={paths.succ.ly} textAnchor="middle">
              SUCCESS
            </text>
            <text className="edge-lbl" x={paths.tod.lx} y={paths.tod.ly} textAnchor="middle">
              attempts=3 · non-retryable
            </text>
            <text className="edge-lbl" x={paths.rep.lx} y={paths.rep.ly} textAnchor="middle">
              ↺ Manual Replay → 대기열 재등록
            </text>
            <text className="edge-lbl" x={(geo.X[3] + geo.X[4]) / 2} y={geo.Y - 6} textAnchor="middle" style={{ fill: "var(--st-failed)" }}>
              FAILURE
            </text>
            <text className="edge-lbl" x={(geo.X[3] + geo.X[4]) / 2} y={geo.Y + 22} textAnchor="middle" style={{ fill: "var(--st-retry)" }}>
              attempts &lt; 3
            </text>
            {COLS.map((c, i) => (
              <g key={c.id}>
                <circle cx={geo.X[i]} cy={geo.Y} r={4.5} fill="var(--surface)" stroke={`var(--st-${c.tone})`} strokeWidth={2} />
                <text className="node-lbl" x={geo.X[i]} y={geo.Y + 22} textAnchor="middle">
                  {c.t}
                </text>
                <text className="edge-lbl" x={geo.X[i]} y={geo.Y + 33} textAnchor="middle" style={{ fontSize: 8.5 }}>
                  {c.states.slice(0, 2).join("·")}
                  {c.states.length > 2 ? "…" : ""}
                </text>
              </g>
            ))}
          </>
        )}
        <g ref={tokRef} />
      </svg>
    </div>
  );
}

const bz = (a: number, b: number, c: number, d: number, t: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
function yOnCurve(x0: number, x1: number, ya: number, yb: number, tx: number) {
  let best = { d: 1e9, y: ya };
  for (let t = 0; t <= 1; t += 0.01) {
    const x = bz(x0, x0, x1, x1, t);
    const y = bz(ya, yb, yb, ya, t);
    if (Math.abs(x - tx) < best.d) best = { d: Math.abs(x - tx), y };
  }
  return best.y;
}
function railPaths({ X, Y }: RailGeo) {
  const arc = (a: number, b: number, h: number) => `M${X[a]},${Y} C${X[a]},${Y - h} ${X[b]},${Y - h} ${X[b]},${Y}`;
  const main = [0, 1, 2, 3, 4].map((i) => `M${X[i] + 10},${Y} L${X[i + 1] - 10},${Y}`);
  const succLx = (X[3] + X[5]) / 2;
  const todLx = X[5] + (X[6] - X[5]) * 0.5;
  const repLx = X[2] + (X[3] - X[2]) * 0.55;
  return {
    main,
    succ: { d: arc(3, 5, 44), lx: succLx, ly: yOnCurve(X[3], X[5], Y, Y - 44, succLx) - 5 },
    loop: `M${X[4] - 6},${Y + 4} C${X[4] - 6},${Y + 14} ${X[3] + 6},${Y + 14} ${X[3] + 6},${Y + 4}`,
    tod: { d: arc(4, 6, 22), lx: todLx, ly: yOnCurve(X[4], X[6], Y, Y - 22, todLx) - 6 },
    rep: { d: `M${X[6]},${Y - 3} C${X[6]},${-12} ${X[1]},${-12} ${X[1]},${Y - 3}`, lx: repLx, ly: yOnCurve(X[6], X[1], Y - 3, -12, repLx) + 13 },
  };
}
function pathFor({ X, Y }: RailGeo, from: WorkflowStatus, to: WorkflowStatus): string | null {
  const a = COL_OF[from];
  const b = COL_OF[to];
  if (a == null || b == null || a === b) return null;
  const arc = (p: number, q: number, h: number) => `M${X[p]},${Y} C${X[p]},${Y - h} ${X[q]},${Y - h} ${X[q]},${Y}`;
  if (a === 3 && b === 5) return arc(3, 5, 44);
  if (a === 4 && b === 3) return `M${X[4] - 6},${Y + 4} C${X[4] - 6},${Y + 14} ${X[3] + 6},${Y + 14} ${X[3] + 6},${Y + 4}`;
  if (b === 6 && a === 4) return arc(4, 6, 22);
  if (b === 6 && a === 3) return `M${X[3]},${Y} L${X[4]},${Y} C${X[4]},${Y - 22} ${X[6]},${Y - 22} ${X[6]},${Y}`;
  if (b === 6) return `M${X[a]},${Y} C${X[a]},${Y - 30} ${X[6]},${Y - 30} ${X[6]},${Y}`;
  if (a === 6 && b === 1) return `M${X[6]},${Y - 3} C${X[6]},${-12} ${X[1]},${-12} ${X[1]},${Y - 3}`;
  if (b > a) return `M${X[a]},${Y} L${X[b]},${Y}`;
  return null;
}

// ───────────────────────────────────────────── time river ──
const WINS = [30, 60, 120];
interface Seg {
  a: number;
  b: number;
  k: string;
  t: string;
}
function River({ summaries, now }: { summaries: WorkflowSummary[]; now: number }) {
  const router = useRouter();
  const [win, setWin] = useState(120);
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostW, setHostW] = useState(1200);
  const pinRef = useRef(true);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHostW(el.clientWidth));
    ro.observe(el);
    const onScroll = () => (pinRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 24);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  const W = Math.max(860, hostW);
  useEffect(() => {
    const el = hostRef.current;
    if (el && pinRef.current && el.scrollWidth > el.clientWidth + 4) el.scrollLeft = el.scrollWidth;
  }, [W, now]);

  const LW = 96;
  const R = 56;
  const span = win * 60000;
  const t0 = now - span;
  const x = (t: number) => LW + ((Math.max(t0, Math.min(now, t)) - t0) / span) * (W - LW - R);
  // NOW label flips to the left near the right edge; tick labels it would cover are skipped
  const nowEnd = x(now) > W - 64;
  const nowLblHits = (tx: number) => (nowEnd ? tx > x(now) - 86 && tx < x(now) + 18 : tx > x(now) - 18 && tx < x(now) + 86);
  const RH = 5;
  const GAP = 2;
  const PAD = 8;
  const AX = 20;

  const lanes = LANG_CODES.map((code) => {
    const items: { w: WorkflowSummary; start: number; end: number; segs: Seg[]; row: number }[] = [];
    summaries.forEach((w) => {
      if (w.language !== code) return;
      const start = w.queued_at ?? w.created_at;
      const end = w.completed_at ?? now;
      if (end < t0 || start > now) return;
      const segs: Seg[] = [];
      const runStart = w.started_at;
      if (w.queued_at) {
        const qEnd = runStart ?? (["QUEUED", "RESERVED", "RECEIVED", "VALIDATED"].includes(w.status) ? now : w.queued_at + (w.waitMs ?? 0));
        segs.push({ a: w.queued_at, b: qEnd, k: "queued", t: "대기열" });
      }
      if (runStart) {
        if (w.status === "RETRY_WAIT") {
          segs.push({ a: runStart, b: w.updated_at, k: "failed", t: `Attempt 1–${w.attempt} 실행 · ${w.lastErrorCode ?? ""}` });
          segs.push({ a: w.updated_at, b: w.retry_at ? Math.min(now, w.retry_at) : now, k: "retry", t: `Backoff → 재시도 ${w.retry_at ? fmt.hm(w.retry_at) : ""}` });
        } else {
          const k =
            w.status === "SUCCEEDED" ? "success" : w.status === "DEAD_LETTERED" || w.status === "TIMED_OUT" ? "failed" : w.status === "CANCELLED" ? "cancelled" : "running";
          segs.push({ a: runStart, b: w.completed_at ?? now, k, t: `${w.attemptsCount > 1 ? `Attempt ×${w.attemptsCount}` : "Attempt 1"} · ${STATUS_META[w.status].label}${w.lastErrorCode ? " · " + w.lastErrorCode : ""}` });
        }
      }
      items.push({ w, start, end, segs, row: 0 });
    });
    items.sort((a, b) => a.start - b.start);
    const rowsEnd: number[] = [];
    items.forEach((it) => {
      let r = rowsEnd.findIndex((e) => e < it.start - 30000);
      if (r < 0) {
        r = rowsEnd.length;
        rowsEnd.push(0);
      }
      rowsEnd[r] = it.end;
      it.row = r;
    });
    return { code, items, rows: Math.max(1, rowsEnd.length) };
  });
  let y = AX;
  const laneEls = lanes.map((ln) => {
    const h = Math.max(30, ln.rows * (RH + GAP) + PAD * 2 - GAP);
    const g = (
      <g key={ln.code} transform={`translate(0,${y})`}>
        <rect x={0} y={4} width={3} height={h - 8} rx={1} fill={`var(--l-${ln.code})`} />
        <text className="lane-lbl" x={10} y={h / 2 + 1} dominantBaseline="middle">
          {langName(ln.code)}
        </text>
        <text className="axis" x={10} y={h / 2 + 13} dominantBaseline="middle">
          {ln.items.length} wf
        </text>
        {ln.items.map((it) => {
          const yy = PAD + it.row * (RH + GAP);
          return (
            <g key={it.w.workflow_id} className="span" onClick={() => router.push(wfHref(it.w.workflow_id, "/lanes"))}>
              {it.segs.map((s, i) => {
                if (s.b < t0) return null;
                const x1 = x(s.a);
                const x2 = Math.max(x1 + 1.5, x(s.b));
                return (
                  <rect
                    key={i}
                    x={x1.toFixed(1)}
                    y={yy}
                    width={(x2 - x1).toFixed(1)}
                    height={RH}
                    rx={1.5}
                    fill={`var(--st-${s.k})`}
                    opacity={s.k === "queued" ? 0.45 : 1}
                    fillOpacity={s.k === "retry" ? 0.35 : undefined}
                    stroke={s.k === "retry" ? "var(--st-retry)" : undefined}
                    strokeDasharray={s.k === "retry" ? "2 1" : undefined}
                  >
                    <title>{`${it.w.workflow_id}\n${STATUS_META[it.w.status].label} · attempt ${it.w.attempt}\n${s.t} · ${fmt.hm(s.a)}–${s.b >= now - 1 ? "진행 중" : fmt.hm(s.b)} (${dur(s.b - s.a)})`}</title>
                  </rect>
                );
              })}
              {it.w.status === "DEAD_LETTERED" && it.w.completed_at && it.w.completed_at >= t0 && (
                <path d={`M${x(it.w.completed_at)},${yy - 1.5} l3.5,3.5 l-3.5,3.5 l-3.5,-3.5z`} fill="var(--st-dlq)" />
              )}
            </g>
          );
        })}
        <line className="grid-l" x1={0} x2={W} y1={h} y2={h} />
      </g>
    );
    y += h;
    return g;
  });
  const H = y + 4;
  const step = win <= 30 ? 5 : win <= 60 ? 10 : 15;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / (step * 60000)) * step * 60000; t <= now; t += step * 60000) ticks.push(t);
  return (
    <div className="river">
      <div className="river-h">
        <h2 className="sec">
          <Activity className="i" />
          Time river{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — 레인별 Workflow 구간 (대기 · 실행 · 재시도 Backoff)
          </span>
        </h2>
        <div className="seg" style={{ marginLeft: "auto" }} role="group" aria-label="시간 범위">
          {WINS.map((w) => (
            <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)}>
              {w === 30 ? "30분" : w === 60 ? "1시간" : "2시간"}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-x" ref={hostRef}>
        {summaries.length ? (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 ${win}분 레인별 Workflow 구간`}>
            {ticks
              .filter((t) => x(now) - x(t) > 46)
              .map((t) => (
                <g key={t}>
                  <line className="grid-l" x1={x(t)} x2={x(t)} y1={AX - 4} y2={H} strokeDasharray="2 3" />
                  {!nowLblHits(x(t)) && (
                    <text className="axis" x={x(t)} y={11} textAnchor="middle">
                      {fmt.hm(t)}
                    </text>
                  )}
                </g>
              ))}
            {laneEls}
            <line className="nowline" x1={x(now)} x2={x(now)} y1={AX - 6} y2={H} />
            <text className="nowlbl" x={x(now) + (nowEnd ? -4 : 4)} y={11} textAnchor={nowEnd ? "end" : "start"}>
              NOW {fmt.hm(now)}
            </text>
          </svg>
        ) : (
          <div className="skel" style={{ height: 180 }} />
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────── feed + alerts ──
function Feed({ now }: { now: number }) {
  void now;
  const [feed, setFeed] = useState<(TransitionMessage & { k: number })[]>([]);
  const seed = useApi(["lanes-events", 9], () => api.events({ limit: 9 }), { revalidateOnFocus: false });
  useStreamEvent("transition", (t) => setFeed((f) => [{ ...t, k: Math.random() }, ...f].slice(0, 9)));
  return (
    <div className="panel">
      <div className="panel-h">
        <h2 className="sec">
          <Zap className="i" />
          실시간 전환 스트림
        </h2>
        <span className="r muted" style={{ fontSize: 11 }}>
          Firestore state transitions · SSE
        </span>
      </div>
      <div className="feed">
        {feed.length
          ? feed.map((t, i) => {
              const m = STATUS_META[t.to];
              return (
                <div key={t.k} className={clsx("ev", i === 0 && "new")}>
                  <span className="tm">{fmt.time(t.at)}</span>
                  <span className={`t-${m.tone}`}>
                    <CatalogIcon name={m.icon} />
                  </span>
                  <span className="nm">
                    <LangTag code={t.language} /> {t.from ? STATUS_META[t.from]?.label : "신규"} → <b className={`t-${m.tone} tc`}>{m.label}</b>
                  </span>
                  <Link className="btn sm ghost mono" href={wfHref(t.workflow_id, "/lanes")}>
                    {shortWf(t.workflow_id)}
                  </Link>
                </div>
              );
            })
          : (seed.data ?? []).map((e: WorkflowEvent) => {
              const tone = e.severity === "ERROR" ? "failed" : e.severity === "WARNING" ? "retry" : "queued";
              return (
                <div key={e.event_id} className="ev">
                  <span className="tm">{fmt.time(e.ts)}</span>
                  <span className={`t-${tone}`}>
                    <CatalogIcon name={tone === "queued" ? "circle-dashed" : "alert-triangle"} />
                  </span>
                  <span className="nm">
                    {e.name} <span className="muted">{e.label}</span>
                  </span>
                  {e.workflow_id ? (
                    <Link className="btn sm ghost mono" href={wfHref(e.workflow_id, "/lanes")}>
                      {shortWf(e.workflow_id)}
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
        {!feed.length && !seed.data && <div className="skel" style={{ height: 200 }} />}
      </div>
    </div>
  );
}

function AlertsMini() {
  const q = useApi(["lanes-alerts-open"], () => api.alerts({ status: ["OPEN", "ACKNOWLEDGED"] }), { revalidateOn: ["alert"] });
  const a = (q.data ?? []).slice(0, 6);
  return (
    <div className="panel">
      <div className="panel-h">
        <h2 className="sec">
          <Bell className="i" />
          열린 알림
        </h2>
        <span className="r">
          <Link className="btn sm" href="/lanes/overview#alerts">
            개요에서 처리
          </Link>
        </span>
      </div>
      {q.isLoading ? (
        <div className="skel" style={{ height: 160 }} />
      ) : a.length ? (
        <div className="feed">
          {a.map((x) => (
            <div key={x.alert_id} className="ev">
              <span className="tm">{fmt.time(x.opened_at)}</span>
              <span className={`t-${x.severity === "CRITICAL" ? "failed" : "retry"}`}>
                <AlertTriangle />
              </span>
              <span className="nm body">{x.title}</span>
              <Pill tone={x.status === "OPEN" ? "failed" : "queued"}>{x.status === "OPEN" ? "OPEN" : "ACK"}</Pill>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<CheckCircle2 className="i" />}>열린 알림 없음</Empty>
      )}
    </div>
  );
}
