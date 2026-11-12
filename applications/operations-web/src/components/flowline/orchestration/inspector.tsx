"use client";
/**
 * Stage inspector (slide-over). Any rail stage → GCS objects, accumulated events (JSON payloads),
 * a live progress-log tail that appends from SSE, stage metrics, and the batches currently there.
 */
import clsx from "clsx";
import { motion } from "motion/react";
import { Copy, ExternalLink, FileText, Pause, Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CatalogIcon, EChart, StatusPill, type ChartTokens } from "@/components/shared";
import { STAGE_BY_ID } from "@/lib/catalog";
import { api, useApi, useLiveStream, useSimNow, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import type { GcsObject, LogEntry, StageDetail, StageId, TickSnapshot, WorkflowStatus } from "@/lib/types";
import { accent, axX, axY, baseOpt } from "../chart";
import { wfHref } from "../nav-store";
import { Drawer, Empty, ErrorBox, JsonView, Lang, Skel, dur, useCopy } from "../ui";

export type InspectorTab = "gcs" | "events" | "logs" | "metrics" | "batches";

const SEV_TONE: Record<string, string> = { DEBUG: "cancelled", INFO: "running", NOTICE: "success", WARNING: "retry", ERROR: "failed", CRITICAL: "failed" };

/** Which log lines belong to which stage (same predicates as the prototype). */
const LOGPRED: Record<StageId, (l: LogEntry) => boolean> = {
  gcs_input: (l) => l.event_type === "EVENT_RECEIVED",
  event_bus: (l) => l.event_type === "EVENT_RECEIVED",
  ingress: (l) => l.service === "event-ingress",
  registry_queue: (l) => /^(QUEUED|IDEMPOTENCY_CHECK|VALIDATION_COMPLETED|DUPLICATE_IGNORED)$/.test(l.event_type || ""),
  scheduler: (l) => (l.service === "scheduler" && l.event_type !== "QUEUED") || l.service === "reconciler",
  // Cloud Workflows submits the PipelineJob and then polls it, so task start/finish transitions observed by that poll loop belong here too
  workflows: (l) =>
    ((l.service === "dispatcher" || l.service === "pipeline-orchestrator" || l.event_type === "CANCEL_REQUESTED") && !/^RETRY/.test(l.event_type || "")) ||
    (l.service === "vertex-ai-pipelines" && /^(TASK_STARTED|TASK_COMPLETED|TASK_FAILED)$/.test(l.event_type || "")),
  vertex: (l) => l.service === "vertex-ai-pipelines",
  results: (l) => l.service === "result-commit",
  retry: (l) => /^RETRY/.test(l.event_type || "") || /^(TASK_FAILED|PIPELINE_FAILED)$/.test(l.event_type || ""),
  dlq: (l) => l.service === "dlq-manager" || /DEAD_LETTER|REPLAY/.test(l.event_type || ""),
};

const METRIC_LABEL: Record<string, string> = {
  objectsToday: "오늘 업로드 객체", bytesToday: "오늘 업로드 용량", utterancesToday: "오늘 발화 수", lastUploadAt: "마지막 업로드", byLanguage: "언어별",
  deliveredToday: "오늘 전달", avgDeliveryLatencyMs: "평균 전달 지연", p95DeliveryLatencyMs: "p95 전달 지연", redeliveriesToday: "재전달", subscriptionBacklog: "Subscription backlog", deadLetterTopicMessages: "Dead-letter topic",
  receivedToday: "오늘 수신", validatedToday: "검증 완료", duplicatesIgnoredToday: "중복 무시", validationErrorsToday: "검증 오류", p95RegistrationLatencyMs: "p95 등록 지연", inFlight: "처리 중",
  queued: "대기", oldestQueuedAt: "가장 오래된 대기", p95WaitSec: "p95 대기", activeSlots: "Active slots", globalMax: "Global max", reservationsActive: "ACTIVE 예약", reservationsOrphaned: "ORPHANED 예약", admissionsLastHour: "최근 1시간 admission", saturatedLanguages: "포화 언어",
  dispatching: "Dispatching", executionsToday: "오늘 실행", cancelledToday: "오늘 취소", timedOut7d: "7일 timeout", p95StartLatencyMs: "p95 시작 지연",
  running: "실행 중", runningByComponent: "컴포넌트별 실행", utterancesInFlight: "평가 중 발화", gpuInUse: "GPU 사용", gpuQuota: "GPU 할당량", avgDurationSec: "평균 소요",
  succeededToday: "오늘 성공", rowsWrittenToday: "기록된 행", csvBytesToday: "CSV 용량", bqTable: "BigQuery 테이블", passRateToday: "오늘 Pass rate", aggregateFile: "집계 파일",
  retryWait: "재시도 대기", retriesToday: "오늘 재시도", retryRate: "재시도 비율", nextRetryAt: "다음 재시도", policy: "정책", pendingReview: "검토 대기", total: "전체", byStatus: "상태별", byCategory: "유형별", replays: "Replay",
};

function MetricValue({ k, v, now }: { k: string; v: unknown; now: number }) {
  if (v == null) return <>-</>;
  if (Array.isArray(v)) return <>{v.length ? v.join(", ") : "없음"}</>;
  if (typeof v === "object")
    return (
      <span className="row">
        {Object.entries(v as Record<string, unknown>).map(([a, b]) => (
          <span key={a} className="tag">
            {a} {typeof b === "object" ? JSON.stringify(b) : String(b)}
          </span>
        ))}
      </span>
    );
  if (typeof v === "number") {
    if (/At$/.test(k))
      return (
        <>
          {fmt.time(v)} <small className="sub">{fmt.relative(v, now)}</small>
        </>
      );
    if (/[Bb]ytes/.test(k)) return <>{fmt.bytes(v)}</>;
    if (/Ms$/.test(k)) return <>{dur(v)}</>;
    if (/Sec$/.test(k)) return <>{dur(v * 1000)}</>;
    if (/Rate/.test(k)) return <>{fmt.pct(v, 1)}</>;
    return <>{fmt.number(v)}</>;
  }
  return <>{String(v)}</>;
}

const DEFAULT_TAB = (id: StageId): InspectorTab => (["gcs_input", "vertex", "results", "dlq"].includes(id) ? "gcs" : "events");

export function StageInspector({
  stageId,
  tab,
  onTab,
  onClose,
  onJump,
  hist,
}: {
  stageId: StageId | null;
  tab: InspectorTab | null;
  onTab: (t: InspectorTab) => void;
  onClose: () => void;
  onJump: (id: StageId, tab?: InspectorTab) => void;
  hist: number[];
}) {
  return (
    <Drawer open={!!stageId} onClose={onClose} labelledBy="fl-insp-title">
      {stageId && <InspectorBody key={stageId} stageId={stageId} tab={tab ?? DEFAULT_TAB(stageId)} onTab={onTab} onClose={onClose} onJump={onJump} hist={hist} />}
    </Drawer>
  );
}

function InspectorBody({ stageId, tab, onTab, onClose, onJump, hist }: { stageId: StageId; tab: InspectorTab; onTab: (t: InspectorTab) => void; onClose: () => void; onJump: (id: StageId, tab?: InspectorTab) => void; hist: number[] }) {
  const st = STAGE_BY_ID[stageId];
  const { data: d, error, mutate } = useApi(["stage", stageId], () => api.stage(stageId, { limit: 60 }), { revalidateOn: ["transition", "event"], throttleMs: 2500 });
  const counts = Object.entries(d?.counts ?? {}).filter(([, n]) => n) as [WorkflowStatus, number][];
  const gcs = useStageGcs(d);
  const tabs: [InspectorTab, string, number | string | null][] = [
    ["gcs", "GCS 객체", d ? gcs.objs.length : null],
    ["events", "이벤트", d?.events.length ?? null],
    ["logs", "진행 로그", "LIVE"],
    ["metrics", "메트릭", null],
    ["batches", "배치 목록", d?.workflows.length ?? null],
  ];
  return (
    <>
      <div className="drawer-h">
        <div className="dh-icon">
          <CatalogIcon name={st.icon} aria-hidden />
        </div>
        <div>
          <div className="eyebrow">
            Stage {st.order} · {st.gcpService}
          </div>
          <div className="h1" id="fl-insp-title" style={{ fontSize: 19 }}>
            {st.label.ko}{" "}
            <span className="sub" style={{ fontSize: 13, fontWeight: 500 }}>
              {st.label.en}
            </span>
          </div>
          <div className="sub mono" style={{ marginTop: 2, overflowWrap: "anywhere" }}>
            {st.resource}
          </div>
          <p className="sub" style={{ margin: "6px 0 0" }}>
            {st.description}
          </p>
          <div className="row" style={{ marginTop: 8, gap: 4 }}>
            {counts.length ? (
              counts.map(([s, n]) => (
                <span key={s} className="row" style={{ gap: 3, marginRight: 6 }}>
                  <StatusPill status={s} size="sm" />
                  <b className="mono">{n}</b>
                </span>
              ))
            ) : (
              <span className="sub">이 단계는 상태를 보유하지 않는 전달 구간입니다 (최근 30분 생성분 표시)</span>
            )}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">
          <X aria-hidden />
        </button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([id, l, n]) => (
          <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
            {l}
            {n != null && <span className="ct">{n}</span>}
            {tab === id && <motion.i className="tab-ind" layoutId="fl-insp-tab" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          </button>
        ))}
      </div>
      <div className="drawer-b">
        {error && !d ? (
          <ErrorBox error={error} retry={() => mutate()} />
        ) : !d ? (
          <Skel h={300} />
        ) : tab === "gcs" ? (
          <GcsTab objs={gcs.objs} derived={gcs.derived} onJump={onJump} />
        ) : tab === "events" ? (
          <EventsTab d={d} />
        ) : tab === "logs" ? (
          <LogsTab d={d} stageId={stageId} />
        ) : tab === "metrics" ? (
          <MetricsTab d={d} hist={hist} />
        ) : (
          <BatchesTab d={d} stageId={stageId} />
        )}
      </div>
    </>
  );
}

const INPUT_BUCKET = "bixby-utterance-input";

/**
 * GCS objects for a stage. Storage-facing stages (gcs_input / vertex / results / dlq) return their own
 * objects. Control-plane stages (event_bus … retry) never write to GCS themselves, so we show the input
 * objects of the batches they are currently carrying (or, if idle, the most recent input objects).
 */
function useStageGcs(d: StageDetail | undefined): { objs: GcsObject[]; derived: "batches" | "recent" | null } {
  const own = d?.gcsObjects.length ?? 0;
  const need = !!d && own === 0;
  // delimiter "|" never occurs in object names → flat (recursive) listing of the input bucket
  const { data } = useApi(need ? ["gcs-objects", INPUT_BUCKET, "all"] : null, () => api.gcsObjects({ bucket: INPUT_BUCKET, delimiter: "|", limit: 5000 }), {
    revalidateOn: ["transition"],
    throttleMs: 4000,
  });
  return useMemo(() => {
    if (!d) return { objs: [], derived: null };
    if (own) return { objs: [...d.gcsObjects].sort((a, b) => b.timeCreated - a.timeCreated), derived: null };
    const all = [...(data?.objects ?? [])].sort((a, b) => b.timeCreated - a.timeCreated);
    const ids = new Set(d.workflows.map((w) => w.workflow_id));
    const mine = all.filter((o) => o.workflow_id && ids.has(o.workflow_id));
    if (mine.length) return { objs: mine.slice(0, 40), derived: "batches" };
    return { objs: all.slice(0, 12), derived: all.length ? "recent" : null };
  }, [d, own, data]);
}

function GcsTab({ objs, derived, onJump }: { objs: GcsObject[]; derived: "batches" | "recent" | null; onJump: (id: StageId, tab?: InspectorTab) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const o = objs.find((x) => x.name === sel) ?? objs[0];
  if (!objs.length)
    return (
      <Empty>
        이 단계는 GCS 객체를 직접 다루지 않습니다.
        <br />
        입력 객체는 <b>실발화 입력</b>, 결과는 <b>결과 CSV · BQ</b> 단계에서 확인하세요.
        <div className="row" style={{ marginTop: 10, justifyContent: "center" }}>
          <button className="btn sm" onClick={() => onJump("gcs_input", "gcs")}>
            실발화 입력
          </button>
          <button className="btn sm" onClick={() => onJump("results", "gcs")}>
            결과 저장
          </button>
        </div>
      </Empty>
    );
  return (
    <>
      {derived && (
        <div className="callout t-queued" style={{ marginBottom: 10 }}>
          이 단계는 GCS에 직접 쓰지 않습니다.{" "}
          {derived === "batches" ? <>현재 이 단계에 있는 배치의 <b>입력 객체</b>입니다.</> : <>지금 처리 중인 배치가 없어 <b>최근 입력 객체</b>를 표시합니다.</>}{" "}
          <button className="btn sm" onClick={() => onJump("gcs_input", "gcs")}>
            실발화 입력
          </button>{" "}
          <button className="btn sm" onClick={() => onJump("results", "gcs")}>
            결과 저장
          </button>
        </div>
      )}
      <div className="sub" style={{ marginBottom: 8 }}>
        <span className="mono">gs://{objs[0].bucket}</span> · {objs.length}개 객체 (최신순)
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Object</th>
              <th className="r">Size</th>
              <th>Generation</th>
              <th>생성</th>
            </tr>
          </thead>
          <tbody>
            {objs.map((x) => (
              <tr key={x.name} className={clsx("clickable", o?.name === x.name && "sel")} onClick={() => setSel(x.name)}>
                <td className="mono" style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis" }} title={x.name}>
                  {x.name}
                </td>
                <td className="r mono">{fmt.bytes(x.size)}</td>
                <td className="mono">{x.generation}</td>
                <td className="mono">{fmt.time(x.timeCreated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o && <GcsObjectDetail o={o} />}
    </>
  );
}

function GcsObjectDetail({ o }: { o: GcsObject }) {
  const { data } = useApi(["gcs-object", o.bucket, o.name], () => api.gcsObject({ bucket: o.bucket, name: o.name, limit: 6 }));
  return (
    <div className="panel stack" style={{ padding: 12, marginTop: 12 }}>
      <div className="h2">
        <FileText aria-hidden />
        <span className="mono" style={{ fontSize: 12, overflowWrap: "anywhere", fontWeight: 500 }}>
          {o.uri}
        </span>
      </div>
      <dl className="kv">
        <dt>bucket</dt>
        <dd className="mono">{o.bucket}</dd>
        <dt>generation</dt>
        <dd className="mono">
          {o.generation} (metageneration {o.metageneration})
        </dd>
        <dt>size</dt>
        <dd className="mono">{fmt.bytes(o.size)}</dd>
        <dt>contentType</dt>
        <dd className="mono">{o.contentType}</dd>
        <dt>timeCreated</dt>
        <dd className="mono">{fmt.dateTime(o.timeCreated)}</dd>
        <dt>md5 / crc32c</dt>
        <dd className="mono">
          {o.md5Hash} / {o.crc32c}
        </dd>
        {o.workflow_id && (
          <>
            <dt>workflow</dt>
            <dd>
              <Link className="idlink" href={wfHref(o.workflow_id, { screen: "orch" })}>
                {o.workflow_id}
              </Link>
            </dd>
          </>
        )}
      </dl>
      <div className="eyebrow">metadata</div>
      <JsonView value={o.metadata ?? {}} />
      {data?.content && (
        <>
          <div className="eyebrow">미리보기 (처음 6줄)</div>
          <pre className="json" style={{ maxHeight: 200 }}>
            {data.content}
          </pre>
        </>
      )}
    </div>
  );
}

function EventsTab({ d }: { d: StageDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="sub" style={{ marginBottom: 8 }}>
        Event Registry · Pub/Sub 메시지 {d.events.length}건 (최신순, 실시간 추가) — 행을 누르면 JSON payload
      </div>
      {d.events.length ? (
        d.events.map((e) => (
          <div key={e.event_id}>
            <button type="button" className="feed-row link" style={{ gridTemplateColumns: "86px 14px minmax(0,1fr) auto" }} onClick={() => setOpen(open === e.event_id ? null : e.event_id)} aria-expanded={open === e.event_id}>
              <span className="ft">{fmt.timeMs(e.ts)}</span>
              <span className={`sev-dot t-${SEV_TONE[e.severity] ?? "running"}`} />
              <span className="fn">
                {e.name}
                <small>
                  {e.label} · {e.source}
                </small>
              </span>
              {e.language ? <Lang code={e.language} /> : <span />}
            </button>
            {open === e.event_id && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} style={{ padding: "6px 0 10px", overflow: "hidden" }}>
                <JsonView
                  value={{ event_id: e.event_id, timestamp: e.timestamp, name: e.name, source: e.source, workflow_id: e.workflow_id, correlation_id: e.correlation_id, trace_id: e.trace_id, payload: e.payload }}
                />
                {e.workflow_id && (
                  <Link className="btn sm" style={{ marginTop: 6 }} href={wfHref(e.workflow_id, { screen: "orch", stage: e.stage })}>
                    <ExternalLink aria-hidden />
                    Workflow 열기
                  </Link>
                )}
              </motion.div>
            )}
          </div>
        ))
      ) : (
        <Empty>이벤트가 없습니다</Empty>
      )}
    </>
  );
}

type TermLine = LogEntry & { hb?: boolean; isNew?: boolean };

function heartbeat(stage: StageId, snap: TickSnapshot | null, d: StageDetail): string | null {
  if (!snap) return null;
  const cap = snap.capacity;
  const m = d.metrics as Record<string, number | null>;
  switch (stage) {
    case "gcs_input":
      return `watch gs://bixby-utterance-input · 오늘 객체 ${fmt.number(m.objectsToday ?? 0)} · 마지막 업로드 ${m.lastUploadAt ? fmt.time(m.lastUploadAt) : "-"}`;
    case "event_bus":
      return `subscription backlog ${m.subscriptionBacklog ?? 0} · 오늘 전달 ${fmt.number(m.deliveredToday ?? 0)} · p95 전달 ${dur(m.p95DeliveryLatencyMs)}`;
    case "ingress":
      return `POST /events healthy · 오늘 수신 ${fmt.number(m.receivedToday ?? 0)} · 검증 ${fmt.number(m.validatedToday ?? 0)} · 중복 무시 ${m.duplicatesIgnoredToday ?? 0} · p95 등록 ${dur(m.p95RegistrationLatencyMs)}`;
    case "registry_queue": {
      const q = snap.active.filter((w) => w.status === "QUEUED").sort((a, b) => (a.queued_at ?? 0) - (b.queued_at ?? 0))[0];
      return `pending_queue depth ${cap.languages.map((l) => `${l.code}=${l.backlog}`).join(" ")}${q ? ` · oldest ${q.workflow_id.replace("wf-", "")} (${fmt.relative(q.queued_at, snap.now)})` : ""}`;
    }
    case "scheduler":
      return `admission tick · global ${cap.global.active}/${cap.global.max} · ${cap.languages.map((l) => `${l.code} ${l.active}/${l.max}`).join(" · ")}`;
    case "workflows":
      return `dispatching ${snap.counts.DISPATCHING ?? 0} · running ${snap.counts.RUNNING ?? 0} · timeout watch ok`;
    case "vertex":
      return `PipelineJobs RUNNING ${snap.counts.RUNNING ?? 0} · ${snap.active
        .filter((w) => w.status === "RUNNING")
        .slice(0, 3)
        .map((w) => `${w.workflow_id.replace("wf-", "")} ${Math.round(w.pct * 100)}%`)
        .join(" · ")}`;
    case "retry": {
      const ws = snap.active.filter((w) => w.status === "RETRY_WAIT").sort((a, b) => (a.retry_at ?? 0) - (b.retry_at ?? 0));
      return ws.length ? `RETRY_WAIT ${ws.length}건 · 다음 ${ws[0].workflow_id.replace("wf-", "")} attempt ${ws[0].attempt + 1} at ${fmt.time(ws[0].retry_at)} (${fmt.relative(ws[0].retry_at, snap.now)})` : "RETRY_WAIT 0건 · 대기 중인 재시도 없음";
    }
    case "dlq":
      return `PENDING_REVIEW ${snap.kpis.dlqPendingReview}건 · 전체 ${snap.dlqTotal}`;
    case "results":
      return `오늘 commit ${snap.kpis.completedToday}건 · ${fmt.number(snap.kpis.utterancesEvaluatedToday)} rows · Pass rate ${fmt.pct(snap.kpis.utterancePassRateToday, 1)}`;
    default:
      return null;
  }
}

function LogsTab({ d, stageId }: { d: StageDetail; stageId: StageId }) {
  const { snapshot } = useLiveStream();
  const now = useSimNow();
  const copy = useCopy();
  const [lines, setLines] = useState<TermLine[]>(() => [...d.logs].sort((a, b) => a.ts - b.ts));
  const [paused, setPaused] = useState(false);
  const [buf, setBuf] = useState<TermLine[]>([]);
  const [wf, setWf] = useState("");
  const termRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pred = LOGPRED[stageId];
  const insert = (xs: TermLine[], add: TermLine[]) => {
    const out = [...xs];
    for (const l of add) {
      let i = out.length;
      while (i > 0 && out[i - 1].ts > l.ts) i--;
      out.splice(i, 0, l);
    }
    return out.slice(-400);
  };
  useStreamEvent("log", (l) => {
    if (!pred(l)) return;
    const nl = { ...l, isNew: true };
    if (paused) setBuf((b) => [...b, nl].slice(-400));
    else setLines((xs) => insert(xs, [nl]));
  });
  // heartbeat summary line every 3 s so quiet stages still show they're alive
  const hbRef = useRef({ snapshot, d, paused });
  useEffect(() => {
    hbRef.current = { snapshot, d, paused };
  });
  useEffect(() => {
    const id = setInterval(() => {
      const { snapshot: s, d: dd, paused: p } = hbRef.current;
      if (p || !s?.running) return;
      const msg = heartbeat(stageId, s, dd);
      if (!msg) return;
      setLines((xs) =>
        insert(xs, [
          {
            log_id: "hb-" + s.tick + "-" + Math.random().toString(16).slice(2, 6),
            ts: s.now,
            timestamp: "",
            severity: "DEBUG",
            service: "heartbeat",
            component: "heartbeat",
            event_type: null,
            workflow_id: null,
            pipeline_job_id: null,
            execution_id: null,
            language: null,
            attempt: null,
            batch_id: null,
            error_code: null,
            trace_id: "",
            span_id: "",
            duration_ms: null,
            message: msg,
            stack_trace: null,
            labels: null,
            hb: true,
            isNew: true,
          },
        ]),
      );
    }, 3000);
    return () => clearInterval(id);
  }, [stageId]);
  useLayoutEffect(() => {
    const t = termRef.current;
    if (t && stick.current) t.scrollTop = t.scrollHeight;
  }, [lines, wf]);
  const wfs = useMemo(() => [...new Set([...lines.map((l) => l.workflow_id), ...d.workflows.map((w) => w.workflow_id)].filter(Boolean) as string[])].sort(), [lines, d.workflows]);
  const visible = wf ? lines.filter((l) => l.hb || l.workflow_id === wf) : lines;
  const lastReal = [...lines].reverse().find((l) => !l.hb);
  return (
    <>
      <div className="term-bar">
        <span className={clsx("live", paused && "paused")}>
          <i />
          {paused ? "PAUSED" : "TAIL"}
        </span>
        <span className="sub mono">{STAGE_BY_ID[stageId].services.join(", ") || "event stream"} · 시각순 정렬</span>
        <span style={{ flex: 1 }} />
        <select className="inp mono" value={wf} onChange={(e) => setWf(e.target.value)} style={{ width: "auto", maxWidth: 210, height: 26, fontSize: 11.5 }} aria-label="배치(Workflow) 필터">
          <option value="">전체 배치</option>
          {wfs.map((w) => (
            <option key={w} value={w}>
              {w.replace("wf-", "")}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => copy(visible.map((l) => `${fmt.timeMs(l.ts)} ${l.severity} ${l.workflow_id ?? (l.hb ? "HEARTBEAT" : "system")} [${l.component || l.service}] ${l.message}`).join("\n"), termRef.current)}>
          <Copy aria-hidden />
          복사
        </button>
        <button
          className="btn sm"
          onClick={() => {
            if (paused) {
              setLines((xs) => insert(xs, buf));
              setBuf([]);
            }
            setPaused(!paused);
          }}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? `재개${buf.length ? ` (+${buf.length})` : ""}` : "멈춤"}
        </button>
      </div>
      <div
        className="term"
        ref={termRef}
        tabIndex={0}
        aria-label="실시간 로그"
        onScroll={(e) => {
          const t = e.currentTarget;
          stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
        }}
      >
        {visible.map((l) => (
          <div key={l.log_id} className={clsx("ln", l.isNew && "ln-new", l.hb && "hb")}>
            <span className="ts">{fmt.timeMs(l.ts)}</span> <span className={`sv-${l.severity}`}>{l.severity.padEnd(7)}</span>{" "}
            {l.workflow_id ? (
              <Link className={`wid lc-${l.language ?? ""}`} href={wfHref(l.workflow_id, { screen: "orch", stage: stageId })} title={`${l.workflow_id} · ${l.batch_id ?? ""}${l.pipeline_job_id ? " · " + l.pipeline_job_id : ""}`}>
                <i />
                {l.workflow_id.replace("wf-", "")}
                {l.attempt ? "·a" + l.attempt : ""}
              </Link>
            ) : (
              <span className="wid" style={{ cursor: "default" }}>
                {l.hb ? "HEARTBEAT" : "system"}
              </span>
            )}{" "}
            <span className="svc">[{l.component || l.service}]</span> {l.message}
          </div>
        ))}
        <div className="ln">
          <span className="caret" />
          <span className="idle">{lastReal ? `마지막 이벤트 ${fmt.relative(lastReal.ts, now)} · 수신 대기 중` : "수신 대기 중"}</span>
        </div>
      </div>
      <div className="sub" style={{ marginTop: 6 }}>
        각 줄 = 시각 · 심각도 · 배치(언어·Workflow·Attempt) · 컴포넌트 · 메시지. 배치 ID를 누르면 Pipeline Detail로 이동합니다. <span className="mono">HEARTBEAT</span> 줄은 이 단계의 현재 상태 요약입니다.
      </div>
    </>
  );
}

function MetricsTab({ d, hist }: { d: StageDetail; hist: number[] }) {
  const now = useSimNow();
  const m = d.metrics ?? {};
  const scalars = Object.entries(m).filter(([, v]) => typeof v !== "object" || v == null);
  const objs = Object.entries(m).filter(([, v]) => v && typeof v === "object");
  const option = useMemo(
    () => (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        xAxis: axX(t, hist.map((_, i) => i), { show: false }),
        yAxis: axY(t),
        grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: true },
        series: [{ type: "line", showSymbol: false, smooth: 0.3, data: hist, lineStyle: { color: accent(t), width: 1.6 }, itemStyle: { color: accent(t) }, areaStyle: { color: accent(t), opacity: 0.1 } }],
      }),
    [hist],
  );
  return (
    <>
      <div className="metric-grid">
        {scalars.map(([k, v]) => (
          <div key={k}>
            <small>{METRIC_LABEL[k] ?? k}</small>
            <b>
              <MetricValue k={k} v={v} now={now} />
            </b>
          </div>
        ))}
      </div>
      {objs.map(([k, v]) => (
        <div key={k} style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {METRIC_LABEL[k] ?? k}
          </div>
          <MetricValue k={k} v={v} now={now} />
        </div>
      ))}
      <div style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          스테이지 점유 추이 (최근 {hist.length} 샘플)
        </div>
        <EChart className="chart short" option={option} setOptionOpts={{ notMerge: false }} ariaLabel="스테이지 점유 추이" />
      </div>
    </>
  );
}

function BatchesTab({ d, stageId }: { d: StageDetail; stageId: StageId }) {
  const ws = [...d.workflows].sort((a, b) => b.updated_at - a.updated_at);
  if (!ws.length) return <Empty>이 단계에 머무는 배치가 없습니다</Empty>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Workflow</th>
            <th>상태</th>
            <th>언어</th>
            <th className="r">진행</th>
            <th>버전</th>
            <th>Attempt</th>
          </tr>
        </thead>
        <tbody>
          {ws.map((w) => (
            <tr key={w.workflow_id} className="clickable">
              <td className="mono">
                <Link className="idlink" href={wfHref(w.workflow_id, { screen: "orch", stage: stageId })}>
                  {w.workflow_id}
                </Link>
              </td>
              <td>
                <StatusPill status={w.status} size="sm" />
              </td>
              <td>
                <Lang code={w.language} />
              </td>
              <td className="r mono">{w.status === "RUNNING" ? Math.round(w.progress.pct * 100) + "%" : w.input.utteranceCount + "건"}</td>
              <td className="mono">{w.pipeline_version}</td>
              <td className="mono">{w.attempt || 0}/3</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
