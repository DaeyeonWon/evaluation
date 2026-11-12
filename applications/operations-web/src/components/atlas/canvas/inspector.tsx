"use client";
/**
 * U3 · Stage inspector. Opens for ANY stage: batches currently in the stage (→ S4), GCS objects
 * (bucket / object / generation / size / time), accumulated events as Pub/Sub envelopes (expandable
 * JSON), a live progress-log stream appended from SSE (`log` + `event`), and the stage metric bag.
 */
import clsx from "clsx";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { LangBadge, StatusPill, fmt } from "@/components/shared";
import { BUCKETS, STAGE_BY_ID, STAGES, STATE_TO_STAGE } from "@/lib/catalog";
import { api, useApi, useSimNow, useStreamEvent } from "@/lib/client";
import type { LogEntry, StageId, WorkflowEvent } from "@/lib/types";
import { Empty, JsonView, useReducedMotionSafe } from "../ui";

const INPUT_BUCKET = BUCKETS.input;

const METRIC_KO: Record<string, string> = {
  objectsToday: "오늘 업로드 객체", bytesToday: "오늘 업로드 용량", utterancesToday: "오늘 실발화", lastUploadAt: "마지막 업로드", byLanguage: "언어별",
  deliveredToday: "오늘 전달", avgDeliveryLatencyMs: "평균 전달 지연", p95DeliveryLatencyMs: "p95 전달 지연", redeliveriesToday: "재전달", subscriptionBacklog: "구독 Backlog",
  deadLetterTopicMessages: "DLT 메시지", receivedToday: "오늘 수신", validatedToday: "검증 완료", duplicatesIgnoredToday: "중복 무시", validationErrorsToday: "검증 오류",
  p95RegistrationLatencyMs: "등록 지연 p95", inFlight: "처리 중", queued: "대기 중", oldestQueuedAt: "최장 대기 시작", p95WaitSec: "대기 p95", activeSlots: "활성 Slot",
  globalMax: "Global 상한", reservationsActive: "활성 Reservation", reservationsOrphaned: "Orphan Reservation", admissionsLastHour: "최근 1h 승인", saturatedLanguages: "포화 언어",
  dispatching: "Dispatching", executionsToday: "오늘 Execution", cancelledToday: "오늘 취소", timedOut7d: "7일 Timeout", p95StartLatencyMs: "시작 지연 p95", running: "실행 중",
  runningByComponent: "컴포넌트별 실행", utterancesInFlight: "평가 중 실발화", gpuInUse: "GPU 사용", gpuQuota: "GPU 할당량", avgDurationSec: "평균 실행 시간",
  succeededToday: "오늘 성공", rowsWrittenToday: "기록 행", csvBytesToday: "CSV 용량", bqTable: "BigQuery 테이블", passRateToday: "오늘 Pass rate", aggregateFile: "집계 CSV",
  retryWait: "재시도 대기", retriesToday: "오늘 재시도", retryRate: "Retry 비율", nextRetryAt: "다음 재시도", policy: "정책", pendingReview: "검토 대기", total: "누적",
  byStatus: "상태별", byCategory: "유형별", replays: "Replay",
};
const STAGE_SVC: Record<StageId, string> = {
  gcs_input: "cloud-storage", event_bus: "eventarc", registry_queue: "firestore", scheduler: "scheduler", workflows: "pipeline-orchestrator",
  vertex: "vertex-ai-pipelines", results: "result-commit", retry: "retry-controller", dlq: "dlq-manager", ingress: "event-ingress",
};
const ADR: Partial<Record<StageId, string>> = { workflows: "ADR-001", registry_queue: "ADR-003", results: "ADR-004", scheduler: "ADR-002" };

const MQ = "(max-width: 900px)";
function subscribeMq(cb: () => void) {
  const m = window.matchMedia(MQ);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

function fmtMetric(k: string, v: unknown, now: number): string {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return /At$/.test(k) ? "대기 없음" : "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "없음";
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([a, b]) => `${a} ${typeof b === "object" ? JSON.stringify(b) : b}`).join(" · ");
  if (typeof v === "string") return v;
  const n = v as number;
  if (/At$/.test(k)) return `${fmt.dateTime(n)} (${fmt.relative(n, now)})`;
  if (/Ms$/.test(k)) return fmt.duration(n, { style: "short" });
  if (/Sec$/.test(k)) return fmt.duration(n * 1000, { style: "short" });
  if (/Bytes|bytes/.test(k)) return fmt.bytes(n);
  if (/Rate|rate/.test(k)) return fmt.pct(n, 1);
  return fmt.number(n);
}

function stageLogMatch(stage: StageId, l: LogEntry): boolean {
  if (stage === "gcs_input" || stage === "event_bus") return l.service === "event-ingress" && l.event_type === "EVENT_RECEIVED";
  if (stage === "retry") return l.service === "pipeline-orchestrator" && /retry|RETRY|backoff/.test(l.message);
  if (stage === "workflows") return l.service === "dispatcher" || l.service === "pipeline-orchestrator";
  return STAGE_BY_ID[stage].services.includes(l.service);
}
function eventMatch(stage: StageId, e: WorkflowEvent) {
  return e.stage === stage || (stage === "event_bus" && e.name === "EVENT_PUBLISHED") || (stage === "gcs_input" && e.name === "GCS_OBJECT_FINALIZED");
}
interface Line {
  key: string;
  ts: number;
  severity: string;
  comp: string;
  msg: string;
  fresh?: boolean;
}
const evLine = (e: WorkflowEvent, fresh?: boolean): Line => ({
  key: "ev:" + e.event_id,
  ts: e.ts,
  severity: e.severity || "INFO",
  comp: "event-registry",
  msg: `${e.name}${e.workflow_id ? " · " + e.workflow_id : ""}${e.label ? " · " + e.label : ""}`,
  fresh,
});
const logLine = (l: LogEntry, fresh?: boolean): Line => ({ key: l.log_id, ts: l.ts, severity: l.severity, comp: l.component || l.service, msg: l.message, fresh });

function EventRow({ e, fresh }: { e: WorkflowEvent; fresh?: boolean }) {
  const [open, setOpen] = useState(false);
  const msg = {
    message: {
      messageId: e.event_id,
      publishTime: e.timestamp,
      attributes: { event_type: e.name, stage: e.stage, source: e.source, language: e.language, correlation_id: e.correlation_id, trace_id: e.trace_id },
      data: e.payload,
    },
    subscription: "projects/bixby-eval-prod/subscriptions/ops-event-registry",
  };
  return (
    <div className={clsx("evrow")} style={fresh ? { animation: "at-rowflash 1.4s ease-out" } : undefined}>
      <button aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span className="et">{fmt.time(e.ts)}</span>
        <span className={`en sev-${e.severity}`}>{e.name}</span>
        <span className="ew">{fmt.shortWorkflowId(e.workflow_id ?? "system")}</span>
      </button>
      {open ? <JsonView value={msg} className="wrap" /> : null}
    </div>
  );
}

export function Inspector({ stage, onClose, onWidth }: { stage: StageId; onClose: () => void; onWidth: (w: number) => void }) {
  const st = STAGE_BY_ID[stage];
  const now = useSimNow();
  const reduced = useReducedMotionSafe();
  const q = useApi(["stage-detail", stage], () => api.stage(stage, { limit: 60 }), { revalidateOn: ["tick"], throttleMs: 3000 });
  const d = q.data?.stage.id === stage ? q.data : undefined;
  const [liveEv, setLiveEv] = useState<WorkflowEvent[]>([]);
  const [liveLines, setLiveLines] = useState<Line[]>([]);
  const lastLog = useRef(0);
  const logBox = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const mobile = useSyncExternalStore(subscribeMq, () => window.matchMedia(MQ).matches, () => false);

  useStreamEvent("log", (l) => {
    if (!stageLogMatch(stage, l)) return;
    lastLog.current = Date.now();
    setLiveLines((x) => [...x, logLine(l, true)].slice(-200));
  });
  useStreamEvent("event", (e) => {
    if (!eventMatch(stage, e)) return;
    lastLog.current = Date.now();
    setLiveEv((x) => [e, ...x].slice(0, 80));
    setLiveLines((x) => [...x, evLine(e, true)].slice(-200));
  });
  // state transitions that enter or leave this stage (the registry's view of the stage's traffic)
  useStreamEvent("transition", (m) => {
    const fromStage = m.from ? STATE_TO_STAGE[m.from] : null;
    const enters = m.stage === stage && fromStage !== stage;
    const leaves = fromStage === stage && m.stage !== stage;
    const within = m.stage === stage && fromStage === stage;
    if (!enters && !leaves && !within) return;
    lastLog.current = Date.now();
    const dir = enters ? "진입" : leaves ? `이탈 → ${STAGE_BY_ID[m.stage].label.en}` : "상태 변경";
    setLiveLines((x) =>
      [
        ...x,
        {
          key: `tr:${m.workflow_id}:${m.to}:${m.at}`,
          ts: m.at,
          severity: m.to === "DEAD_LETTERED" || m.to === "TIMED_OUT" ? "ERROR" : m.to === "RETRY_WAIT" ? "WARNING" : "INFO",
          comp: `${STAGE_SVC[stage]}/state`,
          msg: `${m.workflow_id} ${m.from ?? "∅"} → ${m.to} · ${dir} · attempt ${m.workflow.attempt}`,
          fresh: true,
        },
      ].slice(-200),
    );
  });
  useStreamEvent("tick", (t) => {
    if (Date.now() - lastLog.current < 2500 || !d) return;
    lastLog.current = Date.now();
    const pick = Object.entries(d.metrics)
      .filter(([, v]) => v == null || typeof v !== "object" || Array.isArray(v))
      .slice(0, 3)
      .map(([k, v]) => `${k}=${fmtMetric(k, v, t.now)}`)
      .join(" · ");
    setLiveLines((x) => [...x, { key: "hb:" + t.tick, ts: t.now, severity: "DEBUG", comp: `${STAGE_SVC[stage]}/monitor`, msg: `상태 점검 OK · ${pick || "변화 없음"}`, fresh: true }].slice(-200));
  });

  const events = useMemo(() => {
    const seen = new Set<string>();
    return [...liveEv, ...(d?.events ?? [])].filter((e) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true))).slice(0, 60);
  }, [liveEv, d]);
  const freshEv = useMemo(() => new Set(liveEv.map((e) => e.event_id)), [liveEv]);
  const lines = useMemo(() => {
    const seen = new Set<string>();
    const base = [...(d?.logs ?? []).map((l) => logLine(l)), ...(d?.events ?? []).slice(0, 30).map((e) => evLine(e))];
    return [...base, ...liveLines]
      .filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)))
      .sort((a, b) => a.ts - b.ts)
      .slice(-200);
  }, [d, liveLines]);

  useLayoutEffect(() => {
    const b = logBox.current;
    if (b && atBottom.current) b.scrollTop = b.scrollHeight;
  }, [lines]);

  const order = STAGES.findIndex((s) => s.id === stage) + 1;
  const wfs = useMemo(
    () => (d ? (stage === "results" || stage === "dlq" ? d.workflows.slice().sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0)).slice(0, 14) : d.workflows.slice(0, 30)) : []),
    [d, stage],
  );
  // Control-plane stages (event_bus … retry) never write GCS objects themselves. Resolve the input
  // objects (bucket · object · generation) of the batches they carry from the input bucket — or,
  // when the stage is idle, show the most recent uploads so the section is never a dead end.
  const ownObjs = useMemo(() => d?.gcsObjects ?? [], [d]);
  const needInput = !!d && ownObjs.length === 0;
  const inputQ = useApi(
    needInput ? ["gcs-objects", INPUT_BUCKET, "all"] : null,
    () => api.gcsObjects({ bucket: INPUT_BUCKET, delimiter: "|", limit: 5000 }), // "|" never occurs → flat listing
    { revalidateOn: ["transition"], throttleMs: 4000 },
  );
  const { objs, objMode } = useMemo(() => {
    if (ownObjs.length) return { objs: ownObjs.slice(-40).reverse(), objMode: "own" as const };
    const all = inputQ.data?.objects ?? [];
    if (!all.length) return { objs: [], objMode: "own" as const };
    const ids = new Set(wfs.map((w) => w.workflow_id));
    const uris = new Set(wfs.map((w) => w.input.uri));
    const carried = all.filter((o) => (o.workflow_id && ids.has(o.workflow_id)) || uris.has(o.uri));
    if (carried.length) return { objs: carried.sort((a, b) => b.timeCreated - a.timeCreated), objMode: "carried" as const };
    return { objs: all.slice().sort((a, b) => b.timeCreated - a.timeCreated).slice(0, 8), objMode: "recent" as const };
  }, [ownObjs, inputQ.data, wfs]);

  // resizable grip
  const gripRef = useRef<HTMLDivElement>(null);
  const [gripOn, setGripOn] = useState(false);
  useEffect(() => {
    const g = gripRef.current;
    if (!g) return;
    let sx = 0;
    let sw = 0;
    const mv = (e: PointerEvent) => onWidth(Math.max(340, Math.min(780, sw + (sx - e.clientX))));
    const up = () => {
      setGripOn(false);
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    const down = (e: PointerEvent) => {
      sx = e.clientX;
      sw = g.parentElement?.getBoundingClientRect().width ?? 440;
      setGripOn(true);
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
      e.preventDefault();
    };
    g.addEventListener("pointerdown", down);
    return () => g.removeEventListener("pointerdown", down);
  }, [onWidth]);

  return (
    <motion.aside
      className="insp"
      id="atlas-inspector"
      aria-label={`단계 인스펙터: ${st.label.ko}`}
      initial={reduced ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div
        ref={gripRef}
        className={clsx("insp-grip", gripOn && "on")}
        role="separator"
        aria-orientation="vertical"
        aria-label="인스펙터 너비 조절 (← → 키)"
        tabIndex={0}
        onKeyDown={(e) => {
          const cur = gripRef.current?.parentElement?.getBoundingClientRect().width ?? 440;
          if (e.key === "ArrowLeft") onWidth(Math.min(780, cur + 24));
          else if (e.key === "ArrowRight") onWidth(Math.max(340, cur - 24));
        }}
      />
      <div className="insp-head">
        <div className="eyebrow">
          <span>
            STAGE {String(order).padStart(2, "0")} · {st.kind === "branch" ? "BRANCH" : "MAIN"} · {ADR[stage] ?? "§3.1"}
          </span>
          <button className="btn sm ghost icon" onClick={onClose} aria-label="인스펙터 닫기">
            <X />
          </button>
        </div>
        <h2>
          {st.label.ko} <small>{st.label.en}</small>
        </h2>
        <div className="res">
          {st.gcpService} · {st.resource}
        </div>
        <p className="desc">{st.description}</p>
      </div>
      <div className="insp-body">
        <details className="isec" open>
          <summary>
            <span className="ix">00</span>이 단계의 배치<span className="cnt">{d ? d.workflows.length : "…"}</span>
          </summary>
          <div className="ib">
            <div className="wfl">
              {wfs.length ? (
                wfs.map((w) => (
                  <Link key={w.workflow_id} href={`/workflows/${w.workflow_id}`}>
                    <LangBadge lang={w.language} />
                    <span style={{ minWidth: 0 }}>
                      <span className="idc">{w.workflow_id}</span>
                      <br />
                      <span className="muted mono" style={{ fontSize: 10.5 }}>
                        {w.current_node ? `${w.current_node} · ${fmt.pct(w.progress.pct, 0)}` : w.input.object}
                        {w.attempt > 1 ? ` · attempt ${w.attempt}` : ""}
                      </span>
                    </span>
                    <StatusPill status={w.status} size="xs" />
                  </Link>
                ))
              ) : (
                <Empty title={d ? "지금 이 단계에 있는 배치가 없습니다" : "불러오는 중…"} />
              )}
            </div>
          </div>
        </details>
        <details className="isec" open={!mobile}>
          <summary>
            <span className="ix">01</span>GCS 입력 객체<span className="cnt">{objMode === "recent" ? 0 : objs.length || wfs.length}</span>
          </summary>
          <div className="ib">
            {objs.length ? (
              <>
                {objMode !== "own" ? (
                  <div className="muted" style={{ fontSize: 11, paddingBottom: 6 }}>
                    {objMode === "carried"
                      ? `이 단계가 처리 중인 배치의 입력 객체 · gs://${INPUT_BUCKET}`
                      : `지금 이 단계에 머무는 배치가 없어 최근 업로드된 입력 객체를 보여 줍니다 · gs://${INPUT_BUCKET}`}
                  </div>
                ) : null}
                {objs.slice(0, 14).map((o) => (
                  <div className="obj" key={o.uri + o.generation}>
                    <span className="on">
                      gs://{o.bucket}/{o.name}
                    </span>
                    <span className="om">
                      <span>gen {o.generation}</span>
                      <span>{fmt.bytes(o.size)}</span>
                      <span>{fmt.dateTime(o.timeCreated)}</span>
                      {o.workflow_id ? <Link href={`/workflows/${o.workflow_id}`}>{o.workflow_id}</Link> : null}
                    </span>
                  </div>
                ))}
                {objs.length > 14 ? <div className="muted" style={{ fontSize: 11, paddingTop: 6 }}>외 {objs.length - 14}개 객체</div> : null}
              </>
            ) : wfs.length ? (
              wfs.slice(0, 14).map((w) => (
                <div className="obj" key={w.workflow_id}>
                  <span className="on">{w.input.uri}</span>
                  <span className="om">
                    <span>{w.input.utteranceCount} utt</span>
                    <span>{fmt.bytes(w.input.sizeBytes)}</span>
                    <span>{fmt.dateTime(w.created_at)}</span>
                    <Link href={`/workflows/${w.workflow_id}`}>{w.workflow_id}</Link>
                  </span>
                </div>
              ))
            ) : (
              <Empty title="이 단계에 머무는 입력 객체가 없습니다">배치가 들어오면 bucket · object · generation이 여기에 쌓입니다.</Empty>
            )}
          </div>
        </details>
        <details className="isec" open={!mobile}>
          <summary>
            <span className="ix">02</span>누적 이벤트 · Pub/Sub 메시지<span className="cnt">{events.length}</span>
          </summary>
          <div className="ib">{events.length ? events.map((e) => <EventRow key={e.event_id} e={e} fresh={freshEv.has(e.event_id)} />) : <Empty title="이벤트가 아직 없습니다" />}</div>
        </details>
        <details className="isec" open>
          <summary>
            <span className="ix">03</span>평가 진행 로그 <span className="live-dot" style={{ marginLeft: 4 }} />
            <span className="cnt">LIVE · {lines.length}</span>
          </summary>
          <div className="ib">
            <div
              className="logstream"
              ref={logBox}
              role="log"
              aria-live="off"
              onScroll={(e) => {
                const b = e.currentTarget;
                atBottom.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
              }}
            >
              {lines.length ? (
                lines.map((l) => (
                  <div key={l.key} className={l.fresh ? "new" : undefined}>
                    <span className="lt">{fmt.timeMs(l.ts)}</span> <span className={`sev-${l.severity}`}>{l.severity.padEnd(7, " ")}</span>{" "}
                    <span className="muted">[{l.comp}]</span> {l.msg}
                  </div>
                ))
              ) : (
                <div className="muted">이 단계의 로그를 기다리는 중…</div>
              )}
            </div>
          </div>
        </details>
        <details className="isec" open>
          <summary>
            <span className="ix">04</span>메트릭
          </summary>
          <div className="ib">
            <div className="mgrid">
              {d
                ? Object.entries(d.metrics).map(([k, v]) => (
                    <div key={k}>
                      <div className="k">{METRIC_KO[k] ?? k}</div>
                      <div className={clsx("v", typeof v === "object" && "obj-v")}>{fmtMetric(k, v, now)}</div>
                    </div>
                  ))
                : null}
            </div>
          </div>
        </details>
      </div>
    </motion.aside>
  );
}
