"use client";
/**
 * S-04 · Pipeline Detail. Context chain Workflow → Pipeline(attempt) → Task(node) → Event lives in
 * the URL (?attempt=&node=), so back/forward and reload keep it. Cancel goes through
 * POST /workflows/{id}/cancel with an in-page confirmation.
 */
import clsx from "clsx";
import { Archive, ChevronLeft, Copy, Download, Map as MapIcon, RefreshCw, Search, Table, XOctagon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CatalogIcon, StatusPill, LangBadge, fmt } from "@/components/shared";
import { DAG_TEMPLATE, DLQ_STATUS_META, FAILURE_CATEGORY_META, NODE_STATUS_META, STATE_TO_STAGE, STATUS_META, TERMINAL_STATES } from "@/lib/catalog";
import { ApiClientError, api, downloadText, parseAsInt, parseAsString, revalidateKey, useApi, useQueryStates } from "@/lib/client";
import type { Attempt, ComponentId, DagNode, LogEntry, Workflow, WorkflowEvent } from "@/lib/types";
import { Empty, ErrorNote, JsonView, OperatorSelect, PermNote, Plate, Sheet, SheetHead, Skeleton, copyText, opName, useExplorerHref, usePerms, useToast } from "./ui";

/* ───────────── /atlas/workflows → latest running workflow ───────────── */
export function WorkflowsIndex() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.workflows({ status: ["RUNNING"], pageSize: 1, sort: "updated_desc" });
        const any = r.items[0] ?? (await api.workflows({ pageSize: 1 })).items[0];
        if (alive && any) router.replace(`/workflows/${any.workflow_id}`);
        else if (alive) setErr("표시할 Workflow가 없습니다.");
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);
  return (
    <div className="sheet">
      <SheetHead dwg="SHEET S-04 · PIPELINE DETAIL" title="Pipeline 상세" desc="실행 중인 최신 Workflow를 여는 중입니다…" />
      {err ? <div className="note bad">{err}</div> : <Skeleton rows={6} />}
    </div>
  );
}

/* ───────────── DAG ───────────── */
const DAG_POS: Record<ComponentId, [number, number]> = {
  preprocess: [0, 1],
  intent_eval: [1, 0],
  response_eval: [1, 1],
  latency_check: [1, 2],
  aggregate: [2, 1],
  persist: [3, 1],
};
function templateDag(): DagNode[] {
  return DAG_TEMPLATE.map((t) => ({
    id: t.id,
    label: t.label,
    labelKo: t.labelKo,
    deps: t.deps,
    status: "PENDING",
    start_at: null,
    end_at: null,
    duration_ms: null,
    task_id: "—",
    progress: { processed: 0, total: 0, pct: 0, pass: 0, fail: 0 },
    resources: { machineType: t.machineType, cpu: { cores: t.cpu, utilPct: 0 }, gpu: t.gpu ? { ...t.gpu, utilPct: 0 } : null, memory: { limitGb: t.memGb, usedGb: 0 } },
    image: t.image,
    inputs: [],
    outputs: [],
    error: null,
    description: t.description,
  }));
}

function DagSvg({ dag, sel, onSel }: { dag: DagNode[]; sel: string | null; onSel: (id: ComponentId) => void }) {
  const W = 980;
  const H = 316;
  const colW = W / 4;
  const bw = 196;
  const bh = 76;
  const P = {} as Record<ComponentId, { x: number; y: number; w: number; h: number }>;
  (Object.entries(DAG_POS) as [ComponentId, [number, number]][]).forEach(([id, [c, r]]) => (P[id] = { x: 20 + c * colW + (colW - bw - 40) / 2, y: 16 + r * 94, w: bw, h: bh }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Pipeline DAG — 노드를 선택하면 상세가 열립니다">
      <defs>
        <marker id="at-darr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,1 L9,5 L0,9z" fill="var(--ink-3)" />
        </marker>
      </defs>
      {dag.flatMap((n) =>
        n.deps.map((dId) => {
          const a = P[dId];
          const b = P[n.id];
          const ax = a.x + a.w,
            ay = a.y + a.h / 2,
            bx = b.x,
            by = b.y + b.h / 2;
          return (
            <path
              key={dId + n.id}
              className={clsx("dedge", n.status === "RUNNING" && "on")}
              d={`M${ax},${ay} C${ax + 40},${ay} ${bx - 40},${by} ${bx - 6},${by}`}
              markerEnd="url(#at-darr)"
              style={n.status === "SKIPPED" ? { strokeDasharray: "3 4", opacity: 0.5 } : undefined}
            />
          );
        }),
      )}
      {dag.map((n) => {
        const p = P[n.id];
        const m = NODE_STATUS_META[n.status];
        const pct = n.progress?.pct ?? 0;
        return (
          <g
            key={n.id}
            className={clsx("dnode", `tone-${m.tone}`, n.status === "FAILED" && "failed", sel === n.id && "sel")}
            tabIndex={0}
            role="button"
            aria-pressed={sel === n.id}
            aria-label={`${n.labelKo} ${m.label}`}
            onClick={() => onSel(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSel(n.id);
              }
            }}
          >
            <rect className="b" x={p.x} y={p.y} width={p.w} height={p.h} rx={2} style={n.status === "SKIPPED" || n.status === "PENDING" ? { strokeDasharray: "4 3" } : undefined} />
            <rect x={p.x} y={p.y} width={4} height={p.h} fill="var(--tc)" />
            <text className="dl" x={p.x + 13} y={p.y + 20}>
              {n.labelKo}
            </text>
            <text className="dm" x={p.x + 13} y={p.y + 35}>
              {n.id} · {n.resources.machineType}
              {n.resources.gpu ? ` · L4×${n.resources.gpu.count}` : ""}
            </text>
            <CatalogIcon name={m.icon} x={p.x + 13} y={p.y + 45} width={13} height={13} style={{ color: "var(--tc)" }} aria-hidden />
            <text className="ds" x={p.x + 30} y={p.y + 56}>
              {m.label}
            </text>
            <text className="dm" x={p.x + p.w - 10} y={p.y + 56} textAnchor="end" style={{ fill: "var(--ink)", fontWeight: 600 }}>
              {n.duration_ms ? fmt.duration(n.duration_ms, { style: "short" }) : n.status === "RUNNING" ? fmt.pct(pct, 0) : "—"}
            </text>
            <rect x={p.x + 13} y={p.y + 64} width={p.w - 26} height={3} fill="var(--paper-2)" />
            <rect x={p.x + 13} y={p.y + 64} width={(p.w - 26) * pct} height={3} fill="var(--tc)" style={{ transition: "width .6s" }} />
          </g>
        );
      })}
      <text x={12} y={H - 6} style={{ font: "400 11px var(--f-mono)", fill: "var(--mark)" }}>
        preprocess → [intent_eval ∥ response_eval ∥ latency_check] → aggregate → persist
      </text>
    </svg>
  );
}

function NodeDetail({ n, wf, onLogs }: { n: DagNode | undefined; wf: Workflow; onLogs: (c: string) => void }) {
  if (!n)
    return (
      <Empty title="노드를 선택하세요">DAG의 컴포넌트를 클릭하면 리소스, 입력·출력 Artifact, 오류가 표시됩니다.</Empty>
    );
  const r = n.resources;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 16, letterSpacing: "-0.02em" }}>{n.labelKo}</b>
        <StatusPill kind="node" status={n.status} />
        <span className="mono muted" style={{ fontSize: 11 }}>
          task {n.task_id}
        </span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        {n.description}
      </p>
      {n.error ? (
        <div className="note bad">
          <b className="mono">{n.error.code}</b> · {FAILURE_CATEGORY_META[n.error.category]?.label ?? n.error.category}
          <div style={{ marginTop: 3 }}>{n.error.message}</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => onLogs(n.id)}>
              <Search />이 노드 오류 로그
            </button>
            {wf.dead_letter_id ? (
              <Link className="btn sm primary" href={`/dlq?sel=${wf.dead_letter_id}`}>
                <RefreshCw />
                DLQ에서 Replay
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      <dl className="kv">
        <dt>시작</dt>
        <dd className="mono">{n.start_at ? fmt.dateTime(n.start_at) : "—"}</dd>
        <dt>종료</dt>
        <dd className="mono">{n.end_at ? fmt.dateTime(n.end_at) : "—"}</dd>
        <dt>소요</dt>
        <dd className="mono">{n.duration_ms ? fmt.duration(n.duration_ms) : "—"}</dd>
        <dt>진행</dt>
        <dd className="mono">
          {n.progress?.total ? `${n.progress.processed}/${n.progress.total} (${fmt.pct(n.progress.pct, 1)}) · pass ${n.progress.pass ?? "—"} · fail ${n.progress.fail ?? "—"}` : "—"}
        </dd>
        <dt>의존성</dt>
        <dd className="mono">{n.deps.length ? n.deps.join(", ") : "(시작 노드)"}</dd>
        <dt>Machine</dt>
        <dd className="mono">
          {r.machineType} · CPU {r.cpu.cores}c {r.cpu.utilPct}%{r.gpu ? ` · ${r.gpu.type}×${r.gpu.count} ${r.gpu.utilPct}%` : ""} · Mem {r.memory.usedGb}/{r.memory.limitGb} GB
        </dd>
        <dt>Image</dt>
        <dd className="mono">{n.image}</dd>
      </dl>
      <div>
        <div className="grp-t" style={{ padding: "0 0 4px" }}>
          Inputs
        </div>
        {n.inputs.length ? (
          n.inputs.map((i) => (
            <div className="obj" key={i.name}>
              <span className="on">
                {i.name} <span className="muted">{i.type}</span>
              </span>
              <span className="om">
                <span>{i.uri}</span>
                {i.sizeBytes ? <span>{fmt.bytes(i.sizeBytes)}</span> : null}
              </span>
            </div>
          ))
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      <div>
        <div className="grp-t" style={{ padding: "0 0 4px" }}>
          Outputs
        </div>
        {n.outputs.length ? (
          n.outputs.map((i) => (
            <div className="obj" key={i.name}>
              <span className="on">
                {i.name} <span className="muted">{i.type}</span>{" "}
                {i.available ? <StatusPill status="SUCCEEDED" label="available" size="xs" /> : <StatusPill status="QUEUED" label="not yet" size="xs" showIcon={false} />}
              </span>
              <span className="om">
                <span>{i.uri}</span>
              </span>
            </div>
          ))
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => onLogs(n.id)}>
        <Search />
        {n.id} 로그만 보기
      </button>
    </div>
  );
}

const evTone = (n: string) =>
  /FAILED|TIMEOUT|DEAD_LETTER_PUBLISHED/.test(n) ? "failed" : /RETRY/.test(n) ? "retry" : /SUCCEEDED|COMPLETED|COMMITTED/.test(n) ? "success" : /CANCEL/.test(n) ? "cancelled" : /STARTED|SUBMITTED|RESERVED/.test(n) ? "running" : "queued";

function Timeline({ events, onEvLogs }: { events: WorkflowEvent[]; onEvLogs: (n: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!events.length) return <Empty title="이벤트가 아직 없습니다" />;
  return (
    <ol className="timeline" aria-label="Event timeline">
      {events.map((e) => (
        <li key={e.event_id} className={`tone-${evTone(e.name)}`}>
          <span className="tt">
            {fmt.time(e.ts)}
            {e.attempt ? (
              <>
                <br />
                <span style={{ fontSize: 9.5 }}>att {e.attempt}</span>
              </>
            ) : null}
          </span>
          <span className="td">
            <i />
          </span>
          <div style={{ minWidth: 0, paddingBottom: 4 }}>
            <div className="tn">{e.name}</div>
            <div className="tl">
              {e.label} · <span className="mono">{e.source}</span>
            </div>
            <div className="lnk">
              <button aria-expanded={open.has(e.event_id)} onClick={() => setOpen((s) => (s.has(e.event_id) ? (s.delete(e.event_id), new Set(s)) : new Set(s).add(e.event_id)))}>
                JSON
              </button>
              <button onClick={() => onEvLogs(e.name)}>관련 로그</button>
            </div>
            {open.has(e.event_id) ? <JsonView value={e} className="wrap" style={{ marginTop: 6 }} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function LogRow({ l }: { l: LogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="lr"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((x) => !x);
          }
        }}
      >
        <span className="muted">{fmt.timeMs(l.ts)}</span>
        <span className={`sev-${l.severity}`} style={{ fontWeight: 600 }}>
          {l.severity}
        </span>
        <span className="c muted">{l.component || l.service}</span>
        <span className="m">{l.message}</span>
      </div>
      {open ? (
        <div className="lx">
          {l.stack_trace ? (
            <pre className="code" style={{ color: "var(--st-failed)" }}>
              {l.stack_trace}
            </pre>
          ) : null}
          <JsonView value={l} className="wrap" />
        </div>
      ) : null}
    </>
  );
}

const PARSERS = {
  attempt: parseAsInt,
  node: parseAsString,
  sev: parseAsString,
  comp: parseAsString,
  ev: parseAsString,
  q: parseAsString,
  trace: parseAsString,
};

function History({ wf, replays }: { wf: Workflow; replays: { replay_id: string; status: string; pipeline_version_from: string; pipeline_version_to: string; requested_by: string; approved_by: string; created_at: number; reason: string }[] }) {
  const atts = wf.attempts;
  const errs = atts.filter((a) => a.error_code);
  const prev = errs[errs.length - 2];
  const cur = errs[errs.length - 1];
  const versions = [...new Set(atts.map((a) => a.pipeline_version))];
  return (
    <>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>#</th>
              <th>PipelineJob ID</th>
              <th>버전</th>
              <th>상태</th>
              <th>시작</th>
              <th>소요</th>
              <th>실패 노드</th>
              <th>오류</th>
              <th>Backoff → 다음</th>
            </tr>
          </thead>
          <tbody>
            {atts.map((a: Attempt) => (
              <tr key={a.attempt}>
                <td className="mono">{a.attempt}</td>
                <td className="idc">{a.pipeline_job_id}</td>
                <td className="mono">{a.pipeline_version}</td>
                <td>
                  <StatusPill kind="attempt" status={a.status} />
                </td>
                <td className="mono muted">{a.started_at ? fmt.time(a.started_at) : "—"}</td>
                <td className="mono">{a.duration_ms ? fmt.duration(a.duration_ms, { style: "short" }) : "—"}</td>
                <td className="mono">{a.failed_node ?? "—"}</td>
                <td>
                  {a.error_code ? (
                    <>
                      <span className="mono sev-ERROR">{a.error_code}</span>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {a.error_category ? `${FAILURE_CATEGORY_META[a.error_category]?.label} · ${FAILURE_CATEGORY_META[a.error_category]?.policy}` : ""}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="mono">{a.backoffSec ? `${a.backoffSec}s → ${a.retry_at ? fmt.time(a.retry_at) : ""}` : "—"}</td>
              </tr>
            ))}
            {!atts.length ? (
              <tr>
                <td colSpan={9}>
                  <Empty title="아직 Attempt가 없습니다">Capacity 확보 후 첫 PipelineJob이 생성됩니다.</Empty>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="grid g2" style={{ padding: 14, gap: 14 }}>
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            이전 오류 vs 현재 오류
          </div>
          {cur ? (
            <>
              <div className="cmp">
                <div>
                  <div className="k">{prev ? "ATTEMPT " + prev.attempt : "이전 없음"}</div>
                  <div className="v mono">{prev?.error_code ?? "—"}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {prev?.error_message ?? ""}
                  </div>
                </div>
                <div>
                  <div className="k">ATTEMPT {cur.attempt}</div>
                  <div className="v mono sev-ERROR">{cur.error_code}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {cur.error_message ?? ""}
                  </div>
                </div>
              </div>
              <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>
                {prev ? (prev.error_code === cur.error_code ? "같은 오류가 반복됨 — 일시 장애가 아닐 가능성" : "오류 유형이 바뀜 — 원인 재분류 필요") : ""}
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              실패한 Attempt가 없습니다.
            </div>
          )}
        </div>
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            버전 · Replay 기록
          </div>
          <dl className="kv">
            <dt>Attempt별 버전</dt>
            <dd className="mono">
              {versions.join(" → ") || wf.pipeline_version} {versions.length > 1 ? <span className="sev-WARNING">버전 변경</span> : "(변경 없음)"}
            </dd>
            <dt>replay_cycle</dt>
            <dd className="mono">{wf.replay_cycle}</dd>
            <dt>replay_of</dt>
            <dd>{wf.replay_of ? <Link className="mono" href={`/workflows/${wf.replay_of}`}>{wf.replay_of}</Link> : "—"}</dd>
            <dt>replayed_by</dt>
            <dd>{wf.replayed_by ? <Link className="mono" href={`/workflows/${wf.replayed_by}`}>{wf.replayed_by}</Link> : "—"}</dd>
          </dl>
          {replays.length ? (
            replays.map((r) => (
              <div className="obj" key={r.replay_id}>
                <span className="on">
                  {r.replay_id} · {r.status} · {r.pipeline_version_from} → {r.pipeline_version_to}
                </span>
                <span className="om">
                  <span>요청 {opName(r.requested_by)}</span>
                  <span>승인 {opName(r.approved_by)}</span>
                  <span>{fmt.dateTime(r.created_at)}</span>
                </span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {r.reason}
                </span>
              </div>
            ))
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              수동 Replay 기록이 없습니다.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function DetailScreen() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const router = useRouter();
  const explorerHref = useExplorerHref();
  const toast = useToast();
  const { can } = usePerms();
  const [f, setF] = useQueryStates(PARSERS);
  const [missingId, setMissingId] = useState<string | null>(null);
  const missing = missingId === id; // 404 → stop polling (and logging 404s) until the id changes
  const wfQ = useApi(["workflows", "detail", id], () => api.workflow(id).catch((e: unknown) => {
    if (e instanceof ApiClientError && e.status === 404) setMissingId(id);
    throw e;
  }), { revalidateOn: missing ? undefined : ["transition"], refreshInterval: missing ? 0 : 4000 });
  const evQ = useApi(missing ? null : ["workflow-events", id], () => api.workflowEvents(id), { revalidateOn: ["transition"], refreshInterval: 5000 });
  const attQ = useApi(missing ? null : ["workflows", "attempts", id], () => api.workflowAttempts(id), { revalidateOn: ["transition", "dlq"] });
  const logQuery = useMemo(
    () => ({ order: "asc" as const, min_severity: f.sev ?? undefined, component: f.comp ?? undefined, event_type: f.ev ?? undefined, q: f.q ?? undefined, trace_id: f.trace ?? undefined, attempt: f.attempt ?? undefined, limit: 400 }),
    [f.sev, f.comp, f.ev, f.q, f.trace, f.attempt],
  );
  const logQ = useApi(missing ? null : ["workflow-logs", id, logQuery], () => api.workflowLogs(id, logQuery), { revalidateOn: ["transition"], refreshInterval: 4000 });
  const wf = wfQ.data?.workflow_id === id ? wfQ.data : undefined;
  const dlQ = useApi(wf?.dead_letter_id ? ["dead-letters", "one", wf.dead_letter_id] : null, () => api.deadLetter(wf!.dead_letter_id!), { revalidateOn: ["dlq"] });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [qDraft, setQDraft] = useState<string | null>(null);

  useEffect(() => {
    if (qDraft == null) return;
    const t = setTimeout(() => setF({ q: qDraft || null }), 300);
    return () => clearTimeout(t);
  }, [qDraft, setF]);

  if (wfQ.error && !wf)
    return (
      <Sheet>
        <SheetHead dwg="SHEET S-04 · PIPELINE DETAIL" title="Workflow를 찾을 수 없습니다" desc={<span className="mono">{id}</span>} acts={<Link className="btn" href={explorerHref}>Explorer로</Link>} />
        <ErrorNote error={wfQ.error} />
      </Sheet>
    );
  if (!wf)
    return (
      <div className="sheet">
        <SheetHead dwg="SHEET S-04 · PIPELINE DETAIL" title={<span className="mono">{id}</span>} />
        <Skeleton rows={8} />
      </div>
    );

  const atts = wf.attempts;
  const an = f.attempt && atts.some((a) => a.attempt === f.attempt) ? f.attempt : atts.length ? atts[atts.length - 1].attempt : null;
  const att = atts.find((a) => a.attempt === an);
  const dag = att ? att.dag : templateDag();
  const failed = dag.find((n) => n.status === "FAILED");
  const nodeId = (f.node && dag.some((n) => n.id === f.node) ? f.node : null) ?? failed?.id ?? wf.current_node ?? (dag.find((n) => n.status === "RUNNING") ?? dag[dag.length - 1]).id;
  const node = dag.find((n) => n.id === nodeId);
  const terminal = TERMINAL_STATES.includes(wf.status);
  const dl = dlQ.data?.deadLetter;
  const dlClosed = dl?.status === "CLOSED";
  const lastAtt = atts[atts.length - 1];
  const logs = logQ.data?.items ?? [];

  const doCancel = async () => {
    setBusy(true);
    try {
      await api.cancelWorkflow(wf.workflow_id, { reason });
      toast.ok(
        <>
          <b>{wf.workflow_id}</b> 취소를 요청했습니다. Slot은 종료 확인 후 반환됩니다.
        </>,
      );
      setCancelOpen(false);
      setReason("");
      revalidateKey("workflows");
      void wfQ.mutate();
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  const logsToText = () => logs.map((l) => JSON.stringify(l)).join("\n");

  return (
    <Sheet>
      <nav className="crumbs" aria-label="경로">
        <button
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push(explorerHref);
          }}
        >
          <ChevronLeft size={14} aria-hidden /> 뒤로
        </button>
        <span className="sep">/</span>
        <Link href={explorerHref}>Explorer</Link>
        <span className="sep">/</span>
        <span>Workflow</span>
        <span className="sep">/</span>
        <button onClick={() => setF({ attempt: null, node: null })} className="cur" style={{ color: "var(--ink)" }}>
          {wf.workflow_id}
        </button>
        {an ? (
          <>
            <span className="sep">/</span>
            <span>attempt {an}</span>
          </>
        ) : null}
        {nodeId ? (
          <>
            <span className="sep">/</span>
            <span className="cur">{nodeId}</span>
          </>
        ) : null}
      </nav>
      <SheetHead
        dwg="SHEET S-04 · PIPELINE DETAIL"
        title={wf.batch_id}
        desc={
          <span className="mono" style={{ fontSize: 12 }}>
            {wf.event_type} · {wf.event_id} · 생성 {fmt.dateTime(wf.created_at)}
          </span>
        }
        acts={
          <>
            {!terminal ? (
              <button className="btn danger" onClick={() => setCancelOpen((x) => !x)} aria-expanded={cancelOpen}>
                <XOctagon />
                실행 취소
              </button>
            ) : null}
            {wf.dead_letter_id ? (
              dlClosed ? (
                <Link className="btn" href={`/dlq?sel=${wf.dead_letter_id}`} title="DLQ 기록이 종료되어 Replay 대상이 아닙니다">
                  <Archive />
                  DLQ 기록 (종료됨)
                </Link>
              ) : (
                <Link className="btn primary" href={`/dlq?sel=${wf.dead_letter_id}`}>
                  <RefreshCw />
                  DLQ · Replay
                </Link>
              )
            ) : null}
            {wf.result ? (
              <Link className="btn" href={`/results?workflow_id=${wf.workflow_id}`}>
                <Table />이 배치 평가 결과
              </Link>
            ) : null}
            <Link className="btn" href={`/?stage=${STATE_TO_STAGE[wf.status]}`}>
              <MapIcon />
              캔버스 위치
            </Link>
          </>
        }
      />
      {cancelOpen && !terminal ? (
        <div className="confirm">
          <div className="steps">
            <span className="done">1 대상 확인</span>
            <span className="on">2 사유 입력</span>
            <span>3 취소 요청</span>
          </div>
          <div style={{ fontSize: 13 }}>
            <b>{wf.workflow_id}</b> ({STATUS_META[wf.status].label})를 취소합니다.{" "}
            {wf.status === "RUNNING"
              ? "Vertex AI PipelineJob에 cancel을 보내고, 실행 중 노드가 CANCELLED로 확인되면 Slot을 반환합니다."
              : "대기열에서 제거하고 Slot을 즉시 반환합니다."}{" "}
            자동 Retry는 일어나지 않습니다.
          </div>
          <PermNote perm="cancel" />
          <div className="split s-55" style={{ gap: 10 }}>
            <label className="field">
              <span>취소 사유 (필수 · 감사 기록)</span>
              <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 잘못된 입력 배치 업로드 확인" autoFocus />
            </label>
            <OperatorSelect />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setCancelOpen(false)}>
              돌아가기
            </button>
            <button className="btn danger" disabled={busy || reason.trim().length < 4 || !can("cancel")} onClick={doCancel}>
              <XOctagon />
              취소 요청
            </button>
          </div>
        </div>
      ) : null}

      <section aria-label="Workflow Summary">
        <div className="grp-t" style={{ padding: "0 0 6px" }}>
          ① Workflow summary
        </div>
        <div className="summary">
          <div className="span2">
            <span className="k">Workflow ID</span>
            <span className="v big">{wf.workflow_id}</span>
          </div>
          <div>
            <span className="k">상태</span>
            <span className="v">
              <StatusPill status={wf.status} />
            </span>
          </div>
          <div>
            <span className="k">언어 · 우선순위</span>
            <span className="v">
              <LangBadge lang={wf.language} /> · P{wf.priority}
            </span>
          </div>
          <div>
            <span className="k">Pipeline 버전</span>
            <span className="v">{wf.pipeline_version}</span>
          </div>
          <div>
            <span className="k">실행 Attempt</span>
            <span className="v">{wf.attempt || 0} / 3</span>
          </div>
          <div>
            <span className="k">시작</span>
            <span className="v">{wf.started_at ? fmt.dateTime(wf.started_at) : "—"}</span>
          </div>
          <div>
            <span className="k">종료</span>
            <span className="v">{wf.completed_at ? fmt.dateTime(wf.completed_at) : wf.status === "RUNNING" ? `진행 ${fmt.pct(wf.progress.pct, 0)}` : "—"}</span>
          </div>
          <div>
            <span className="k">대기 · 실행</span>
            <span className="v">
              {wf.waitMs != null ? fmt.duration(wf.waitMs, { style: "short" }) : "—"} · {wf.runMs ? fmt.duration(wf.runMs, { style: "short" }) : "—"}
            </span>
          </div>
          {dl ? (
            <div>
              <span className="k">DLQ 기록</span>
              <span className="v">
                <StatusPill kind="dlq" status={dl.status} />
                <br />
                <span className="muted">
                  {dl.dead_letter_id}
                  {dl.resolution ? " · " + dl.resolution : ""}
                </span>
              </span>
            </div>
          ) : (
            <div>
              <span className="k">Replay Cycle</span>
              <span className="v">
                cycle {wf.replay_cycle || 0}
                <br />
                <span className="muted">{wf.replay_of ? `원본 ${wf.replay_of}` : "원본 실행"}</span>
              </span>
            </div>
          )}
          <div className="span2">
            <span className="k">입력 데이터</span>
            <span className="v">
              {wf.input.uri}
              <br />
              <span className="muted">
                gen {wf.input.generation} · {wf.input.utteranceCount} utt · {fmt.bytes(wf.input.sizeBytes)}
              </span>
            </span>
          </div>
          <div className="span2">
            <span className="k">결과 Artifact</span>
            <span className="v">
              {wf.result ? (
                <>
                  {wf.result.uri}
                  <br />
                  <span className="muted">
                    {wf.result.rows} rows · pass {fmt.pct(wf.result.passRate, 1)} · {wf.result.bqTable}
                  </span>
                </>
              ) : (
                <span className="muted">아직 없음</span>
              )}
            </span>
          </div>
          <div className="span2">
            <span className="k">PipelineJob · Execution</span>
            <span className="v">
              {wf.pipeline_job_id ?? "—"}
              <br />
              <span className="muted">{lastAtt ? lastAtt.workflow_execution_id.split("/").pop() : "—"}</span>
            </span>
          </div>
          <div className="span2">
            <span className="k">Trace · Correlation · Idempotency</span>
            <span className="v">
              {wf.trace_id}
              <br />
              <span className="muted">
                {wf.correlation_id} · {fmt.shortHash(wf.idempotency_key, 16)}…
              </span>
            </span>
          </div>
        </div>
        {wf.error ? (
          <div className="note bad" style={{ marginTop: 10 }}>
            <b className="mono">{wf.error.code}</b> at <b className="mono">{wf.error.node}</b> (attempt {wf.error.attempt}) · {wf.error.message}
          </div>
        ) : null}
        {wf.status === "RETRY_WAIT" && wf.retry_at ? (
          <div className="note warn" style={{ marginTop: 10 }}>
            attempt {wf.attempt + 1} 재실행 예정 {fmt.time(wf.retry_at)} · Slot 반납 후 Admission 재진입
          </div>
        ) : null}
        {wf.cancel_reason ? (
          <div className="note" style={{ marginTop: 10 }}>
            취소 요청 · {opName(wf.cancelled_by)} · {wf.cancel_reason}
          </div>
        ) : null}
      </section>

      <Plate
        flush
        title="② Pipeline DAG"
        right={
          <div className="att-tabs" role="group" aria-label="Attempt 선택">
            {atts.length ? (
              atts.map((a) => (
                <button key={a.attempt} aria-pressed={a.attempt === an} className={`tone-${STATUS_META_ATT(a)}`} onClick={() => setF({ attempt: a.attempt, node: null }, { history: "push" })}>
                  <i />
                  attempt {a.attempt} · {a.status}
                </button>
              ))
            ) : (
              <span className="mono muted" style={{ fontSize: 11, padding: "4px 8px" }}>
                아직 Attempt 없음 · 템플릿 표시
              </span>
            )}
          </div>
        }
      >
        <div className="split s-64" style={{ gap: 0 }}>
          <div className="dag-wrap">
            <DagSvg dag={dag} sel={nodeId} onSel={(nid) => setF({ node: nid }, { history: "push" })} />
          </div>
          <div className="d-node">
            <NodeDetail n={node} wf={wf} onLogs={(c) => setF({ comp: c })} />
          </div>
        </div>
      </Plate>

      <div className="split s-46">
        <Plate title="③ Event Timeline" refText={`${evQ.data?.length ?? 0} events`}>
          {evQ.data ? <Timeline events={evQ.data} onEvLogs={(n) => setF({ ev: n })} /> : <Skeleton />}
        </Plate>
        <Plate
          flush
          title="④ Log Explorer"
          right={
            <span style={{ display: "flex", gap: 6 }}>
              <button
                className="btn sm"
                onClick={async () => {
                  const ok = await copyText(logsToText());
                  if (ok) toast.ok(`로그 ${logs.length}행을 클립보드에 복사했습니다.`);
                  else toast.err("클립보드 접근이 막혔습니다. JSONL 내보내기를 사용하세요.");
                }}
              >
                <Copy />
                복사
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  downloadText(logsToText(), `${wf.workflow_id}-logs.jsonl`, "application/x-ndjson");
                  toast.ok(`${wf.workflow_id}-logs.jsonl 다운로드를 시작했습니다.`);
                }}
              >
                <Download />
                JSONL 내보내기
              </button>
            </span>
          }
        >
          <div style={{ borderBottom: "1px solid var(--rule-2)", padding: "12px 14px" }}>
            <div className="filters">
              <label className="field">
                <span>Severity ≥</span>
                <select className="in" value={f.sev ?? ""} onChange={(e) => setF({ sev: e.target.value || null })}>
                  <option value="">전체</option>
                  {["INFO", "NOTICE", "WARNING", "ERROR"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Component</span>
                <select className="in" value={f.comp ?? ""} onChange={(e) => setF({ comp: e.target.value || null })}>
                  <option value="">전체</option>
                  {(logQ.data?.components ?? []).concat(f.comp && !(logQ.data?.components ?? []).includes(f.comp) ? [f.comp] : []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Event</span>
                <select className="in" value={f.ev ?? ""} onChange={(e) => setF({ ev: e.target.value || null })}>
                  <option value="">전체</option>
                  {[...new Set((evQ.data ?? []).map((e) => e.name).concat(f.ev ? [f.ev] : []))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Attempt</span>
                <select className="in" value={f.attempt ?? ""} onChange={(e) => setF({ attempt: e.target.value ? +e.target.value : null })}>
                  <option value="">전체</option>
                  {atts.map((a) => (
                    <option key={a.attempt} value={a.attempt}>
                      {a.attempt}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>메시지 검색</span>
                <input className="in" value={qDraft ?? f.q ?? ""} onChange={(e) => setQDraft(e.target.value)} placeholder="OOM, quota, Traceback…" />
              </label>
              <label className="field">
                <span>Trace ID 연동</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center", height: 31 }}>
                  <input type="checkbox" className="switch" checked={!!f.trace} onChange={(e) => setF({ trace: e.target.checked ? wf.trace_id : null })} aria-label="같은 Trace ID 로그만" />
                  <span className="mono muted" style={{ fontSize: 10.5 }}>
                    {wf.trace_id.slice(0, 12)}…
                  </span>
                </span>
              </label>
            </div>
            {f.sev || f.comp || f.ev || f.q || f.trace ? (
              <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => (setQDraft(null), setF({ sev: null, comp: null, ev: null, q: null, trace: null }))}>
                필터 해제 · {logQ.data?.total ?? 0}행
              </button>
            ) : null}
          </div>
          <div className="logx" role="log" aria-label="로그">
            {logs.length ? logs.slice(-300).map((l) => <LogRow key={l.log_id} l={l} />) : logQ.isLoading ? <Skeleton /> : <Empty title="필터에 맞는 로그가 없습니다">Severity나 Component 조건을 풀어보세요.</Empty>}
          </div>
        </Plate>
      </div>

      <Plate flush title="⑤ Execution History" refText="Attempt 비교 · Retry Backoff · Replay">
        <History wf={wf} replays={attQ.data?.replays ?? []} />
        {attQ.data && attQ.data.replayChain.length > 1 ? (
          <div className="body" style={{ borderTop: "1px solid var(--rule-2)" }}>
            <div className="grp-t" style={{ padding: "0 0 6px" }}>
              Replay chain
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {attQ.data.replayChain.map((w, i) => (
                <span key={w.workflow_id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {i ? <span className="muted">→</span> : null}
                  <Link className="chip" href={`/workflows/${w.workflow_id}`} aria-current={w.workflow_id === wf.workflow_id ? "page" : undefined}>
                    {w.workflow_id} · c{w.replay_cycle}
                  </Link>
                  <StatusPill status={w.status} size="xs" />
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Plate>
      {dl && !dlClosed ? (
        <div className="note">
          DLQ 상태 <b>{DLQ_STATUS_META[dl.status].label}</b> · <Link href={`/dlq?sel=${dl.dead_letter_id}`}>{dl.dead_letter_id}</Link>에서 로그 검토 후 Replay를 승인할 수 있습니다.
        </div>
      ) : null}
    </Sheet>
  );
}

function STATUS_META_ATT(a: Attempt) {
  return a.status === "SUCCEEDED" ? "success" : a.status === "FAILED" || a.status === "TIMED_OUT" ? "failed" : a.status === "CANCELLED" ? "cancelled" : "running";
}
