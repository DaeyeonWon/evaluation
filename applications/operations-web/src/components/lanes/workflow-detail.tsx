"use client";
/**
 * S4 — Pipeline Detail (/lanes/workflows/[id]). Summary · state machine · DAG (attempt switch, node → inspector)
 * · event timeline (click event → linked logs) · log explorer (filters, trace, stack, JSON, copy/export)
 * · attempt history (+ replay chain) · cancel (POST /cancel). Attempt/node live in the URL (?attempt=&node=).
 */
import clsx from "clsx";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useParams } from "next/navigation";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArchiveX,
  ArrowLeft,
  Ban,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  Download,
  GitBranch,
  History,
  Info,
  LayoutGrid,
  Layers,
  Repeat,
  RotateCcw,
  Search,
  Target,
  Terminal,
  X,
} from "lucide-react";
import {
  ATTEMPT_STATUS_META,
  DLQ_STATUS_META,
  FAILURE_CATEGORY_META,
  NODE_STATUS_META,
  SEVERITY_META,
  STATUS_META,
  TERMINAL_STATES,
} from "@/lib/catalog";
import { api, downloadText, parseAsInt, parseAsString, revalidateKey, useApi, useQueryStates, useSimNow, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, StatusPill } from "@/components/shared";
import type { Attempt, DagNode, LogEntry, Workflow, WorkflowEvent, WorkflowStatus } from "@/lib/types";
import { opName, CopyId, Empty, JsonView, LangTag, Meter, Pill, dur, pct, shortWf, useAction, useCan, useCopy, useHere, useToast, wfHref } from "./core";

const PARSERS = { attempt: parseAsInt, node: parseAsString, from: parseAsString };
const POS: Record<string, [number, number]> = { preprocess: [0, 1], intent_eval: [1, 0], response_eval: [1, 1], latency_check: [1, 2], aggregate: [2, 1], persist: [3, 1] };
const NW = 196;
const NH = 66;
const CX = 236;
const RY = 84;
const PADX = 16;
const PADY = 14;
const SEV_ORDER = ["DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"];

function evTone(e: WorkflowEvent) {
  if (/FAILED|TIMEOUT|DEAD_LETTER/.test(e.name) || e.severity === "ERROR") return "failed";
  if (/RETRY/.test(e.name) || e.severity === "WARNING") return "retry";
  if (/SUCCEEDED|COMPLETED|COMMITTED/.test(e.name)) return "success";
  if (/CANCEL/.test(e.name)) return "cancelled";
  if (/STARTED|SUBMITTED|RESERVED/.test(e.name)) return "running";
  return "queued";
}

interface LogFilter {
  sev: string;
  comp: string;
  ev: string;
  att: string;
  q: string;
  evk: { id: string; name: string; ts: number; attempt: number | null; how: string; ids: Set<string> } | null;
}
const EMPTY_LF: LogFilter = { sev: "", comp: "", ev: "", att: "", q: "", evk: null };

export function WorkflowDetailScreen() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [qs, setQs] = useQueryStates(PARSERS);
  const wfQ = useApi(["lanes-wf", id], () => api.workflow(id), { revalidateOn: ["transition"], throttleMs: 1200 });
  const w = wfQ.data && wfQ.data.workflow_id === id ? wfQ.data : undefined;
  const active = w ? !TERMINAL_STATES.includes(w.status) : false;
  // running node progress changes every tick without a transition → poll while active
  useApi(active ? ["lanes-wf", id] : null, () => api.workflow(id), { revalidateOn: ["tick"], throttleMs: 2400 });

  if (wfQ.error && !w)
    return (
      <section className="screen">
        <Empty icon={<Search className="i" />} style={{ marginTop: 40 }}>
          Workflow <b className="mono">{id}</b> 를 찾을 수 없습니다 — {String((wfQ.error as Error).message)}
          <div style={{ marginTop: 8 }}>
            <Link className="btn" href="/lanes/explorer">
              Explorer로
            </Link>
          </div>
        </Empty>
      </section>
    );
  if (!w)
    return (
      <section className="screen">
        <div className="skel" style={{ height: 90, marginBottom: 14 }} />
        <div className="skel" style={{ height: 70, marginBottom: 14 }} />
        <div className="skel" style={{ height: 320 }} />
      </section>
    );
  const atts = w.attempts ?? [];
  const attNo = qs.attempt ?? w.attempt ?? atts[atts.length - 1]?.attempt ?? 1;
  const att: Attempt | undefined = atts.find((a) => a.attempt === attNo) ?? atts[atts.length - 1];
  return (
    <section className="screen stagger" key={id}>
      <Hero w={w} onChanged={() => wfQ.mutate()} />
      <div className="panel" style={{ marginBottom: 14, padding: "10px 14px" }}>
        <StateMachine w={w} />
      </div>
      <h2 className="sec" style={{ margin: "0 0 8px" }}>
        ① Workflow Summary
      </h2>
      <Summary w={w} />
      <DetailBody w={w} att={att} node={qs.node} setAtt={(a) => setQs({ attempt: a, node: null })} setNode={(n) => setQs({ node: n, attempt: att?.attempt ?? null })} />
    </section>
  );
}

function Hero({ w, onChanged }: { w: Workflow; onChanged: () => void }) {
  const { can } = useCan();
  const act = useAction();
  const toast = useToast();
  const now = useSimNow();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const term = TERMINAL_STATES.includes(w.status);
  const dl = useApi(w.dead_letter_id ? ["lanes-dl", w.dead_letter_id] : null, () => api.deadLetter(w.dead_letter_id!), { revalidateOn: ["dlq"] }).data?.deadLetter;
  const doCancel = async () => {
    if (!reason.trim()) {
      toast("취소 사유를 입력하세요", "retry");
      return;
    }
    setBusy(true);
    const r = await act(() => api.cancelWorkflow(w.workflow_id, { reason: reason.trim() }), (x) => (
      <>
        <b className="mono">{x.workflow_id}</b> 취소 요청 → {STATUS_META[x.status].label} · 감사 로그 기록
      </>
    ));
    setBusy(false);
    if (r) {
      setConfirm(false);
      setReason("");
      onChanged();
      revalidateKey("lanes-wf");
    }
  };
  return (
    <div className="wf-hero">
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">Screen 4 · Pipeline Detail · {w.event_type}</div>
        <h1>{w.workflow_id}</h1>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
          <StatusPill status={w.status} />
          <LangTag code={w.language} />
          <Pill icon={<Layers />}>{w.pipeline_version}</Pill>
          <Pill tone={w.attempt > 1 ? "retry" : "queued"} icon={<RotateCcw />}>
            Attempt {w.attempt}/3
          </Pill>
          {w.replay_cycle > 0 && (
            <Pill tone="dlq" icon={<Repeat />}>
              Replay cycle {w.replay_cycle}
            </Pill>
          )}
          <span className="muted" style={{ fontSize: 11.5 }}>
            priority {w.priority} · 갱신 {fmt.relative(w.updated_at, now)}
          </span>
        </div>
      </div>
      <div className="acts">
        <Link className="btn" href="/lanes">
          <LayoutGrid />
          보드에서 보기
        </Link>
        {w.status === "SUCCEEDED" && (
          <Link className="btn" href={`/lanes/results?workflow_id=${encodeURIComponent(w.workflow_id)}`}>
            <Target />
            평가 결과 보기
          </Link>
        )}
        {w.dead_letter_id && (
          <Link className="btn dlqb" href={`/lanes/dlq?id=${encodeURIComponent(w.dead_letter_id)}`}>
            <ArchiveX />
            DLQ에서 Replay{dl ? ` (${DLQ_STATUS_META[dl.status].label})` : ""}
          </Link>
        )}
        {!term && (
          <button type="button" className="btn warn" disabled={!can("cancel")} title={can("cancel") ? undefined : "Operator 이상 권한 필요"} onClick={() => setConfirm(true)}>
            <Ban />
            실행 취소
          </button>
        )}
      </div>
      <AnimatePresence>
        {confirm && !term && (
          <motion.div
            className="confirm warn"
            style={{ gridColumn: "1/-1" }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <div className="steps">
              <span className="on" />
              <span className="on" />
              <span />
            </div>
            <b>Workflow 취소 확인</b>
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12 }}>
              {w.status === "RUNNING"
                ? "Vertex AI PipelineJob 취소 요청 → 실제 종료 확인 후 Slot을 반환합니다. 실행 중 노드는 CANCELLED 처리됩니다."
                : "대기열/예약에서 제거하고 Slot을 즉시 반환합니다."}
            </p>
            <form
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
              onSubmit={(e) => {
                e.preventDefault();
                void doCancel();
              }}
            >
              <input className="inp" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="취소 사유 (필수)" style={{ flex: 1, minWidth: 200 }} />
              <button type="button" className="btn" onClick={() => setConfirm(false)}>
                돌아가기
              </button>
              <button type="submit" className="btn warn" disabled={busy}>
                <Ban />
                취소 확정
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StateMachine({ w }: { w: Workflow }) {
  const flow: WorkflowStatus[] = ["RECEIVED", "VALIDATED", "QUEUED", "RESERVED", "DISPATCHING", "RUNNING"];
  const term = TERMINAL_STATES.includes(w.status) ? w.status : w.status === "RETRY_WAIT" ? "RETRY_WAIT" : "SUCCEEDED";
  const seq = flow.concat((w.attempts?.length ?? 0) > 1 || w.status === "RETRY_WAIT" ? ["RETRY_WAIT"] : []).concat(term !== "RETRY_WAIT" ? [term] : []);
  const hist: Record<string, number[]> = {};
  (w.status_history ?? []).forEach((h) => (hist[h.status] = hist[h.status] ?? []).push(h.at));
  const curIdx = seq.lastIndexOf(w.status);
  const now = useSimNow();
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <span className="eyebrow">State machine</span>
        {w.error && (
          <>
            <Pill tone="failed" icon={<AlertTriangle />}>
              {w.error.code} · {w.error.node ?? ""}
            </Pill>
            <span className="muted" style={{ fontSize: 11.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {w.error.message}
            </span>
          </>
        )}
        {w.status === "RETRY_WAIT" && w.retry_at && (
          <Pill tone="retry" icon={<Clock />}>
            재시도 {fmt.relative(w.retry_at, now)} ({fmt.time(w.retry_at)})
          </Pill>
        )}
      </div>
      <div className="statemap" aria-label="상태 머신 진행">
        {seq.map((s, i) => {
          const done = i < curIdx;
          const cur = i === curIdx;
          const t = STATUS_META[s].tone;
          const h = hist[s];
          return (
            <div key={s + i} className={clsx("sm", `t-${cur ? t : done ? "success" : "queued"}`, (done || cur) && "done", cur && "cur")}>
              <i />
              <b style={{ fontSize: 10.5 }}>{STATUS_META[s].label}</b>
              <span className="mono dim">{h ? fmt.time(h[h.length - 1]) + (h.length > 1 ? " ×" + h.length : "") : ""}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Summary({ w }: { w: Workflow }) {
  const here = useHere();
  const res = w.result;
  const cells: [string, ReactNode, string?][] = [
    ["Workflow ID", <CopyId key="a" text={w.workflow_id} />, "w2"],
    ["상태", <StatusPill key="b" status={w.status} />],
    ["언어", <LangTag key="c" code={w.language} />],
    ["Pipeline 버전", <span key="d" className="mono">{w.pipeline_version}</span>],
    ["Attempt", <span key="e" className="mono">{w.attempt} / 3</span>],
    ["시작", <span key="f" className="mono">{w.started_at ? fmt.dateTime(w.started_at) : "—"}</span>],
    ["종료", <span key="g" className="mono">{w.completed_at ? fmt.dateTime(w.completed_at) : "—"}</span>],
    ["대기 (queue→slot)", <span key="h" className="mono">{dur(w.waitMs)}</span>],
    ["실행 (attempt 합계)", <span key="i" className="mono">{dur(w.runMs)}</span>],
    ["전체 소요", <span key="j" className="mono">{dur(w.totalMs)}</span>],
    ["Batch", <span key="k" className="mono">{w.batch_id}</span>],
    [
      "입력 데이터",
      <span key="l">
        <CopyId text={w.input.uri} />
        <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
          {fmt.number(w.input.utteranceCount)} 발화 · {fmt.bytes(w.input.sizeBytes)} · generation <span className="mono">{w.input.generation}</span>
        </div>
      </span>,
      "w3",
    ],
    [
      "결과 Artifact",
      res ? (
        <span key="m">
          <CopyId text={res.uri} />
          <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
            {fmt.number(res.rows)}행 · PASS {pct(res.passRate)} ({res.passCount}/{res.rows}) · {fmt.bytes(res.sizeBytes)} · BQ <span className="mono">{res.bqTable}</span>
          </div>
        </span>
      ) : (
        <span key="m" className="muted" style={{ fontWeight: 400 }}>
          {w.status === "SUCCEEDED" ? "커밋 중" : "아직 없음 — 성공 시 gs://bixby-eval-results/… 생성"}
        </span>
      ),
      "w3",
    ],
    ["PipelineJob ID", <CopyId key="n" text={w.pipeline_job_id} />, "w2"],
    ["Workflow Execution", <CopyId key="o" text={w.workflow_execution_id}>{w.workflow_execution_id?.split("/").pop()}</CopyId>, "w2"],
    ["Trace ID", <CopyId key="p" text={w.trace_id} />],
    ["Correlation", <CopyId key="q" text={w.correlation_id} />],
    ["Idempotency Key", <CopyId key="r" text={w.idempotency_key}>{fmt.shortHash(w.idempotency_key, 16)}…</CopyId>, "w2"],
    ["Reservation", <span key="s" className="mono">{w.reservation_id ?? "—"}</span>],
    ["Event ID", <span key="t" className="mono">{w.event_id}</span>],
    [
      "Replay",
      w.replay_of ? (
        <Link key="u" className="copy-id mono link" href={wfHref(w.replay_of, here)}>
          ← {shortWf(w.replay_of)}
        </Link>
      ) : w.replayed_by ? (
        <Link key="u" className="copy-id mono link" href={wfHref(w.replayed_by, here)}>
          → {shortWf(w.replayed_by)}
        </Link>
      ) : (
        <span key="u" className="muted">—</span>
      ),
    ],
  ];
  return (
    <div className="sum">
      {cells.map(([k, v, c]) => (
        <div key={k} className={c}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

function DetailBody({ w, att, node, setAtt, setNode }: { w: Workflow; att: Attempt | undefined; node: string | null; setAtt: (a: number) => void; setNode: (n: string) => void }) {
  const [lf, setLf] = useState<LogFilter>(EMPTY_LF);
  const logsRef = useRef<HTMLDivElement>(null);
  const dag = att?.dag ?? w.dag ?? [];
  const sel = node ?? (dag.find((n) => n.status === "FAILED") ?? dag.find((n) => n.status === "RUNNING") ?? dag[0])?.id ?? null;
  const evQ = useApi(["lanes-wf-ev", w.workflow_id], () => api.workflowEvents(w.workflow_id));
  const logQ = useApi(["lanes-wf-logs", w.workflow_id], () => api.workflowLogs(w.workflow_id, { order: "asc", limit: 3000 }));
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const [newEv, setNewEv] = useState<string | null>(null);
  useStreamEvent("log", (lg) => {
    if (lg.workflow_id === w.workflow_id) setLiveLogs((xs) => [...xs, lg].slice(-500));
  });
  useStreamEvent("event", (e) => {
    if (e.workflow_id === w.workflow_id) {
      setNewEv(e.event_id);
      void evQ.mutate();
    }
  });
  const logs = useMemo(() => {
    const seen = new Set<string>();
    return [...(logQ.data?.items ?? []), ...liveLogs].filter((l) => (seen.has(l.log_id) ? false : (seen.add(l.log_id), true)));
  }, [logQ.data, liveLogs]);
  const events = evQ.data ?? [];

  const linkEvent = (e: WorkflowEvent) => {
    if (lf.evk?.id === e.event_id) return setLf({ ...lf, evk: null });
    setLf({ ...lf, ev: "", evk: evLink(e, logs) });
    if (window.innerWidth < 1100) logsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="split">
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="panel">
          <div className="panel-h">
            <h2 className="sec">
              <GitBranch className="i" />② Pipeline DAG{" "}
              <span className="eyebrow" style={{ marginLeft: 0 }}>
                {att ? `${att.pipeline_job_id} · ${ATTEMPT_STATUS_META[att.status]?.label ?? ""}` : ""}
              </span>
            </h2>
            <span className="r">
              <div className="seg" role="group" aria-label="Attempt 선택">
                {(w.attempts ?? []).length ? (
                  w.attempts.map((a) => (
                    <button key={a.attempt} type="button" aria-pressed={a.attempt === att?.attempt} onClick={() => setAtt(a.attempt)}>
                      <span className={`t-${ATTEMPT_STATUS_META[a.status]?.tone} tc`}>●</span> A{a.attempt}
                    </button>
                  ))
                ) : (
                  <span className="muted" style={{ fontSize: 11, padding: "4px 8px" }}>
                    아직 PipelineJob 없음
                  </span>
                )}
              </div>
            </span>
          </div>
          <div className="scroll-x">
            {dag.length ? (
              <DagSvg dag={dag} sel={sel} onSelect={setNode} />
            ) : (
              <Empty icon={<Clock className="i" />}>
                Capacity 확보 후 Vertex AI PipelineJob이 생성되면 DAG가 표시됩니다
                <br />
                <span className="dim">현재: {STATUS_META[w.status].label}</span>
              </Empty>
            )}
          </div>
          <div className="legend" style={{ marginTop: 8 }}>
            {Object.entries(NODE_STATUS_META).map(([k, m]) => (
              <span key={k} className={`t-${m.tone}`}>
                <CatalogIcon name={m.icon} className="i sm tc" />
                {m.label}
              </span>
            ))}
            <span className="muted" style={{ marginLeft: "auto" }}>
              노드 클릭 → 우측 상세 · 실패 노드는 붉게 강조
            </span>
          </div>
        </div>
        <div className="grid g2">
          <div className="panel">
            <Timeline events={events} loading={evQ.isLoading} attempts={w.attempts ?? []} newId={newEv} linked={lf.evk?.id ?? null} onLink={linkEvent} />
          </div>
          <div className="panel">
            <div className="panel-h">
              <h2 className="sec">
                <History className="i" />⑤ Execution History
              </h2>
            </div>
            <AttemptHistory w={w} />
          </div>
        </div>
        <div className="panel" ref={logsRef}>
          <LogExplorer w={w} logs={logs} loading={logQ.isLoading} lf={lf} setLf={setLf} />
        </div>
      </div>
      <aside className="panel inspector" aria-label="노드 상세">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={(att?.attempt ?? 0) + ":" + sel} initial={{ opacity: 0.3, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {att && sel ? (
              <NodePanel att={att} nodeId={sel} onLogs={(c) => setLf({ ...EMPTY_LF, comp: c, att: String(att.attempt) })} />
            ) : (
              <Empty icon={<Info className="i" />}>노드 정보 없음</Empty>
            )}
          </motion.div>
        </AnimatePresence>
      </aside>
    </div>
  );
}

function DagSvg({ dag, sel, onSelect }: { dag: DagNode[]; sel: string | null; onSelect: (id: string) => void }) {
  const W = PADX * 2 + CX * 3 + NW;
  const H = PADY * 2 + RY * 2 + NH;
  const pos = (id: string) => {
    const p = POS[id] ?? [0, 0];
    return { x: PADX + p[0] * CX, y: PADY + p[1] * RY };
  };
  const byId = Object.fromEntries(dag.map((n) => [n.id, n]));
  return (
    <svg className="dag" viewBox={`0 0 ${W} ${H}`} width={W} style={{ maxWidth: "100%", height: "auto" }} role="group" aria-label="Pipeline DAG">
      {dag.flatMap((n) =>
        (n.deps ?? []).map((d) => {
          const a = pos(d);
          const b = pos(n.id);
          const src = byId[d];
          const cls = n.status === "RUNNING" ? "on" : src?.status === "SUCCEEDED" && n.status !== "PENDING" && n.status !== "SKIPPED" ? "ok" : "";
          const x1 = a.x + NW;
          const y1 = a.y + NH / 2;
          const x2 = b.x;
          const y2 = b.y + NH / 2;
          const mx = (x1 + x2) / 2;
          return (
            <g key={d + n.id}>
              <path className={clsx("ed", cls)} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 6},${y2}`} />
              <path d={`M${x2 - 7},${y2 - 4} L${x2 - 1},${y2} L${x2 - 7},${y2 + 4}`} fill="none" stroke="var(--line-2)" strokeWidth={1.5} />
            </g>
          );
        }),
      )}
      {dag.map((n) => {
        const p = pos(n.id);
        const m = NODE_STATUS_META[n.status] ?? { tone: "queued", icon: "circle-dashed", label: n.status };
        const prog = n.status === "SUCCEEDED" ? 1 : n.progress?.pct ?? 0;
        const fail = n.status === "FAILED";
        const sub =
          n.status === "RUNNING" ? `${fmt.number(n.progress.processed)}/${fmt.number(n.progress.total)} · ${Math.round(prog * 100)}%` : n.duration_ms ? dur(n.duration_ms) : m.label;
        return (
          <g
            key={n.id}
            className={clsx("nd", `t-${m.tone}`, fail && "fail", sel === n.id && "sel")}
            transform={`translate(${p.x},${p.y})`}
            tabIndex={0}
            role="button"
            aria-label={`${n.labelKo} ${m.label}`}
            aria-pressed={sel === n.id}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(n.id);
              }
            }}
          >
            {fail && <rect className="glow" x={-4} y={-4} width={NW + 8} height={NH + 8} rx={10} />}
            <rect className="box" width={NW} height={NH} rx={7} />
            <rect x={0} y={0} width={4} height={NH} rx={2} fill="var(--tc)" />
            <CatalogIcon name={m.icon} x={12} y={12} width={15} height={15} style={{ color: "var(--tc)" }} />
            <text className="ttl" x={34} y={24}>
              {n.labelKo}
            </text>
            {n.labelKo.length <= 6 && (
              <text className="sub" x={NW - 10} y={24} textAnchor="end">
                {n.id}
              </text>
            )}
            <text className="sub" x={12} y={46}>
              {sub}
              {n.resources?.gpu ? " · GPU" : ""}
            </text>
            <text className="sub" x={NW - 10} y={46} textAnchor="end" style={{ fill: "var(--tc)", fontWeight: 600 }}>
              {m.label}
            </text>
            <rect className="bar-bg" x={12} y={54} width={NW - 24} height={4} rx={2} />
            <rect className="bar-fg" x={12} y={54} width={((NW - 24) * prog).toFixed(1)} height={4} rx={2} fill="var(--tc)" />
          </g>
        );
      })}
    </svg>
  );
}

function NodePanel({ att, nodeId, onLogs }: { att: Attempt; nodeId: string; onLogs: (comp: string) => void }) {
  const copy = useCopy();
  const now = useSimNow();
  const n = att.dag.find((x) => x.id === nodeId) ?? att.dag[0];
  if (!n) return <Empty>노드 없음</Empty>;
  const r = n.resources;
  const io = (x: DagNode["inputs"][number]) => (
    <div key={x.name + x.uri} className={clsx("io", x.available === false && "na")}>
      <div style={{ display: "flex", gap: 6 }}>
        <b>{x.name}</b>
        <span className="mono muted">{x.type}</span>
        <span className="mono muted" style={{ marginLeft: "auto" }}>
          {x.sizeBytes ? fmt.bytes(x.sizeBytes) : ""}
          {x.available === false ? " · 미생성" : ""}
        </span>
      </div>
      <div className="mono muted" style={{ overflowWrap: "anywhere", fontSize: 10.5 }}>
        {x.uri}
      </div>
    </div>
  );
  return (
    <>
      <div className="panel-h">
        <h2 className="sec">
          <Cpu className="i" />
          {n.labelKo}{" "}
          <span className="muted mono" style={{ fontWeight: 500 }}>
            {n.id}
          </span>
        </h2>
        <span className="r">
          <StatusPill kind="node" status={n.status} />
        </span>
      </div>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
        {n.description}
      </p>
      {n.error && (
        <div className="note t-failed" style={{ marginBottom: 10 }}>
          <b className="mono">{n.error.code}</b> · {FAILURE_CATEGORY_META[n.error.category]?.label ?? n.error.category}
          <br />
          {n.error.message}
        </div>
      )}
      <dl className="kv">
        <dt>Attempt</dt>
        <dd className="mono">
          {att.attempt} · {att.pipeline_job_id}
        </dd>
        <dt>의존성</dt>
        <dd className="mono">{n.deps?.length ? n.deps.join(", ") : "— (root)"}</dd>
        <dt>시작 · 종료</dt>
        <dd className="mono">
          {n.start_at ? fmt.timeMs(n.start_at) : "—"} → {n.end_at ? fmt.timeMs(n.end_at) : n.status === "RUNNING" ? "실행 중" : "—"}
        </dd>
        <dt>실행 시간</dt>
        <dd className="mono">{dur(n.duration_ms ?? (n.status === "RUNNING" && n.start_at ? now - n.start_at : null))}</dd>
        {n.progress && (
          <>
            <dt>진행</dt>
            <dd>
              <b className="mono">
                {fmt.number(n.progress.processed)}/{fmt.number(n.progress.total)}
              </b>{" "}
              <span className="muted">({pct(n.progress.pct)})</span> · <span style={{ color: "var(--st-success)" }}>PASS {fmt.number(n.progress.pass || 0)}</span> ·{" "}
              <span style={{ color: "var(--st-failed)" }}>FAIL {fmt.number(n.progress.fail || 0)}</span>
            </dd>
          </>
        )}
        <dt>Task ID</dt>
        <dd>
          <CopyId text={n.task_id} />
        </dd>
        <dt>Machine</dt>
        <dd className="mono">{r?.machineType ?? "—"}</dd>
        <dt>CPU</dt>
        <dd>{r?.cpu ? <>{r.cpu.cores} cores · <Meter value={r.cpu.utilPct} /></> : "—"}</dd>
        <dt>GPU</dt>
        <dd>{r?.gpu ? <>{r.gpu.type} × {r.gpu.count} · <Meter value={r.gpu.utilPct} /></> : <span className="muted">없음</span>}</dd>
        <dt>Memory</dt>
        <dd>{r?.memory ? <>{r.memory.usedGb} / {r.memory.limitGb} GB <Meter value={(r.memory.usedGb / r.memory.limitGb) * 100} /></> : "—"}</dd>
        <dt>Image</dt>
        <dd className="mono" style={{ fontSize: 10.5 }}>
          {n.image || "—"}
        </dd>
      </dl>
      <div className="eyebrow" style={{ margin: "12px 0 6px" }}>
        Inputs
      </div>
      {n.inputs?.length ? n.inputs.map(io) : <div className="muted">—</div>}
      <div className="eyebrow" style={{ margin: "12px 0 6px" }}>
        Outputs
      </div>
      {n.outputs?.length ? n.outputs.map(io) : <div className="muted">—</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className="btn sm" onClick={() => onLogs(n.id)}>
          <Terminal />이 노드 로그
        </button>
        <button type="button" className="btn sm" onClick={() => void copy(JSON.stringify(n, null, 2))}>
          <Copy />
          노드 JSON
        </button>
      </div>
    </>
  );
}

function Timeline({
  events,
  loading,
  attempts,
  newId,
  linked,
  onLink,
}: {
  events: WorkflowEvent[];
  loading: boolean;
  attempts: Attempt[];
  newId: string | null;
  linked: string | null;
  onLink: (e: WorkflowEvent) => void;
}) {
  const [evAtt, setEvAtt] = useState("");
  const ev = evAtt ? events.filter((e) => e.attempt == null || String(e.attempt) === evAtt) : events;
  return (
    <>
      <div className="panel-h">
        <h2 className="sec">
          <Clock className="i" />③ Event Timeline
        </h2>
        <span className="r">
          <select className="inp" value={evAtt} onChange={(e) => setEvAtt(e.target.value)} style={{ height: 26, width: "auto", fontSize: 11 }} aria-label="attempt 필터">
            <option value="">모든 attempt</option>
            {attempts.map((a) => (
              <option key={a.attempt} value={a.attempt}>
                Attempt {a.attempt}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="scroll-y" style={{ maxHeight: 520 }}>
        {loading ? (
          <div className="skel" style={{ height: 200 }} />
        ) : ev.length ? (
          <ul className="tl">
            {ev.map((e, i) => {
              const g = i > 0 ? e.ts - ev[i - 1].ts : 0;
              const t = evTone(e);
              return (
                <Fragment key={e.event_id}>
                  {g > 30000 && (
                    <li className="gap" aria-hidden>
                      + {dur(g)}
                    </li>
                  )}
                  <li className={clsx(`t-${t}`, e.event_id === newId && "new")}>
                    <span className="mono muted" style={{ fontSize: 11 }}>
                      {fmt.timeMs(e.ts)}
                    </span>
                    <span>
                      <button type="button" className="copy-id nm" aria-pressed={linked === e.event_id} title="이 이벤트와 연결된 로그만 보기" onClick={() => onLink(e)}>
                        {e.name}
                      </button>
                      {e.attempt ? (
                        <span className="mono dim" style={{ fontSize: 10 }}>
                          {" "}
                          A{e.attempt}
                        </span>
                      ) : null}
                      <div className="lb">
                        {e.label} · {e.source}
                      </div>
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        ) : (
          <Empty>이벤트 없음</Empty>
        )}
      </div>
    </>
  );
}

function AttemptHistory({ w }: { w: Workflow }) {
  const here = useHere();
  const hist = useApi(["lanes-wf-att", w.workflow_id], () => api.workflowAttempts(w.workflow_id), { revalidateOn: ["transition", "dlq"] });
  const atts = w.attempts ?? [];
  const fails = atts.filter((a) => a.error_code);
  const vers = [...new Set(atts.map((a) => a.pipeline_version))];
  const chain = hist.data?.replayChain ?? [];
  const orig = w.replay_of ? chain.find((c) => c.workflow_id === w.replay_of) : undefined;
  const reps = hist.data?.replays ?? [];
  return (
    <>
      {atts.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {atts.map((a, i) => {
            const m = ATTEMPT_STATUS_META[a.status];
            const cat = a.error_category ? FAILURE_CATEGORY_META[a.error_category] : null;
            return (
              <div key={a.attempt} style={{ display: "contents" }}>
                {i > 0 && atts[i - 1].backoffSec ? (
                  <div className="backoff">
                    <Clock className="i sm" />
                    Backoff {atts[i - 1].backoffSec}s → Admission 재진입
                  </div>
                ) : null}
                <div className={clsx("att-c", `t-${m?.tone}`, a.attempt === w.attempt && "cur")}>
                  <h4>
                    <CatalogIcon name={m?.icon} className="i tc" />
                    Attempt {a.attempt}
                    <span style={{ marginLeft: "auto" }}>
                      <StatusPill kind="attempt" status={a.status} />
                    </span>
                  </h4>
                  <dl className="kv" style={{ fontSize: 11.5 }}>
                    <dt>PipelineJob</dt>
                    <dd>
                      <CopyId text={a.pipeline_job_id} />
                    </dd>
                    <dt>Execution</dt>
                    <dd className="mono muted">{(a.workflow_execution_id || "").split("/").pop()?.slice(0, 13)}…</dd>
                    <dt>버전</dt>
                    <dd className="mono">{a.pipeline_version}</dd>
                    <dt>시간</dt>
                    <dd className="mono">
                      {a.started_at ? fmt.time(a.started_at) : "—"} → {a.completed_at ? fmt.time(a.completed_at) : "…"} · {dur(a.duration_ms)}
                    </dd>
                    {a.error_code && (
                      <>
                        <dt>오류</dt>
                        <dd>
                          <b className="mono" style={{ color: "var(--st-failed)" }}>
                            {a.error_code}
                          </b>{" "}
                          · {cat?.label ?? a.error_category}
                          <div className="muted">
                            {a.failed_node ?? ""} — {a.error_message}
                          </div>
                        </dd>
                        <dt>정책</dt>
                        <dd className="muted">{cat?.policy}</dd>
                      </>
                    )}
                  </dl>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>아직 실행된 Attempt가 없습니다</Empty>
      )}
      {fails.length >= 2 && (
        <>
          <div className="eyebrow" style={{ margin: "12px 0 6px" }}>
            이전 오류 vs 현재 오류
          </div>
          <div className="diff">
            {fails.slice(-2).map((f) => (
              <div key={f.attempt} className="t-failed">
                <b className="mono">
                  A{f.attempt} · {f.error_code}
                </b>
                <div className="muted">
                  {f.failed_node} — {f.error_message}
                </div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {fails[fails.length - 2].error_code === fails[fails.length - 1].error_code ? "동일 오류 반복 → 일시 장애가 아닐 가능성" : "오류 유형 변경됨"}
          </div>
        </>
      )}
      <div className={clsx("note", (vers.length > 1 || (orig && orig.pipeline_version !== w.pipeline_version)) && "t-retry")} style={{ marginTop: 12 }}>
        <Layers className="i sm" /> Pipeline 버전 {vers.length > 1 ? <><b>변경됨</b>: {vers.join(" → ")}</> : <b>{w.pipeline_version}</b>}
        {vers.length <= 1 && " 고정"}
        {orig && (
          <>
            {" "}
            · 원본({shortWf(orig.workflow_id)})은 <b>{orig.pipeline_version}</b>
            {orig.pipeline_version !== w.pipeline_version ? " → Replay 시 버전 변경" : ""}
          </>
        )}
      </div>
      <div className="eyebrow" style={{ margin: "12px 0 6px" }}>
        수동 Replay 기록
      </div>
      {reps.length ? (
        reps.map((r) => (
          <div key={r.replay_id} className="note t-dlq" style={{ marginBottom: 6 }}>
            <b className="mono">{r.replay_id}</b> · {r.status} · cycle {r.replay_cycle} · {r.pipeline_version_from} → {r.pipeline_version_to}
            <br />
            <span className="muted">
              요청 {opName(r.requested_by)} · 승인 {opName(r.approved_by)} · {fmt.dateTime(r.created_at)}
            </span>
            <br />
            {r.reason}
            <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Link className="btn sm" href={wfHref(r.original_workflow_id, here)}>
                원본 {shortWf(r.original_workflow_id)}
              </Link>
              {r.replay_workflow_id && (
                <Link className="btn sm" href={wfHref(r.replay_workflow_id, here)}>
                  Replay {shortWf(r.replay_workflow_id)}
                </Link>
              )}
              <Link className="btn sm ghost" href={`/lanes/dlq?id=${r.dead_letter_id}`}>
                {r.dead_letter_id}
              </Link>
            </div>
          </div>
        ))
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>
          {hist.isLoading ? "불러오는 중…" : "이 Workflow와 연결된 Replay 없음"}
        </div>
      )}
    </>
  );
}

/** timeline event → related log lines (port of prototype evLink). */
function evLink(e: WorkflowEvent, logs: LogEntry[]): NonNullable<LogFilter["evk"]> {
  const sameAtt = (l: LogEntry) => e.attempt == null || l.attempt == null || l.attempt === e.attempt;
  const ALIAS: Record<string, string[]> = {
    DEAD_LETTER_PUBLISHED: ["DEAD_LETTER_ROUTED", "DEAD_LETTER_STORED"],
    VALIDATION_COMPLETED: ["VALIDATION_COMPLETED", "IDEMPOTENCY_CHECK"],
    EVENT_RECEIVED: ["EVENT_RECEIVED", "IDEMPOTENCY_CHECK"],
  };
  const types = ALIAS[e.name] ?? [e.name];
  let hit = logs.filter((l) => l.event_type && types.includes(l.event_type) && Math.abs(l.ts - e.ts) < 90000);
  let how = "event_type 일치 · ±90s";
  const m = /^TASK_(.+)_(STARTED|COMPLETED|FAILED)$/.exec(e.name);
  if (!hit.length && m) {
    const CMAP: Record<string, string[]> = {
      PREPROCESS: ["preprocess"],
      INTENT_EVAL: ["intent_eval"],
      RESPONSE_EVAL: ["response_eval"],
      LATENCY_CHECK: ["latency_check"],
      AGGREGATION: ["aggregate"],
      PERSIST: ["persist"],
      EVALUATION: ["intent_eval", "response_eval"],
    };
    const comps = CMAP[m[1]] ?? [m[1].toLowerCase()];
    const tt = ({ STARTED: ["TASK_STARTED"], COMPLETED: ["TASK_COMPLETED", "TASK_METRICS"], FAILED: ["TASK_FAILED"] } as Record<string, string[]>)[m[2]];
    hit = logs.filter(
      (l) => comps.includes(l.component) && sameAtt(l) && ((l.event_type && tt.includes(l.event_type)) || (m[2] === "FAILED" && (l.severity === "ERROR" || l.severity === "CRITICAL"))),
    );
    how = `component ${comps.join("/")} · ${tt.join("/")}${e.attempt ? " · A" + e.attempt : ""}`;
  }
  if (!hit.length) {
    hit = logs.filter((l) => sameAtt(l) && Math.abs(l.ts - e.ts) <= 5000);
    how = "이벤트 시각 ±5s 시간 창";
  }
  if (!hit.length) {
    hit = logs
      .slice()
      .sort((a, b) => Math.abs(a.ts - e.ts) - Math.abs(b.ts - e.ts))
      .slice(0, 5);
    how = "이벤트 시각에 가장 가까운 로그 5줄";
  }
  return { id: e.event_id, name: e.name, ts: e.ts, attempt: e.attempt, how, ids: new Set(hit.map((l) => l.log_id)) };
}

function logPass(lg: LogEntry, f: LogFilter) {
  if (f.sev && SEV_ORDER.indexOf(lg.severity) < SEV_ORDER.indexOf(f.sev)) return false;
  if (f.comp && lg.component !== f.comp && lg.service !== f.comp) return false;
  if (f.evk && !f.evk.ids.has(lg.log_id)) return false;
  if (f.ev && lg.event_type !== f.ev) return false;
  if (f.att && String(lg.attempt) !== f.att) return false;
  if (f.q && !(lg.message + " " + (lg.stack_trace ?? "") + " " + lg.component + " " + lg.trace_id).toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

function LogExplorer({ w, logs, loading, lf, setLf }: { w: Workflow; logs: LogEntry[]; loading: boolean; lf: LogFilter; setLf: (f: LogFilter) => void }) {
  const copy = useCopy();
  const toast = useToast();
  const [tz, setTz] = useState<"KST" | "UTC">("KST");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const comps = useMemo(() => [...new Set(logs.map((l) => l.component || l.service))], [logs]);
  const evs = useMemo(() => [...new Set(logs.map((l) => l.event_type).filter(Boolean) as string[])], [logs]);
  const filtered = useMemo(() => logs.filter((l) => logPass(l, lf)), [logs, lf]);
  const shown = useMemo(() => filtered.slice().reverse().slice(0, 500), [filtered]);
  const set = (k: keyof LogFilter, v: string) => setLf({ ...lf, [k]: v, ...(k === "ev" ? { evk: null } : {}) });
  const chips: [keyof LogFilter, ReactNode][] = [];
  if (lf.evk)
    chips.push([
      "evk",
      <>
        <Clock className="i sm" />
        타임라인 <b className="mono">{lf.evk.name}</b>
        {lf.evk.attempt ? ` A${lf.evk.attempt}` : ""} · {fmt.timeMs(lf.evk.ts)} <span className="muted">— {lf.evk.how}</span>
      </>,
    ]);
  if (lf.ev) chips.push(["ev", <>Event <b className="mono">{lf.ev}</b></>]);
  if (lf.sev) chips.push(["sev", <>Severity ≥ <b>{lf.sev}</b></>]);
  if (lf.comp) chips.push(["comp", <>Component <b className="mono">{lf.comp}</b></>]);
  if (lf.att) chips.push(["att", <>Attempt <b>{lf.att}</b></>]);
  if (lf.q) chips.push(["q", <>검색 <b className="mono">{lf.q.length > 24 ? lf.q.slice(0, 24) + "…" : lf.q}</b></>]);
  const jsonl = () => filtered.map((l) => JSON.stringify(l)).join("\n");
  return (
    <>
      <div className="panel-h" style={{ rowGap: 6 }}>
        <h2 className="sec">
          <Terminal className="i" />④ Log Explorer{" "}
          <span className="eyebrow" style={{ marginLeft: 0 }}>
            {filtered.length}줄 · trace {fmt.shortHash(w.trace_id, 12)}
          </span>
        </h2>
        <span className="r" style={{ flexWrap: "wrap" }}>
          <span className="seg" role="group" aria-label="로그 시간대">
            {(["KST", "UTC"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tz === t} onClick={() => setTz(t)}>
                {t}
              </button>
            ))}
          </span>
          <button type="button" className="btn sm" onClick={() => void copy(jsonl())}>
            <Copy />
            복사
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              downloadText(jsonl(), `${w.workflow_id}-logs.jsonl`, "application/x-ndjson;charset=utf-8");
              toast(`${w.workflow_id}-logs.jsonl 내보내기 (${filtered.length}줄)`, "success");
            }}
          >
            <Download />
            JSONL 내보내기
          </button>
        </span>
      </div>
      <div className="lfil">
        <label className="fld">
          <span>Severity ≥</span>
          <select className="inp" value={lf.sev} onChange={(e) => set("sev", e.target.value)}>
            <option value="">전체</option>
            {["INFO", "NOTICE", "WARNING", "ERROR"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Component</span>
          <select className="inp" value={lf.comp} onChange={(e) => set("comp", e.target.value)}>
            <option value="">전체</option>
            {comps.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Event</span>
          <select className="inp" value={lf.evk ? "__evk" : lf.ev} onChange={(e) => e.target.value !== "__evk" && set("ev", e.target.value)}>
            <option value="">전체</option>
            {lf.evk && <option value="__evk">⟶ {lf.evk.name} (타임라인)</option>}
            {evs.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>Attempt</span>
          <select className="inp" value={lf.att} onChange={(e) => set("att", e.target.value)}>
            <option value="">전체</option>
            {(w.attempts ?? []).map((a) => (
              <option key={a.attempt}>{a.attempt}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>검색 (message · stack · trace)</span>
          <input className="inp" value={lf.q} onChange={(e) => set("q", e.target.value)} placeholder="Traceback, quota…" />
        </label>
      </div>
      {chips.length > 0 && (
        <div className="lchips">
          {chips.map(([k, h]) => (
            <span key={k} className="lchip">
              {h}
              <button type="button" aria-label="필터 해제" onClick={() => setLf({ ...lf, [k]: k === "evk" ? null : "" })}>
                <X className="i sm" />
              </button>
            </span>
          ))}
          {chips.length > 1 && (
            <button type="button" className="btn sm ghost" onClick={() => setLf(EMPTY_LF)}>
              모두 해제
            </button>
          )}
        </div>
      )}
      <div className="logbox">
        {loading ? (
          <div className="skel" style={{ height: 200, margin: 10 }} />
        ) : shown.length ? (
          shown.map((lg) => {
            const tone = SEVERITY_META[lg.severity]?.tone ?? "queued";
            const err = lg.severity === "ERROR" || lg.severity === "CRITICAL";
            const isOpen = open.has(lg.log_id);
            return (
              <div key={lg.log_id} className={clsx("lg", err && "err", isOpen && "open")}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(lg.log_id)) n.delete(lg.log_id);
                      else n.add(lg.log_id);
                      return n;
                    })
                  }
                >
                  <span className="chev">
                    <ChevronRight className="i sm" />
                  </span>
                  <span className="muted" title={lg.timestamp}>
                    {tz === "UTC" ? new Date(lg.ts).toISOString().slice(11, 23) + "Z" : fmt.timeMs(lg.ts)}
                  </span>
                  <span className={`sev t-${tone}`}>{lg.severity}</span>
                  <span>{lg.component || lg.service}</span>
                  <span className="msg">
                    {lg.message}
                    {lg.stack_trace && (
                      <>
                        {" "}
                        <span className="pill t-failed" style={{ height: 16, fontSize: 9.5 }}>
                          stack trace
                        </span>
                      </>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="x">
                    {lg.stack_trace && (
                      <>
                        <div className="eyebrow" style={{ margin: "4px 0" }}>
                          Error Stack Trace
                        </div>
                        <pre className="code" style={{ color: "var(--st-failed)" }}>
                          {lg.stack_trace}
                        </pre>
                      </>
                    )}
                    <div className="eyebrow" style={{ margin: "8px 0 4px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      JSON payload
                      <button type="button" className="btn sm" onClick={() => void copy(JSON.stringify(lg, null, 2))}>
                        <Copy />
                        복사
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          setLf({ ...lf, q: lg.trace_id });
                          toast(`Trace ID ${fmt.shortHash(lg.trace_id, 8)}로 필터링`, "queued");
                        }}
                      >
                        trace {fmt.shortHash(lg.trace_id, 8)}
                      </button>
                    </div>
                    <JsonView value={lg} />
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="empty" style={{ margin: 10 }}>
            필터에 맞는 로그가 없습니다
          </div>
        )}
      </div>
    </>
  );
}

export function NotFoundBack() {
  return (
    <Link className="btn" href="/lanes/explorer">
      <ArrowLeft />
      Explorer
    </Link>
  );
}
