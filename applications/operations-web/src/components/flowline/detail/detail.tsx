"use client";
/**
 * S4 Pipeline Detail — summary, DAG viewer, node detail, event timeline, log explorer, attempt history.
 * URL state: ?node=&attempt=&lsev=&lcomp=&levent=&ltrace=&lq= (+ from/stage/fq for breadcrumbs).
 */
import clsx from "clsx";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArchiveX,
  ArrowLeft,
  Ban,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  Eye,
  FileCheck,
  GitBranch,
  History,
  RefreshCw,
  RotateCcw,
  Table2,
  Terminal,
  Workflow as WorkflowIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusPill } from "@/components/shared";
import { DAG_TEMPLATE, DLQ_STATUS_META, FAILURE_CATEGORY_META, OPERATORS, STAGE_BY_ID, STATUS_META, TERMINAL_STATES } from "@/lib/catalog";
import { ApiClientError, api, downloadText, parseAsInt, parseAsString, revalidateKey, useApi, useQueryStates, useSimNow } from "@/lib/client";
import { fmt } from "@/lib/format";
import type { Attempt, ComponentId, DagNode, LogEntry, Replay, StageId, Workflow, WorkflowStatus } from "@/lib/types";
import { setLastWorkflow, wfHref } from "../nav-store";
import { Empty, ErrorBox, JsonView, Lang, Note, Panel, PermNote, Skel, Tag, dur, useApiErrorToast, useCopy, usePerm, useToast } from "../ui";
import { DagGantt, DagView } from "./dag";
import { useDebouncedParam } from "../use-debounced-param";

/** Template DAG (all nodes PENDING) shown before a PipelineJob exists, so the pipeline shape is always visible. */
const PLANNED_DAG: DagNode[] = DAG_TEMPLATE.map((t) => ({
  id: t.id,
  label: t.label,
  labelKo: t.labelKo,
  deps: t.deps,
  status: "PENDING",
  start_at: null,
  end_at: null,
  duration_ms: null,
  task_id: "",
  progress: { processed: 0, total: 0, pct: 0, pass: 0, fail: 0 },
  resources: { machineType: t.machineType, cpu: { cores: t.cpu, utilPct: 0 }, gpu: t.gpu ? { ...t.gpu, utilPct: 0 } : null, memory: { limitGb: t.memGb, usedGb: 0 } },
  image: t.image,
  inputs: [],
  outputs: [],
  error: null,
  description: t.description,
}));

const PARSERS = {
  node: parseAsString,
  attempt: parseAsInt,
  from: parseAsString,
  stage: parseAsString,
  fq: parseAsString,
  lsev: parseAsString,
  lcomp: parseAsString,
  levent: parseAsString,
  ltrace: parseAsString,
  lq: parseAsString,
};

const FROM_LABEL: Record<string, string> = { orch: "관제", explorer: "Pipeline Explorer", results: "평가 결과", dlq: "DLQ Operations", capacity: "Language Capacity", analytics: "Analytics", config: "설정" };
const FROM_HREF: Record<string, string> = {
  orch: "/flowline",
  explorer: "/flowline/explorer",
  results: "/flowline/results",
  dlq: "/flowline/dlq",
  capacity: "/flowline/capacity",
  analytics: "/flowline/analytics",
  config: "/flowline/config",
};
const SEV_TONE: Record<string, string> = { DEBUG: "cancelled", INFO: "running", NOTICE: "success", WARNING: "retry", ERROR: "failed", CRITICAL: "failed" };
const opName = (id: string | null | undefined) => OPERATORS.find((o) => o.id === id)?.name ?? id ?? "-";
const FLOW_STATES: WorkflowStatus[] = ["RECEIVED", "VALIDATED", "QUEUED", "RESERVED", "DISPATCHING", "RUNNING"];

export function WorkflowDetail() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [q, setQ] = useQueryStates(PARSERS);
  const now = useSimNow();

  useEffect(() => {
    setLastWorkflow(id);
  }, [id]);

  const [terminal, setTerminal] = useState(false);
  const wfq = useApi(["workflow", id], () => api.workflow(id), { revalidateOn: terminal ? ["transition"] : ["tick"], throttleMs: 2400 });
  const wf = wfq.data && wfq.data.workflow_id === id ? wfq.data : undefined;
  const live = wf ? !TERMINAL_STATES.includes(wf.status) : false;
  if (wf && terminal === live) setTerminal(!live);

  if (wfq.error && !wf) {
    const nf = wfq.error instanceof ApiClientError && wfq.error.status === 404;
    return (
      <div className="screen enter">
        <Crumbs q={q} id={id} />
        {nf ? (
          <Empty>
            Workflow <span className="mono">{id}</span>를 찾을 수 없습니다.{" "}
            <Link href="/flowline/explorer" className="idlink">
              Pipeline Explorer
            </Link>
            에서 다시 선택하세요.
          </Empty>
        ) : (
          <ErrorBox error={wfq.error} retry={() => wfq.mutate()} />
        )}
      </div>
    );
  }
  if (!wf)
    return (
      <div className="screen">
        <Crumbs q={q} id={id} />
        <Skel h={220} />
        <div className="grid g-7-5">
          <Skel h={320} />
          <Skel h={320} />
        </div>
      </div>
    );

  const attIdx = q.attempt != null && q.attempt >= 1 && q.attempt <= wf.attempts.length ? q.attempt - 1 : Math.max(0, wf.attempts.length - 1);
  const att: Attempt | undefined = wf.attempts[attIdx];
  const defaultNode = (wf.error?.node ?? wf.current_node ?? att?.failed_node ?? (att ? "response_eval" : null)) as ComponentId | null;
  const nodeId = (q.node as ComponentId | null) ?? defaultNode;
  const node = att?.dag.find((n) => n.id === nodeId);

  return (
    <div className="screen enter" key={id}>
      <Crumbs q={q} id={id} attempt={att?.attempt} node={nodeId} />
      <div className="panel">
        <div className="panel-b" style={{ paddingTop: 14 }}>
          <Summary wf={wf} now={now} />
        </div>
      </div>
      <div className="grid g-7-5">
        <Panel
          title={
            <>
              Pipeline DAG{" "}
              <span className="sub mono" style={{ fontWeight: 400, overflowWrap: "anywhere" }}>
                {att?.pipeline_job_id ?? ""}
              </span>
            </>
          }
          icon={<WorkflowIcon aria-hidden />}
          right={
            wf.attempts.length ? (
              <div className="seg" role="group" aria-label="Attempt 선택">
                {wf.attempts.map((a, i) => (
                  <button key={a.attempt} aria-pressed={i === attIdx} onClick={() => setQ({ attempt: a.attempt, node: null })}>
                    Attempt {a.attempt}
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          <div className="tbl-wrap">
            {att ? (
              <DagView nodes={att.dag} selected={nodeId} now={now} onSelect={(n) => setQ({ node: n === nodeId ? null : n })} />
            ) : (
              <div className="dag-planned">
                <DagView nodes={PLANNED_DAG} selected={null} now={now} onSelect={() => {}} />
              </div>
            )}
          </div>
          {!att && <Note>PipelineJob이 아직 생성되지 않았습니다. 위 DAG는 예정 구성(전 노드 대기)이며, Capacity 확보 후 실제 실행 상태가 표시됩니다.</Note>}
          <div className="dag-legend">
            {(["SUCCEEDED", "RUNNING", "FAILED", "PENDING", "SKIPPED", "CANCELLED"] as const).map((s) => (
              <StatusPill key={s} kind="node" status={s} size="sm" />
            ))}
          </div>
          {att && <DagGantt nodes={att.dag} selected={nodeId} now={now} onSelect={(n) => setQ({ node: n === nodeId ? null : n })} />}
        </Panel>
        <Panel title="노드 상세" icon={<Cpu aria-hidden />}>
          {att ? (
            <NodePanel
              n={node}
              wf={wf}
              onLogs={() => {
                setQ({ lcomp: nodeId });
                document.getElementById("fl-logpanel")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
              }}
            />
          ) : (
            <Empty>—</Empty>
          )}
        </Panel>
      </div>
      <div className="grid g-5-7">
        <Timeline wf={wf} live={live} />
        <LogExplorer wf={wf} live={live} q={q} setQ={setQ} />
      </div>
      <HistoryPanel wf={wf} onAttempt={(n) => setQ({ attempt: n, node: null })} />
    </div>
  );
}

// ───────────────────────────── breadcrumbs ──
function Crumbs({ q, id, attempt, node }: { q: { from: string | null; stage: string | null; fq: string | null }; id: string; attempt?: number; node?: string | null }) {
  const from = q.from && FROM_LABEL[q.from] ? q.from : "explorer";
  const fcount = q.fq ? [...new URLSearchParams(q.fq).keys()].filter((k) => k !== "page" && k !== "sort").length : 0;
  const stage = q.stage && STAGE_BY_ID[q.stage as StageId] ? (q.stage as StageId) : null;
  const backHref = from === "orch" ? (stage ? `/flowline?stage=${stage}&tab=batches` : "/flowline") : FROM_HREF[from] + (q.fq ? "?" + q.fq : "");
  return (
    <nav className="crumbs" aria-label="경로">
      <Link href={backHref}>
        <ArrowLeft aria-hidden />
        {FROM_LABEL[from]}
        {fcount > 0 && <Tag>필터 {fcount}</Tag>}
      </Link>
      {stage && from === "orch" && (
        <>
          <ChevronRight aria-hidden />
          <Link href={`/flowline?stage=${stage}&tab=batches`}>{STAGE_BY_ID[stage].label.ko}</Link>
        </>
      )}
      <ChevronRight aria-hidden />
      <span className="cur">{id}</span>
      {attempt != null && (
        <>
          <ChevronRight aria-hidden />
          <span className="cur">attempt-{attempt}</span>
        </>
      )}
      {node && (
        <>
          <ChevronRight aria-hidden />
          <span className="cur">{node}</span>
        </>
      )}
    </nav>
  );
}

// ───────────────────────────── summary ──
function StateBar({ wf }: { wf: Workflow }) {
  const seen: Partial<Record<WorkflowStatus, number>> = {};
  (wf.status_history ?? []).forEach((h) => {
    seen[h.status] = h.at;
  });
  const term = TERMINAL_STATES.includes(wf.status) ? wf.status : wf.status === "RETRY_WAIT" ? "RETRY_WAIT" : null;
  const cols: WorkflowStatus[] = [...FLOW_STATES, ...(term && !FLOW_STATES.includes(term) ? [term] : ["SUCCEEDED" as WorkflowStatus])];
  return (
    <div className="statebar">
      {cols.map((s) => {
        const m = STATUS_META[s];
        const nowS = wf.status === s;
        const done = seen[s] != null;
        return (
          <div key={s} className={clsx(`t-${m.tone}`, nowS ? "now" : done && "done")}>
            <span>{m.label}</span>
            <small>{done ? fmt.time(seen[s]) : "—"}</small>
          </div>
        );
      })}
    </div>
  );
}

function Summary({ wf, now }: { wf: Workflow; now: number }) {
  const copy = useCopy();
  const toast = useToast();
  const onErr = useApiErrorToast();
  const { can } = usePerm();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const r = wf.result;
  const cur = wf.attempts[wf.attempts.length - 1];
  const nonTerm = !TERMINAL_STATES.includes(wf.status);
  const dlq = useApi(wf.dead_letter_id ? ["dead-letter", wf.dead_letter_id] : null, () => api.deadLetter(wf.dead_letter_id!), { revalidateOn: ["dlq"] });
  const dl = dlq.data?.deadLetter;
  const liveSpan = (v: number) => <span style={{ color: "var(--st-running)" }}>{dur(v)}…</span>;
  const cancel = async () => {
    if (!reason.trim()) {
      toast("취소 사유를 입력하세요", "retry");
      return;
    }
    setBusy(true);
    try {
      const res = await api.cancelWorkflow(wf.workflow_id, { reason: reason.trim() });
      toast(
        <>
          <span className="mono">{wf.workflow_id}</span> 취소를 요청했습니다 → {STATUS_META[res.status]?.label ?? res.status}
        </>,
        "cancelled",
      );
      setConfirm(false);
      setReason("");
      revalidateKey("workflow");
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="summary">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Workflow Summary</div>
          <div className="row" style={{ gap: 10, marginTop: 4 }}>
            <h1 className="h1 mono" style={{ fontSize: 19, overflowWrap: "anywhere" }}>
              {wf.workflow_id}
            </h1>
            <StatusPill status={wf.status} size="md" />
            <Lang code={wf.language} />
            <Tag>{wf.pipeline_version}</Tag>
            <Tag>priority {wf.priority}</Tag>
            {wf.replay_of && (
              <Tag>
                <RefreshCw aria-hidden />
                replay cycle {wf.replay_cycle}
              </Tag>
            )}
          </div>
          {wf.status === "RUNNING" && (
            <div className="row" style={{ gap: 10, marginTop: 10, maxWidth: 560, flexWrap: "nowrap" }}>
              <div className="meter" style={{ flex: 1, height: 8 }}>
                <i style={{ width: `${(wf.progress.pct * 100).toFixed(1)}%`, background: "var(--st-running)" }} />
              </div>
              <span className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {fmt.number(wf.progress.processed)}/{fmt.number(wf.progress.total)} · {fmt.pct(wf.progress.pct, 0)}
              </span>
              <span className="sub" style={{ whiteSpace: "nowrap" }}>
                현재 <span className="mono">{wf.current_node ?? "-"}</span>
              </span>
            </div>
          )}
          {wf.status === "RETRY_WAIT" && wf.retry_at && (
            <Note tone="retry" icon={<RotateCcw aria-hidden />} style={{ marginTop: 10, maxWidth: 560 }}>
              Attempt {wf.attempt + 1} 재시도 예정 <b className="mono">{fmt.time(wf.retry_at)}</b> ({fmt.relative(wf.retry_at, now)}) · backoff {cur?.backoffSec ? cur.backoffSec + "s" : "-"}
            </Note>
          )}
        </div>
        <div className="row end">
          <button className="btn sm" onClick={() => copy(wf.workflow_id)}>
            <Copy aria-hidden />
            ID 복사
          </button>
          {r && (
            <Link className="btn sm" href={`/flowline/results?workflow_id=${encodeURIComponent(wf.workflow_id)}`}>
              <Table2 aria-hidden />
              평가 결과 <span className="mono">{fmt.pct(r.passRate, 1)}</span>
            </Link>
          )}
          {wf.dead_letter_id && (
            <Link className="btn sm dlqb" href={`/flowline/dlq?focus=${encodeURIComponent(wf.dead_letter_id)}`}>
              <ArchiveX aria-hidden />
              DLQ <span className="mono">{wf.dead_letter_id}</span>
              {dl ? ` · ${DLQ_STATUS_META[dl.status].label}` : ""}
            </Link>
          )}
          {nonTerm && (
            <button className="btn sm danger" onClick={() => setConfirm(true)} disabled={!can("cancel")} title={can("cancel") ? "실행 취소" : "Operator 이상 권한 필요"}>
              <Ban aria-hidden />
              실행 취소
            </button>
          )}
        </div>
      </div>
      {confirm && nonTerm && (
        <motion.div className="confirm" style={{ marginTop: 12 }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          <div className="steps">
            <b className="on">1 사유 입력</b>
            <ChevronRight aria-hidden />
            <span>2 확인</span>
          </div>
          <Note tone="failed" icon={<AlertTriangle aria-hidden />}>
            {wf.status === "RUNNING" ? (
              <>
                실행 중인 PipelineJob <b className="mono">{wf.pipeline_job_id}</b>에 취소를 요청합니다. Vertex AI에서 종료가 확인된 뒤 Slot이 반환됩니다.
              </>
            ) : (
              "대기열에서 제거하고 예약된 Slot을 즉시 반환합니다."
            )}
          </Note>
          <label className="field">
            <span>취소 사유 (감사 로그에 기록)</span>
            <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 잘못된 입력 배치 업로드" autoFocus />
          </label>
          <PermNote perm="cancel" label="Workflow 취소" />
          <div className="row end">
            <button className="btn" onClick={() => setConfirm(false)}>
              닫기
            </button>
            <button className="btn danger" onClick={cancel} disabled={busy || !can("cancel")}>
              <Ban aria-hidden />
              취소 실행
            </button>
          </div>
        </motion.div>
      )}
      <div className="summary-ids">
        <div>
          <small>Batch ID</small>
          <span>{wf.batch_id}</span>
        </div>
        <div>
          <small>Attempt</small>
          <span>{wf.attempt || 0} / 3</span>
        </div>
        <div>
          <small>생성 → 시작 → 종료</small>
          <span>
            {fmt.time(wf.created_at)} → {fmt.time(wf.started_at)} → {fmt.time(wf.completed_at)}
          </span>
        </div>
        <div>
          <small>대기 · 실행 · 총</small>
          <span>
            {dur(wf.waitMs)} · {!wf.completed_at && wf.started_at ? liveSpan(now - wf.started_at) : dur(wf.runMs)} ·{" "}
            {wf.totalMs != null ? (
              dur(wf.totalMs)
            ) : (
              <>
                {liveSpan(now - wf.created_at)} <span className="sub">진행 중</span>
              </>
            )}
          </span>
        </div>
        <div className="span2">
          <small>입력 데이터</small>
          <span>
            {wf.input.uri}{" "}
            <span className="sub">
              gen {wf.input.generation} · {wf.input.utteranceCount}건 · {fmt.bytes(wf.input.sizeBytes)}
            </span>
          </span>
        </div>
        <div className="span2">
          <small>결과 Artifact</small>
          <span>
            {r ? (
              <>
                {r.uri}{" "}
                <span className="sub">
                  {fmt.number(r.rows)} rows · {fmt.bytes(r.sizeBytes)} · {r.bqTable}
                </span>
              </>
            ) : (
              <span className="sub">아직 생성되지 않음</span>
            )}
          </span>
        </div>
        <div className="span2">
          <small>PipelineJob ID (현재)</small>
          <span>{wf.pipeline_job_id ?? "-"}</span>
        </div>
        <div>
          <small>Trace ID</small>
          <span>{wf.trace_id}</span>
        </div>
        <div>
          <small>Correlation ID</small>
          <span>{wf.correlation_id}</span>
        </div>
        <div className="span2">
          <small>Workflow Execution</small>
          <span>{wf.workflow_execution_id ? wf.workflow_execution_id.split("/").slice(-1)[0] : "-"}</span>
        </div>
        <div>
          <small>Event</small>
          <span>{wf.event_type}</span>
        </div>
        <div>
          <small>Idempotency Key</small>
          <span title={wf.idempotency_key}>{fmt.shortHash(wf.idempotency_key, 16)}…</span>
        </div>
        {wf.cancel_reason && (
          <div className="span2">
            <small>취소</small>
            <span>
              {opName(wf.cancelled_by)} · {wf.cancel_reason}
            </span>
          </div>
        )}
      </div>
      <StateBar wf={wf} />
    </>
  );
}

// ───────────────────────────── node panel ──
function NodePanel({ n, wf, onLogs }: { n: DagNode | undefined; wf: Workflow; onLogs: () => void }) {
  if (!n) return <Empty>노드를 선택하면 상세 정보가 표시됩니다</Empty>;
  const r = n.resources;
  const pct = n.status === "SUCCEEDED" ? 1 : n.progress?.pct ?? 0;
  return (
    <div className="stack">
      <div className="head-row" style={{ alignItems: "center" }}>
        <div>
          <div className="eyebrow">Task · {n.task_id || "-"}</div>
          <div className="h2" style={{ fontSize: 15 }}>
            {n.labelKo}
          </div>
        </div>
        <StatusPill kind="node" status={n.status} />
      </div>
      <p className="sub" style={{ margin: 0 }}>
        {n.description}
      </p>
      {n.progress?.total ? (
        <div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 11.5 }}>
            <span className="sub">
              진행 <span className="mono">{fmt.number(n.progress.processed)}/{fmt.number(n.progress.total)}</span>
            </span>
            <span className="mono">{fmt.pct(pct, 1)}</span>
          </div>
          <div className="meter" style={{ marginTop: 4 }}>
            <i style={{ width: `${(pct * 100).toFixed(1)}%`, background: `var(--st-${STATUS_TONE_NODE(n.status)})` }} />
          </div>
          {n.progress.pass != null && (n.progress.pass || n.progress.fail) ? (
            <div className="sub" style={{ marginTop: 4 }}>
              pass <b style={{ color: "var(--st-success)" }}>{n.progress.pass}</b> · fail <b style={{ color: "var(--st-failed)" }}>{n.progress.fail}</b>
            </div>
          ) : null}
        </div>
      ) : null}
      <dl className="kv">
        <dt>의존성</dt>
        <dd className="mono">{n.deps.length ? n.deps.join(", ") : "— (root)"}</dd>
        <dt>시작 / 종료</dt>
        <dd className="mono">
          {fmt.time(n.start_at)} → {fmt.time(n.end_at)}
        </dd>
        <dt>소요</dt>
        <dd className="mono">{dur(n.duration_ms)}</dd>
        <dt>Machine</dt>
        <dd className="mono">
          {r?.machineType ?? "-"}
          {r?.cpu ? ` · CPU ${r.cpu.cores}c ${r.cpu.utilPct}%` : ""}
          {r?.gpu ? ` · ${r.gpu.type}×${r.gpu.count} ${r.gpu.utilPct}%` : ""}
          {r?.memory ? ` · Mem ${r.memory.usedGb}/${r.memory.limitGb}GB` : ""}
        </dd>
        <dt>Image</dt>
        <dd className="mono">{n.image || "-"}</dd>
      </dl>
      {n.error && (
        <div className="err">
          {n.error.code} · {FAILURE_CATEGORY_META[n.error.category]?.label ?? n.error.category}
          <br />
          {n.error.message}
        </div>
      )}
      <div className="eyebrow">Inputs / Outputs</div>
      <div className="io-list">
        {(n.inputs ?? []).map((i) => (
          <div key={"i" + i.name}>
            <ChevronRight aria-hidden />
            <span>
              {i.name} <span className="sub">{i.type}</span>
              <br />
              <span className="sub">{i.uri}</span>
            </span>
          </div>
        ))}
        {(n.outputs ?? []).map((o) => (
          <div key={"o" + o.name} style={{ opacity: o.available ? 1 : 0.5 }}>
            <FileCheck aria-hidden />
            <span>
              {o.name}{" "}
              <span className="sub">
                {o.type}
                {o.available ? "" : " · 미생성"}
              </span>
              <br />
              <span className="sub">{o.uri}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn sm" onClick={onLogs}>
          <Terminal aria-hidden />이 노드 로그 보기
        </button>
        {n.status === "FAILED" && wf.status === "DEAD_LETTERED" && wf.dead_letter_id && (
          <Link className="btn sm dlqb" href={`/flowline/dlq?focus=${encodeURIComponent(wf.dead_letter_id)}`}>
            <RefreshCw aria-hidden />
            DLQ에서 Replay
          </Link>
        )}
      </div>
    </div>
  );
}
const STATUS_TONE_NODE = (s: string) => ({ SUCCEEDED: "success", RUNNING: "running", FAILED: "failed", PENDING: "queued", SKIPPED: "cancelled", CANCELLED: "cancelled" })[s] ?? "queued";

// ───────────────────────────── event timeline ──
function Timeline({ wf, live }: { wf: Workflow; live: boolean }) {
  const { data } = useApi(["workflow-events", wf.workflow_id], () => api.workflowEvents(wf.workflow_id), { revalidateOn: live ? ["tick"] : ["transition"], throttleMs: 3000 });
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => {
    const out: ({ sep: string; k: string } | { ev: NonNullable<typeof data>[number]; k: string })[] = [];
    let lastAtt: number | null | undefined = undefined;
    for (const e of data ?? []) {
      if (e.attempt != null && e.attempt !== lastAtt) {
        out.push({ sep: `ATTEMPT ${e.attempt} · ${e.pipeline_job_id ?? ""}`, k: "sep" + e.event_id });
        lastAtt = e.attempt;
      }
      out.push({ ev: e, k: e.event_id });
    }
    return out;
  }, [data]);
  return (
    <Panel title="Event Timeline" icon={<History aria-hidden />} right={<span className="sub">{data?.length ?? "-"}건 · 클릭하여 payload</span>}>
      {!data ? (
        <Skel h={300} />
      ) : !data.length ? (
        <Empty>이벤트가 없습니다</Empty>
      ) : (
        <div className="timeline">
          {rows.map((r) => {
            if ("sep" in r)
              return (
                <div key={r.k} className="tl-sep">
                  {r.sep}
                </div>
              );
            const e = r.ev;
            const tone =
              e.severity === "ERROR" || e.severity === "CRITICAL"
                ? "failed"
                : e.severity === "WARNING"
                  ? "retry"
                  : /COMPLETED|SUCCEEDED|COMMITTED/.test(e.name)
                    ? "success"
                    : /RETRY/.test(e.name)
                      ? "retry"
                      : /DEAD_LETTER/.test(e.name)
                        ? "dlq"
                        : "running";
            const isOpen = open === e.event_id;
            return (
              <div
                key={r.k}
                className={clsx("tl-row", `t-${tone}`, isOpen && "open")}
                tabIndex={0}
                role="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : e.event_id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    setOpen(isOpen ? null : e.event_id);
                  }
                }}
              >
                <span className="tt">{fmt.timeMs(e.ts).slice(0, 10)}</span>
                <span className="dot" />
                <span className="tn">
                  {e.name}
                  <small>{e.label}</small>
                </span>
                {isOpen && (
                  <div className="tp" onClick={(ev) => ev.stopPropagation()}>
                    <JsonView value={{ event_id: e.event_id, timestamp: e.timestamp, source: e.source, stage: e.stage, trace_id: e.trace_id, payload: e.payload }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ───────────────────────────── log explorer ──
type LogQ = { lsev: string | null; lcomp: string | null; levent: string | null; ltrace: string | null; lq: string | null };
function LogExplorer({ wf, live, q, setQ }: { wf: Workflow; live: boolean; q: LogQ; setQ: (p: Partial<LogQ>) => void }) {
  const copy = useCopy();
  const toast = useToast();
  const [openLog, setOpenLog] = useState<string | null>(null);
  const writeTrace = useCallback((v: string | null) => setQ({ ltrace: v }), [setQ]);
  const writeText = useCallback((v: string | null) => setQ({ lq: v }), [setQ]);
  const [trace, setTrace] = useDebouncedParam(q.ltrace, writeTrace, 250);
  const [text, setText] = useDebouncedParam(q.lq, writeText, 250);
  const logsRef = useRef<HTMLDivElement>(null);
  const query = { order: "asc" as const, limit: 600, min_severity: q.lsev ?? undefined, component: q.lcomp ?? undefined, event_type: q.levent ?? undefined, trace_id: q.ltrace ?? undefined, q: q.lq ?? undefined };
  const { data, error } = useApi(["workflow-logs", wf.workflow_id, query], () => api.workflowLogs(wf.workflow_id, query), {
    revalidateOn: live && !openLog ? ["tick"] : [],
    throttleMs: 3600,
  });
  const all = useApi(["workflow-logs-all", wf.workflow_id], () => api.workflowLogs(wf.workflow_id, { limit: 2000 }), { revalidateOn: live ? ["transition"] : [] });
  const eventTypes = useMemo(() => [...new Set((all.data?.items ?? []).map((l) => l.event_type).filter(Boolean) as string[])].sort(), [all.data]);
  const comps = DAG_TEMPLATE.map((d) => d.id);
  const list = data?.items ?? [];
  // keep the tail in view while new lines arrive
  const stick = useRef(true);
  useEffect(() => {
    const el = logsRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list.length]);
  const jsonl = () => list.map((l) => JSON.stringify(l)).join("\n");
  return (
    <section className="panel" id="fl-logpanel">
      <div className="panel-h">
        <h2 className="h2">
          <Terminal aria-hidden />
          Log Explorer
        </h2>
        <div className="row">
          <button className="btn sm" onClick={() => copy(jsonl(), logsRef.current)}>
            <Copy aria-hidden />
            복사
          </button>
          <button
            className="btn sm"
            onClick={() => {
              downloadText(jsonl(), `${wf.workflow_id}-logs.jsonl`, "application/x-ndjson;charset=utf-8");
              toast(`${wf.workflow_id}-logs.jsonl 다운로드 (${list.length}줄, 현재 필터)`);
            }}
          >
            <Download aria-hidden />
            내보내기
          </button>
        </div>
      </div>
      <div className="panel-b">
        <div className="filters" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", marginBottom: 10 }}>
          <label className="field">
            <span>Severity 이상</span>
            <select className="inp" value={q.lsev ?? ""} onChange={(e) => setQ({ lsev: e.target.value || null })}>
              <option value="">전체</option>
              {["INFO", "NOTICE", "WARNING", "ERROR"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Component</span>
            <select className="inp" value={q.lcomp ?? ""} onChange={(e) => setQ({ lcomp: e.target.value || null })}>
              <option value="">전체</option>
              {comps.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Event</span>
            <select className="inp" value={q.levent ?? ""} onChange={(e) => setQ({ levent: e.target.value || null })}>
              <option value="">전체</option>
              {eventTypes.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Trace ID</span>
            <input className="inp mono" value={trace} onChange={(e) => setTrace(e.target.value)} placeholder={fmt.shortHash(wf.trace_id, 12) + "…"} />
          </label>
          <label className="field">
            <span>검색</span>
            <input className="inp" value={text} onChange={(e) => setText(e.target.value)} placeholder="OOM, quota…" />
          </label>
        </div>
        {error ? (
          <ErrorBox error={error} />
        ) : (
          <div
            className="logs"
            ref={logsRef}
            onScroll={(e) => {
              const t = e.currentTarget;
              stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
            }}
          >
            {!data ? (
              <div style={{ padding: 10 }}>
                <Skel h={200} style={{ opacity: 0.2 }} />
              </div>
            ) : list.length ? (
              list.map((l) => <LogRow key={l.log_id} l={l} open={openLog === l.log_id} onToggle={() => setOpenLog(openLog === l.log_id ? null : l.log_id)} onTrace={(t) => { setTrace(t); setQ({ ltrace: t }); }} />)
            ) : (
              <div className="empty" style={{ margin: 10, borderColor: "rgba(255,255,255,.12)" }}>
                조건에 맞는 로그가 없습니다
              </div>
            )}
          </div>
        )}
        <div className="sub" style={{ marginTop: 6 }}>
          <span className="mono">{fmt.number(data?.items.length ?? 0)}</span>건 표시 · 전체 <span className="mono">{fmt.number(data?.total ?? 0)}</span> · Cloud Logging (mock) · 행을 누르면 JSON 펼치기
          {openLog && live ? " · 펼친 동안 자동 갱신 일시정지" : ""}
        </div>
      </div>
    </section>
  );
}

function LogRow({ l, open, onToggle, onTrace }: { l: LogEntry; open: boolean; onToggle: () => void; onTrace: (t: string) => void }) {
  const copy = useCopy();
  const preRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <button type="button" className="log" onClick={onToggle} aria-expanded={open}>
        <span className="t">{fmt.timeMs(l.ts)}</span>
        <span className={`sv-${l.severity}`} style={{ color: `var(--st-${SEV_TONE[l.severity] ?? "running"})` }}>
          {l.severity}
        </span>
        <span className="c">{l.component || l.service}</span>
        <span className="m">
          {l.message}
          {l.stack_trace && <span style={{ color: "var(--st-failed)" }}> [stack trace]</span>}
        </span>
      </button>
      {open && (
        <div className="log-x" ref={preRef}>
          <JsonView value={{ ...l, stack_trace: l.stack_trace ? "(아래 참조)" : null }} />
          {l.stack_trace && (
            <pre className="trace" style={{ marginTop: 6 }}>
              {l.stack_trace}
            </pre>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm" onClick={() => copy(JSON.stringify(l, null, 2), preRef.current)}>
              <Copy aria-hidden />
              JSON 복사
            </button>
            {l.trace_id && (
              <button className="btn sm" onClick={() => onTrace(l.trace_id)}>
                <GitBranch aria-hidden />
                trace {fmt.shortHash(l.trace_id, 8)}로 필터
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ───────────────────────────── history ──
const RST: Record<string, [string, string]> = {
  SUCCEEDED: ["success", "check-circle"],
  RUNNING: ["running", "loader"],
  QUEUED: ["queued", "clock"],
  APPROVED: ["queued", "check"],
  FAILED: ["failed", "x-octagon"],
  CANCELLED: ["cancelled", "ban"],
  SUPERSEDED: ["cancelled", "skip-forward"],
};
export function ReplayStatusPill({ status }: { status: Replay["status"] }) {
  const m = RST[status] ?? ["queued", "info"];
  return (
    <span className={`pill sm t-${m[0]}`}>
      <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.03em" }}>
        {status}
      </span>
    </span>
  );
}

function HistoryPanel({ wf, onAttempt }: { wf: Workflow; onAttempt: (n: number) => void }) {
  const { data } = useApi(["workflow-attempts", wf.workflow_id], () => api.workflowAttempts(wf.workflow_id), { revalidateOn: ["transition", "dlq"] });
  const atts = wf.attempts;
  const reps = data?.replays ?? [];
  return (
    <Panel title="Execution History" icon={<RotateCcw aria-hidden />} right={<span className="sub">Attempt 비교 · Retry backoff · 오류 변화 · Replay 기록</span>}>
      {atts.length ? (
        <div className="attempts">
          {atts.map((a, i) => {
            const prev = atts[i - 1];
            return (
              <div key={a.attempt} className="stack" style={{ gap: 8 }}>
                {prev && (
                  <div className="backoff">
                    <RotateCcw aria-hidden />
                    backoff {prev.backoffSec ?? "-"}s{prev.retry_at ? " · " + fmt.time(prev.retry_at) : ""}
                  </div>
                )}
                <div className={clsx("att", i === atts.length - 1 && "cur")}>
                  <div className="att-h">
                    <b className="mono">Attempt {a.attempt}</b>
                    <StatusPill kind="attempt" status={a.status} size="sm" />
                  </div>
                  <div className="mono sub" style={{ overflowWrap: "anywhere", fontSize: 11 }}>
                    {a.pipeline_job_id}
                  </div>
                  <div className="minidag" title="DAG 노드 상태">
                    {a.dag.map((n) => (
                      <i key={n.id} className={`t-${STATUS_TONE_NODE(n.status)}`} title={`${n.id}: ${n.status}`} />
                    ))}
                  </div>
                  <dl className="kv" style={{ fontSize: 11.5 }}>
                    <dt>버전</dt>
                    <dd className="mono">{a.pipeline_version}</dd>
                    <dt>시작</dt>
                    <dd className="mono">{fmt.time(a.started_at)}</dd>
                    <dt>소요</dt>
                    <dd className="mono">{dur(a.duration_ms)}</dd>
                    {a.failed_node && (
                      <>
                        <dt>실패 노드</dt>
                        <dd className="mono">{a.failed_node}</dd>
                      </>
                    )}
                  </dl>
                  {a.error_code && (
                    <div className="err">
                      {a.error_code} · {(a.error_category && FAILURE_CATEGORY_META[a.error_category]?.label) || a.error_category}
                      <br />
                      {a.error_message}
                    </div>
                  )}
                  {prev &&
                    (prev.error_code === a.error_code && a.error_code ? (
                      <div className="delta">
                        <AlertTriangle aria-hidden />
                        이전과 같은 오류 반복 ({a.error_code})
                      </div>
                    ) : a.error_code ? (
                      <div className="delta">
                        <GitBranch aria-hidden />
                        오류 변경: {prev.error_code ?? "-"} → {a.error_code}
                      </div>
                    ) : (
                      <div className="delta" style={{ color: "var(--st-success)" }}>
                        <Check aria-hidden />
                        이전 오류({prev.error_code}) 해소
                      </div>
                    ))}
                  {prev && prev.pipeline_version !== a.pipeline_version && (
                    <div className="delta">
                      버전 변경 {prev.pipeline_version} → {a.pipeline_version}
                    </div>
                  )}
                  <button className="btn sm ghost" onClick={() => onAttempt(a.attempt)}>
                    <Eye aria-hidden />이 Attempt DAG 보기
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>아직 실행된 Attempt가 없습니다 (Capacity 대기 중)</Empty>
      )}
      <div style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          수동 Replay 기록
        </div>
        {wf.replay_of && (
          <Note icon={<RefreshCw aria-hidden />} style={{ marginBottom: 8 }}>
            이 Workflow는{" "}
            <Link className="idlink" href={wfHref(wf.replay_of, { screen: "explorer" })}>
              {wf.replay_of}
            </Link>
            의 Replay입니다 (cycle {wf.replay_cycle}).
          </Note>
        )}
        {wf.replayed_by && (
          <Note tone="success" icon={<RefreshCw aria-hidden />} style={{ marginBottom: 8 }}>
            이후{" "}
            <Link className="idlink" href={wfHref(wf.replayed_by, { screen: "explorer" })}>
              {wf.replayed_by}
            </Link>
            로 Replay 되었습니다.
          </Note>
        )}
        {reps.length ? (
          <div className="tbl-wrap">
            <table className="tbl fluid">
              <thead>
                <tr>
                  <th>Replay</th>
                  <th>상태</th>
                  <th>원본 → Replay</th>
                  <th>버전</th>
                  <th>요청 / 승인</th>
                  <th>사유</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.replay_id}>
                    <td className="mono nw">{r.replay_id}</td>
                    <td>
                      <ReplayStatusPill status={r.status} />
                    </td>
                    <td className="nw">
                      <Link className="idlink" href={wfHref(r.original_workflow_id, { screen: "explorer" })}>
                        {r.original_workflow_id}
                      </Link>{" "}
                      →{" "}
                      {r.replay_workflow_id ? (
                        <Link className="idlink" href={wfHref(r.replay_workflow_id, { screen: "explorer" })}>
                          {r.replay_workflow_id}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="mono nw">
                      {r.pipeline_version_from} → {r.pipeline_version_to}
                    </td>
                    <td className="nw">
                      {opName(r.requested_by)} / {opName(r.approved_by)}
                    </td>
                    <td style={{ minWidth: 200 }}>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !wf.replay_of && !wf.replayed_by ? (
          <div className="sub">Replay 기록이 없습니다.</div>
        ) : null}
      </div>
    </Panel>
  );
}
