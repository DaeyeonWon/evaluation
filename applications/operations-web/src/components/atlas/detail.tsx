"use client";
/**
 * S-04 · Workflow detail. Context chain Workflow → attempt → PipelineJob (root or child) → node →
 * Event lives in the URL (?attempt=&job=&node=), so back/forward and reload keep it. The Pipeline
 * DAG panel shows the attempt's job tree (root + child jobs of sub-pipelines), the DAG of the
 * selected job and failures that originate inside sub-pipelines with their path. The log explorer
 * filters by job (job_scope=tree) and component path. Cancel goes through POST /workflows/{id}/cancel.
 * Detail endpoints ignore the time range; links out keep it.
 */
import clsx from "clsx";
import { Archive, ChevronLeft, Copy, Download, Map as MapIcon, RefreshCw, Table, Workflow as WorkflowIcon, X, XOctagon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LangBadge, StatusPill } from "@/components/shared";
import { eventLabel, failureCategoryLabel, failureCategoryPolicy, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { STATE_TO_STAGE, TERMINAL_STATES } from "@/lib/catalog";
import { ApiClientError, api, downloadText, parseAsInt, parseAsString, revalidateKey, useApi, useQueryStates, useSession } from "@/lib/client";
import type { Attempt, LogEntry, Workflow, WorkflowEvent } from "@/lib/types";
import { FailPath, JobExplorer, type LogScope } from "./pipelines/job-explorer";
import { useRangeHref } from "./time-range";
import { Empty, ErrorNote, JsonView, OperatorSelect, PermNote, Plate, Sheet, SheetHead, Skeleton, copyText, opName, useExplorerHref, useToast } from "./ui";
import "@/styles/atlas-pipelines.css";

/* ───────────── /workflows → latest running workflow ───────────── */
export function WorkflowsIndex() {
  const t = useT("workflow");
  const router = useRouter();
  const rh = useRangeHref();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.workflows({ status: ["RUNNING"], pageSize: 1, sort: "updated_desc" });
        const any = r.items[0] ?? (await api.workflows({ pageSize: 1 })).items[0];
        if (alive && any) router.replace(rh(`/workflows/${any.workflow_id}`));
        else if (alive) setErr(t("index.none"));
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, rh, t]);
  return (
    <div className="sheet">
      <SheetHead dwg="SHEET S-04 · WORKFLOW DETAIL" title={t("title")} desc={t("index.opening")} />
      {err ? <div className="note bad">{err}</div> : <Skeleton rows={6} />}
    </div>
  );
}

const evTone = (n: string) =>
  /FAILED|TIMEOUT|DEAD_LETTER_PUBLISHED/.test(n) ? "failed" : /RETRY/.test(n) ? "retry" : /SUCCEEDED|COMPLETED|COMMITTED/.test(n) ? "success" : /CANCEL/.test(n) ? "cancelled" : /STARTED|SUBMITTED|RESERVED/.test(n) ? "running" : "queued";

function Timeline({ events, onEvLogs, onJob }: { events: WorkflowEvent[]; onEvLogs: (n: string) => void; onJob: (e: WorkflowEvent) => void }) {
  const t = useT("workflow");
  const f = useFmt();
  const locale = useLocale();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!events.length) return <Empty title={t("timeline.empty")} />;
  return (
    <ol className="timeline" aria-label={t("timeline.label")}>
      {events.map((e) => (
        <li key={e.event_id} className={`tone-${evTone(e.name)}`}>
          <span className="tt">
            {f.time(e.ts)}
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
              {eventLabel(e.name, locale) || e.label} · <span className="mono">{e.source}</span>
              {e.node_path ? (
                <>
                  {" "}
                  · <span className="mono wf-np">{e.node_path}</span>
                </>
              ) : null}
            </div>
            <div className="lnk">
              <button aria-expanded={open.has(e.event_id)} onClick={() => setOpen((s) => (s.has(e.event_id) ? (s.delete(e.event_id), new Set(s)) : new Set(s).add(e.event_id)))}>
                JSON
              </button>
              <button onClick={() => onEvLogs(e.name)}>{t("timeline.relatedLogs")}</button>
              {e.pipeline_job_id ? <button onClick={() => onJob(e)}>{t("timeline.openJob")}</button> : null}
            </div>
            {open.has(e.event_id) ? <JsonView value={e} className="wrap" style={{ marginTop: 6 }} /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function LogRow({ l }: { l: LogEntry }) {
  const f = useFmt();
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
        <span className="muted">{f.timeMs(l.ts)}</span>
        <span className={`sev-${l.severity}`} style={{ fontWeight: 600 }}>
          {l.severity}
        </span>
        <span className="c muted" title={l.pipeline_job_id ?? undefined}>
          {l.node_path || l.component || l.service}
        </span>
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
  job: parseAsString,
  node: parseAsString,
  sev: parseAsString,
  comp: parseAsString,
  ev: parseAsString,
  q: parseAsString,
  trace: parseAsString,
  ljob: parseAsString,
  lpath: parseAsString,
};

type ReplayRow = { replay_id: string; status: string; pipeline_version_from: string; pipeline_version_to: string; requested_by: string; approved_by: string; created_at: number; reason: string };

function History({ wf, replays, onFailure }: { wf: Workflow; replays: ReplayRow[]; onFailure: (a: Attempt) => void }) {
  const t = useT("workflow");
  const f = useFmt();
  const locale = useLocale();
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
              <th>Pipeline</th>
              <th>{t("history.status")}</th>
              <th>{t("history.start")}</th>
              <th>{t("history.duration")}</th>
              <th>{t("history.failedAt")}</th>
              <th>{t("history.error")}</th>
              <th>{t("history.backoff")}</th>
            </tr>
          </thead>
          <tbody>
            {atts.map((a: Attempt) => (
              <tr key={a.attempt}>
                <td className="mono">{a.attempt}</td>
                <td className="idc">
                  {a.pipeline_job_id}
                  {a.job_ids.length > 1 ? <div className="muted mono" style={{ fontSize: 10.5 }}>{t("history.childJobs", { count: a.job_ids.length - 1 })}</div> : null}
                </td>
                <td className="mono">
                  {a.pipeline_id}@{a.pipeline_version}
                </td>
                <td>
                  <StatusPill kind="attempt" status={a.status} />
                </td>
                <td className="mono muted">{a.started_at ? f.time(a.started_at) : "—"}</td>
                <td className="mono">{a.duration_ms ? f.duration(a.duration_ms, { style: "short" }) : "—"}</td>
                <td className="cellwrap">
                  {a.failed_path ? (
                    <button type="button" className="linkish" onClick={() => onFailure(a)} title={a.failed_job_id ?? undefined}>
                      <FailPath path={a.failed_path} />
                    </button>
                  ) : (
                    <span className="mono">{a.failed_node ?? "—"}</span>
                  )}
                </td>
                <td>
                  {a.error_code ? (
                    <>
                      <span className="mono sev-ERROR">{a.error_code}</span>
                      <div className="muted" style={{ fontSize: 10.5 }}>
                        {a.error_category ? `${failureCategoryLabel(a.error_category, locale)} · ${failureCategoryPolicy(a.error_category, locale)}` : ""}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="mono">{a.backoffSec ? `${a.backoffSec}s → ${a.retry_at ? f.time(a.retry_at) : ""}` : "—"}</td>
              </tr>
            ))}
            {!atts.length ? (
              <tr>
                <td colSpan={9}>
                  <Empty title={t("history.none")}>{t("history.noneHint")}</Empty>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="grid g2" style={{ padding: 14, gap: 14 }}>
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            {t("history.compare")}
          </div>
          {cur ? (
            <>
              <div className="cmp">
                <div>
                  <div className="k">{prev ? "ATTEMPT " + prev.attempt : t("history.noPrev")}</div>
                  <div className="v mono">{prev?.error_code ?? "—"}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {prev?.failed_path ?? ""} {prev?.error_message ?? ""}
                  </div>
                </div>
                <div>
                  <div className="k">ATTEMPT {cur.attempt}</div>
                  <div className="v mono sev-ERROR">{cur.error_code}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {cur.failed_path ?? ""} {cur.error_message ?? ""}
                  </div>
                </div>
              </div>
              <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>
                {prev ? (prev.error_code === cur.error_code ? t("history.sameError") : t("history.changedError")) : ""}
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              {t("history.noFailed")}
            </div>
          )}
        </div>
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            {t("history.versions")}
          </div>
          <dl className="kv">
            <dt>{t("history.versionPerAttempt")}</dt>
            <dd className="mono">
              {versions.join(" → ") || wf.pipeline_version} {versions.length > 1 ? <span className="sev-WARNING">{t("history.versionChanged")}</span> : t("history.versionSame")}
            </dd>
            <dt>model_version</dt>
            <dd className="mono">{wf.model_version}</dd>
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
                  <span>{t("history.requestedBy", { name: opName(r.requested_by) })}</span>
                  <span>{t("history.approvedBy", { name: opName(r.approved_by) })}</span>
                  <span>{f.dateTime(r.created_at)}</span>
                </span>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {r.reason}
                </span>
              </div>
            ))
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {t("history.noReplays")}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const attTone = (a: Attempt) => (a.status === "SUCCEEDED" ? "success" : a.status === "FAILED" || a.status === "TIMED_OUT" ? "failed" : a.status === "CANCELLED" ? "cancelled" : "running");

export function DetailScreen() {
  const t = useT("workflow");
  const tc = useT("common");
  const f = useFmt();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const router = useRouter();
  const rh = useRangeHref();
  const explorerHref = rh(useExplorerHref());
  const toast = useToast();
  const { can } = useSession();
  const [p, setF] = useQueryStates(PARSERS);
  const [missingId, setMissingId] = useState<string | null>(null);
  const missing = missingId === id; // 404 → stop polling (and logging 404s) until the id changes
  const wfQ = useApi(
    ["workflows", "detail", id],
    () =>
      api.workflow(id).catch((e: unknown) => {
        if (e instanceof ApiClientError && e.status === 404) setMissingId(id);
        throw e;
      }),
    { revalidateOn: missing ? undefined : ["transition", "job"], refreshInterval: missing ? 0 : 4000 },
  );
  const runsQ = useApi(missing ? null : ["workflows", "pipeline-runs", id], () => api.workflowPipelineRuns(id), { revalidateOn: ["job", "transition"], throttleMs: 1200, refreshInterval: 5000 });
  const evQ = useApi(missing ? null : ["workflow-events", id], () => api.workflowEvents(id), { revalidateOn: ["transition", "job"], refreshInterval: 5000 });
  const attQ = useApi(missing ? null : ["workflows", "attempts", id], () => api.workflowAttempts(id), { revalidateOn: ["transition", "dlq"] });
  const logQuery = useMemo(
    () => ({
      order: "asc" as const,
      min_severity: p.sev ?? undefined,
      component: p.comp ?? undefined,
      event_type: p.ev ?? undefined,
      q: p.q ?? undefined,
      trace_id: p.trace ?? undefined,
      attempt: p.attempt ?? undefined,
      pipeline_job_id: p.ljob ?? undefined,
      job_scope: p.ljob ? ("tree" as const) : undefined,
      node_path: p.lpath ?? undefined,
      limit: 400,
    }),
    [p.sev, p.comp, p.ev, p.q, p.trace, p.attempt, p.ljob, p.lpath],
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
    const tm = setTimeout(() => setF({ q: qDraft || null }), 300);
    return () => clearTimeout(tm);
  }, [qDraft, setF]);

  if (wfQ.error && !wf)
    return (
      <Sheet>
        <SheetHead
          dwg="SHEET S-04 · WORKFLOW DETAIL"
          title={t("notFound")}
          desc={<span className="mono">{id}</span>}
          acts={
            <Link className="btn" href={explorerHref}>
              {t("toExplorer")}
            </Link>
          }
        />
        <ErrorNote error={wfQ.error} />
      </Sheet>
    );
  if (!wf)
    return (
      <div className="sheet">
        <SheetHead dwg="SHEET S-04 · WORKFLOW DETAIL" title={<span className="mono">{id}</span>} />
        <Skeleton rows={8} />
      </div>
    );

  const atts = wf.attempts;
  const an = p.attempt && atts.some((a) => a.attempt === p.attempt) ? p.attempt : atts.length ? atts[atts.length - 1].attempt : null;
  const att = atts.find((a) => a.attempt === an);
  const run = runsQ.data?.attempts.find((a) => a.attempt === an);
  const terminal = TERMINAL_STATES.includes(wf.status);
  const dl = dlQ.data?.deadLetter;
  const dlClosed = dl?.status === "CLOSED";
  const lastAtt = atts[atts.length - 1];
  const logs = logQ.data?.items ?? [];
  // default selection: the failing job/node of this attempt, else the running leaf
  const inRun = (j: string | null | undefined) => !!(j && run && (j === run.root.job_id || j.startsWith(run.root.job_id + ".")));
  const isLatest = att === lastAtt;
  const autoJob = att?.failed_job_id ?? (isLatest && inRun(wf.current_job_id) ? wf.current_job_id : null) ?? run?.root.job_id ?? null;
  const effJob = inRun(p.job) ? p.job : autoJob;
  const autoNode = att?.failed_component ?? (isLatest && wf.current_node_path ? wf.current_node_path.split("/").pop()! : null);
  const nodeSel = p.node ?? (p.job ? null : autoNode);
  const doCancel = async () => {
    setBusy(true);
    try {
      await api.cancelWorkflow(wf.workflow_id, { reason });
      toast.ok(t("cancel.done", { id: wf.workflow_id }));
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
  const scopeLogs = (s: LogScope) => {
    setF({ ljob: s.jobId, lpath: s.nodePath ?? null, comp: null });
    requestAnimationFrame(() => document.getElementById("wf-logs")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const canCancel = can("workflow:cancel");

  return (
    <Sheet>
      <nav className="crumbs" aria-label={t("crumbs")}>
        <button
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push(explorerHref);
          }}
        >
          <ChevronLeft size={14} aria-hidden /> {tc("actions.back")}
        </button>
        <span className="sep">/</span>
        <Link href={explorerHref}>Explorer</Link>
        <span className="sep">/</span>
        <span>Workflow</span>
        <span className="sep">/</span>
        <button onClick={() => setF({ attempt: null, job: null, node: null })} className="cur" style={{ color: "var(--ink)" }}>
          {wf.workflow_id}
        </button>
        {an ? (
          <>
            <span className="sep">/</span>
            <span>attempt {an}</span>
          </>
        ) : null}
        {effJob && effJob.includes(".") ? (
          <>
            <span className="sep">/</span>
            <span>{effJob.split(".").slice(1).join(" › ")}</span>
          </>
        ) : null}
        {nodeSel ? (
          <>
            <span className="sep">/</span>
            <span className="cur">{nodeSel}</span>
          </>
        ) : null}
      </nav>
      <SheetHead
        dwg="SHEET S-04 · WORKFLOW DETAIL"
        title={wf.batch_id}
        desc={
          <span className="mono" style={{ fontSize: 12 }}>
            {wf.event_type} · {wf.event_id} · {t("createdAt", { time: f.dateTime(wf.created_at) })}
          </span>
        }
        acts={
          <>
            {!terminal ? (
              <button className="btn danger" onClick={() => setCancelOpen((x) => !x)} aria-expanded={cancelOpen} disabled={!canCancel} title={canCancel ? undefined : t("cancel.noPermission")}>
                <XOctagon />
                {t("cancel.button")}
              </button>
            ) : null}
            {wf.dead_letter_id ? (
              dlClosed ? (
                <Link className="btn" href={rh(`/dlq?sel=${wf.dead_letter_id}`)} title={t("dlqClosedHint")}>
                  <Archive />
                  {t("dlqClosed")}
                </Link>
              ) : (
                <Link className="btn primary" href={rh(`/dlq?sel=${wf.dead_letter_id}`)}>
                  <RefreshCw />
                  DLQ · Replay
                </Link>
              )
            ) : null}
            {wf.result ? (
              <Link className="btn" href={rh(`/results?workflow_id=${wf.workflow_id}`)}>
                <Table />
                {t("results")}
              </Link>
            ) : null}
            <Link className="btn" href={rh(`/pipelines/${encodeURIComponent(wf.pipeline_id)}?version=${encodeURIComponent(wf.pipeline_version)}`)}>
              <WorkflowIcon />
              {t("openPipeline")}
            </Link>
            <Link className="btn" href={rh(`/?stage=${STATE_TO_STAGE[wf.status]}`)}>
              <MapIcon />
              {t("canvas")}
            </Link>
          </>
        }
      />
      {cancelOpen && !terminal ? (
        <div className="confirm">
          <div className="steps">
            <span className="done">{t("cancel.step1")}</span>
            <span className="on">{t("cancel.step2")}</span>
            <span>{t("cancel.step3")}</span>
          </div>
          <div style={{ fontSize: 13 }}>
            {t("cancel.lead", { id: wf.workflow_id, status: statusLabel("workflow", wf.status, locale) })} {wf.status === "RUNNING" ? t("cancel.running") : t("cancel.queued")} {t("cancel.noRetry")}
          </div>
          <PermNote perm="cancel" />
          <div className="split s-55" style={{ gap: 10 }}>
            <label className="field">
              <span>{t("cancel.reason")}</span>
              <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cancel.reasonPlaceholder")} autoFocus />
            </label>
            <OperatorSelect />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setCancelOpen(false)}>
              {t("cancel.back")}
            </button>
            <button className="btn danger" disabled={busy || reason.trim().length < 4 || !canCancel} onClick={doCancel}>
              <XOctagon />
              {t("cancel.submit")}
            </button>
          </div>
        </div>
      ) : null}

      <section aria-label="Workflow summary">
        <div className="grp-t" style={{ padding: "0 0 6px" }}>
          ① Workflow summary
        </div>
        <div className="summary">
          <div className="span2">
            <span className="k">Workflow ID</span>
            <span className="v big">{wf.workflow_id}</span>
          </div>
          <div>
            <span className="k">{t("summary.status")}</span>
            <span className="v">
              <StatusPill status={wf.status} />
            </span>
          </div>
          <div>
            <span className="k">{t("summary.langPriority")}</span>
            <span className="v">
              <LangBadge lang={wf.language} /> · P{wf.priority}
            </span>
          </div>
          <div>
            <span className="k">Pipeline · Version</span>
            <span className="v">
              <Link className="mono" href={rh(`/pipelines/${encodeURIComponent(wf.pipeline_id)}?version=${encodeURIComponent(wf.pipeline_version)}`)}>
                {wf.pipeline_id}
              </Link>
              <br />
              <span className="muted">{wf.pipeline_version}</span>
            </span>
          </div>
          <div>
            <span className="k">model_version</span>
            <span className="v">{wf.model_version}</span>
          </div>
          <div>
            <span className="k">Attempt</span>
            <span className="v">{wf.attempt || 0} / 3</span>
          </div>
          <div>
            <span className="k">{t("summary.start")}</span>
            <span className="v">{wf.started_at ? f.dateTime(wf.started_at) : "—"}</span>
          </div>
          <div>
            <span className="k">{t("summary.end")}</span>
            <span className="v">{wf.completed_at ? f.dateTime(wf.completed_at) : wf.status === "RUNNING" ? t("summary.progress", { pct: f.pct(wf.progress.pct, 0) }) : "—"}</span>
          </div>
          <div>
            <span className="k">{t("summary.waitRun")}</span>
            <span className="v">
              {wf.waitMs != null ? f.duration(wf.waitMs, { style: "short" }) : "—"} · {wf.runMs ? f.duration(wf.runMs, { style: "short" }) : "—"}
            </span>
          </div>
          {dl ? (
            <div>
              <span className="k">{t("summary.dlq")}</span>
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
                <span className="muted">{wf.replay_of ? t("summary.replayOf", { id: wf.replay_of }) : t("summary.original")}</span>
              </span>
            </div>
          )}
          <div className="span2">
            <span className="k">{t("summary.input")}</span>
            <span className="v">
              {wf.input.uri}
              <br />
              <span className="muted">
                gen {wf.input.generation} · {wf.input.utteranceCount} utt · {f.bytes(wf.input.sizeBytes)}
              </span>
            </span>
          </div>
          <div className="span2">
            <span className="k">{t("summary.result")}</span>
            <span className="v">
              {wf.result ? (
                <>
                  {wf.result.uri}
                  <br />
                  <span className="muted">
                    {wf.result.rows} rows · pass {f.pct(wf.result.passRate, 1)} · {wf.result.bqTable}
                  </span>
                </>
              ) : (
                <span className="muted">{t("summary.noResult")}</span>
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
                {wf.correlation_id} · {f.shortHash(wf.idempotency_key, 16)}…
              </span>
            </span>
          </div>
        </div>
        {wf.error ? (
          <div className="note bad wf-err" style={{ marginTop: 10 }}>
            <div>
              <b className="mono">{wf.error.code}</b> · attempt {wf.error.attempt} · {failureCategoryLabel(wf.error.category, locale)}
            </div>
            {wf.error.path ? (
              <div className="wf-err-path">
                <span className="muted">{t("summary.failurePath")}</span> <FailPath path={wf.error.path} />
                {wf.error.pipeline_job_id ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setF({ attempt: wf.error!.attempt, job: wf.error!.pipeline_job_id, node: wf.error!.component ?? null }, { history: "push" });
                      document.getElementById("wf-dag")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    {t("summary.showInDag")}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div style={{ marginTop: 3 }}>{wf.error.message}</div>
          </div>
        ) : null}
        {wf.status === "RETRY_WAIT" && wf.retry_at ? (
          <div className="note warn" style={{ marginTop: 10 }}>
            {t("summary.retryAt", { attempt: wf.attempt + 1, time: f.time(wf.retry_at) })}
          </div>
        ) : null}
        {wf.cancel_reason ? (
          <div className="note" style={{ marginTop: 10 }}>
            {t("summary.cancelled", { by: opName(wf.cancelled_by), reason: wf.cancel_reason })}
          </div>
        ) : null}
      </section>

      <Plate
        flush
        id="wf-dag"
        title="② Pipeline DAG"
        right={
          <div className="att-tabs" role="group" aria-label={t("dag.attemptGroup")}>
            {atts.length ? (
              atts.map((a) => (
                <button key={a.attempt} aria-pressed={a.attempt === an} className={`tone-${attTone(a)}`} onClick={() => setF({ attempt: a.attempt, job: null, node: null }, { history: "push" })}>
                  <i />
                  attempt {a.attempt} · {statusLabel("attempt", a.status, locale)}
                </button>
              ))
            ) : (
              <span className="mono muted" style={{ fontSize: 11, padding: "4px 8px" }}>
                {t("dag.noAttempt")}
              </span>
            )}
          </div>
        }
      >
        {run ? (
          <JobExplorer
            root={run.root}
            jobId={effJob}
            onGo={(j, n) => setF({ job: j ?? run.root.job_id, node: n }, { history: "push" })}
            nodeId={nodeSel}
            onNode={(n) => setF({ node: n, job: effJob })}
            failedNodePath={att?.failed_node_path ?? null}
            failedJobId={att?.failed_job_id ?? null}
            failedComponent={att?.failed_component ?? null}
            onLogs={scopeLogs}
            height={360}
            attemptLabel={att ? <StatusPill kind="attempt" status={att.status} size="xs" /> : null}
          />
        ) : atts.length ? (
          runsQ.error ? <ErrorNote error={runsQ.error} /> : <Skeleton rows={6} />
        ) : (
          <Empty title={t("dag.noAttemptTitle")}>{t("dag.noAttemptHint")}</Empty>
        )}
      </Plate>

      <div className="split s-46">
        <Plate title="③ Event Timeline" refText={t("timeline.count", { count: evQ.data?.length ?? 0 })}>
          {evQ.data ? (
            <Timeline
              events={evQ.data}
              onEvLogs={(n) => setF({ ev: n })}
              onJob={(e) => {
                if (!e.pipeline_job_id) return;
                const root = e.pipeline_job_id.split(".")[0];
                const a = runsQ.data?.attempts.find((x) => x.root.job_id === root);
                setF({ attempt: a?.attempt ?? p.attempt, job: e.pipeline_job_id, node: e.component ?? null }, { history: "push" });
                document.getElementById("wf-dag")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
          ) : (
            <Skeleton />
          )}
        </Plate>
        <Plate
          flush
          id="wf-logs"
          title="④ Log Explorer"
          right={
            <span style={{ display: "flex", gap: 6 }}>
              <button
                className="btn sm"
                onClick={async () => {
                  const ok = await copyText(logsToText());
                  if (ok) toast.ok(t("logs.copied", { count: logs.length }));
                  else toast.err(t("logs.copyBlocked"));
                }}
              >
                <Copy />
                {tc("actions.copy")}
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  downloadText(logsToText(), `${wf.workflow_id}-logs.jsonl`, "application/x-ndjson");
                  toast.ok(t("logs.downloading", { file: `${wf.workflow_id}-logs.jsonl` }));
                }}
              >
                <Download />
                {t("logs.export")}
              </button>
            </span>
          }
        >
          <div style={{ borderBottom: "1px solid var(--rule-2)", padding: "12px 14px" }}>
            {p.ljob || p.lpath ? (
              <div className="wf-scope" role="status">
                <span className="k">{t("logs.scope")}</span>
                {p.ljob ? (
                  <span className="chip" title={p.ljob}>
                    job · {p.ljob.split(".").slice(1).join(".") || t("logs.rootJob")}
                  </span>
                ) : null}
                {p.lpath ? <span className="chip">path · {p.lpath}</span> : null}
                <button type="button" className="btn sm ghost" onClick={() => setF({ ljob: null, lpath: null })} aria-label={t("logs.clearScope")}>
                  <X />
                  {t("logs.clearScope")}
                </button>
              </div>
            ) : null}
            <div className="filters">
              <label className="field">
                <span>Severity ≥</span>
                <select className="in" value={p.sev ?? ""} onChange={(e) => setF({ sev: e.target.value || null })}>
                  <option value="">{tc("state.all")}</option>
                  {["INFO", "NOTICE", "WARNING", "ERROR"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>PipelineJob</span>
                <select className="in" value={p.ljob ?? ""} onChange={(e) => setF({ ljob: e.target.value || null, lpath: null })}>
                  <option value="">{tc("state.all")}</option>
                  {(runsQ.data?.attempts ?? [])
                    .filter((a) => !p.attempt || a.attempt === p.attempt)
                    .flatMap((a) => atts.find((x) => x.attempt === a.attempt)?.job_ids ?? [a.root.job_id])
                    .map((j) => (
                      <option key={j} value={j}>
                        {j.includes(".") ? "  › " + j.split(".").slice(1).join(" › ") : j}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Component</span>
                <select className="in" value={p.comp ?? ""} onChange={(e) => setF({ comp: e.target.value || null })}>
                  <option value="">{tc("state.all")}</option>
                  {(logQ.data?.components ?? []).concat(p.comp && !(logQ.data?.components ?? []).includes(p.comp) ? [p.comp] : []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Event</span>
                <select className="in" value={p.ev ?? ""} onChange={(e) => setF({ ev: e.target.value || null })}>
                  <option value="">{tc("state.all")}</option>
                  {[...new Set((evQ.data ?? []).map((e) => e.name).concat(p.ev ? [p.ev] : []))].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Attempt</span>
                <select className="in" value={p.attempt ?? ""} onChange={(e) => setF({ attempt: e.target.value ? +e.target.value : null })}>
                  <option value="">{tc("state.all")}</option>
                  {atts.map((a) => (
                    <option key={a.attempt} value={a.attempt}>
                      {a.attempt}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("logs.search")}</span>
                <input className="in" value={qDraft ?? p.q ?? ""} onChange={(e) => setQDraft(e.target.value)} placeholder="OOM, quota, Traceback…" />
              </label>
              <label className="field">
                <span>{t("logs.trace")}</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center", height: 31 }}>
                  <input type="checkbox" className="switch" checked={!!p.trace} onChange={(e) => setF({ trace: e.target.checked ? wf.trace_id : null })} aria-label={t("logs.traceAria")} />
                  <span className="mono muted" style={{ fontSize: 10.5 }}>
                    {wf.trace_id.slice(0, 12)}…
                  </span>
                </span>
              </label>
            </div>
            {p.sev || p.comp || p.ev || p.q || p.trace || p.ljob || p.lpath ? (
              <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => (setQDraft(null), setF({ sev: null, comp: null, ev: null, q: null, trace: null, ljob: null, lpath: null }))}>
                {t("logs.clear", { count: logQ.data?.total ?? 0 })}
              </button>
            ) : null}
          </div>
          <div className="logx" role="log" aria-label={t("logs.label")}>
            {logs.length ? (
              logs.slice(-300).map((l) => <LogRow key={l.log_id} l={l} />)
            ) : logQ.isLoading ? (
              <Skeleton />
            ) : (
              <Empty title={t("logs.empty")}>{t("logs.emptyHint")}</Empty>
            )}
          </div>
        </Plate>
      </div>

      <Plate flush title="⑤ Execution History" refText={t("history.ref")}>
        <History
          wf={wf}
          replays={attQ.data?.replays ?? []}
          onFailure={(a) => {
            setF({ attempt: a.attempt, job: a.failed_job_id, node: a.failed_component }, { history: "push" });
            document.getElementById("wf-dag")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        {attQ.data && attQ.data.replayChain.length > 1 ? (
          <div className="body" style={{ borderTop: "1px solid var(--rule-2)" }}>
            <div className="grp-t" style={{ padding: "0 0 6px" }}>
              Replay chain
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {attQ.data.replayChain.map((w, i) => (
                <span key={w.workflow_id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {i ? <span className="muted">→</span> : null}
                  <Link className={clsx("chip")} href={rh(`/workflows/${w.workflow_id}`)} aria-current={w.workflow_id === wf.workflow_id ? "page" : undefined}>
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
          {t("dlqNote.before", { status: statusLabel("dlq", dl.status, locale) })} <Link href={rh(`/dlq?sel=${dl.dead_letter_id}`)}>{dl.dead_letter_id}</Link> {t("dlqNote.after")}
        </div>
      ) : null}
    </Sheet>
  );
}
