import type { NextRequest } from "next/server";
import * as C from "@/lib/catalog";
import { RANGE_PRESETS, isoKst } from "@/lib/time-range";
import type {
  Alert,
  AlertStatus,
  AuditEntry,
  GcsBucket,
  GcsListing,
  GcsObject,
  GcsObjectContent,
  Incident,
  LangCode,
  MetaCatalog,
  Paginated,
  RangedList,
  Replay,
  Reservation,
  ResolvedRange,
  StageDetail,
  StageId,
  StageSummary,
  Workflow,
  WorkflowEvent,
  WorkflowStatus,
} from "@/lib/types";
import { Query, badRequest, conflict, notFound, paginate } from "../http";
import { getEngine } from "../mock/runtime";
import { avg, countBy, pctl, round4, toSummary } from "../mock/projections";
import { rangedList, readRange } from "../range";
import { searchRecords } from "./files";
import { definitions, jobsInRange } from "./pipelines";
import { SEVERITIES } from "./workflows";

export function meta(): MetaCatalog {
  const e = getEngine();
  const w = e.dataWindow();
  return {
    baseNow: e.meta.baseNow,
    timezone: C.TIMEZONE,
    project: C.PROJECT_ID,
    region: C.REGION,
    languages: C.LANGUAGES,
    stages: C.STAGES,
    stageEdges: C.STAGE_EDGES,
    stateToStage: C.STATE_TO_STAGE,
    states: C.STATES,
    activeStates: C.ACTIVE_STATES,
    terminalStates: C.TERMINAL_STATES,
    dagTemplate: C.DAG_TEMPLATE,
    statusMeta: C.STATUS_META,
    nodeStatusMeta: C.NODE_STATUS_META,
    attemptStatusMeta: C.ATTEMPT_STATUS_META,
    dlqStatusMeta: C.DLQ_STATUS_META,
    severityMeta: C.SEVERITY_META,
    failureCategoryMeta: C.FAILURE_CATEGORY_META,
    failureReasonMeta: C.FAILURE_REASON_META,
    eventCatalog: C.EVENT_CATALOG,
    capsules: C.CAPSULES,
    devices: C.DEVICES,
    resultColumns: C.RESULT_COLUMNS,
    operators: C.OPERATORS,
    dataWindow: { earliest: w.earliest, now: w.now, earliestIso: isoKst(w.earliest), nowIso: isoKst(w.now), historyDays: w.historyDays },
    rangePresets: RANGE_PRESETS,
    pipelines: definitions(),
    models: C.MODELS,
    components: C.COMPONENTS,
  };
}

// ───────────────────────────────────────── stages ──
function inR(r: ResolvedRange, t: number | null | undefined) {
  return t != null && t >= r.from && t <= r.to;
}
const TERMINAL = C.TERMINAL_STATES;
/** Workflows "in" a stage for a range: active ones always; terminal ones when updated in range; no-state stages → originals created in range. */
export function stageWorkflows(stageId: StageId, r: ResolvedRange): Workflow[] {
  const e = getEngine();
  const st = C.STAGE_BY_ID[stageId];
  const now = e.now();
  const ws = st.states.length
    ? e.workflows.filter((w) => st.states.includes(w.status) && (!TERMINAL.includes(w.status) || inR(r, w.updated_at)) && w.created_at <= now)
    : e.workflows.filter((w) => !w.replay_of && inR(r, w.created_at));
  return ws.sort((a, b) => b.updated_at - a.updated_at);
}

export function stages(req: NextRequest): RangedList<StageSummary> {
  const range = readRange(req);
  const items = C.STAGES.map((s) => {
    const ws = stageWorkflows(s.id, range);
    return {
      stage: s,
      count: ws.length,
      counts: countBy(ws, (w) => w.status) as Partial<Record<WorkflowStatus, number>>,
      byLanguage: countBy(ws, (w) => w.language) as Partial<Record<LangCode, number>>,
    };
  });
  return rangedList(items, range);
}

const STAGE_LOG_FILTER: Record<StageId, (l: { event_type: string | null; service: string }) => boolean> = {
  gcs_input: (l) => l.event_type === "EVENT_RECEIVED",
  event_bus: (l) => l.event_type === "EVENT_RECEIVED",
  ingress: (l) => l.service === "event-ingress",
  registry_queue: (l) => l.event_type === "QUEUED",
  scheduler: (l) => (l.service === "scheduler" && l.event_type !== "QUEUED") || l.service === "reconciler",
  workflows: (l) => (l.service === "dispatcher" || l.service === "pipeline-orchestrator" || l.event_type === "CANCEL_REQUESTED") && !/^RETRY/.test(l.event_type || ""),
  vertex: (l) => l.service === "vertex-ai-pipelines",
  results: (l) => l.service === "result-commit",
  retry: (l) => /^RETRY/.test(l.event_type || ""),
  dlq: (l) => l.service === "dlq-manager" || /DEAD_LETTER|REPLAY/.test(l.event_type || ""),
};

function sum(a: number[]) {
  return a.reduce((s, x) => s + x, 0);
}

export function stageDetail(id: string, req: NextRequest): StageDetail {
  const e = getEngine();
  if (!C.STAGE_BY_ID[id as StageId]) throw notFound(`알 수 없는 단계입니다: ${id}`);
  const stageId = id as StageId;
  const st = C.STAGE_BY_ID[stageId];
  const q = Query.of(req);
  const lim = q.int("limit", { min: 1, max: 500, def: 60 })!;
  const objLimit = q.int("objects_limit", { min: 1, max: 1000, def: 100 })!;
  const text = q.str("q") ?? "";
  const range = readRange(req);
  const now = e.now();
  const wfs = stageWorkflows(stageId, range);
  const evs = e.events.recent(lim, { stage: stageId, from: range.from, to: range.to });
  const logs = [];
  const all = e.logs.all;
  for (let i = all.length - 1; i >= 0 && logs.length < lim; i--) {
    const l = all[i];
    if (l.ts > now || l.ts > range.to) continue;
    if (l.ts < range.from) break;
    if (STAGE_LOG_FILTER[stageId](l)) logs.push(l);
  }
  // stage-relevant objects for the workflows in this stage (plus shared objects for vertex/results)
  const ids = new Set(wfs.map((w) => w.workflow_id));
  const hits = searchRecords({ q: text, range: st.states.length && !TERMINAL.some((s) => st.states.includes(s)) ? { ...range, from: 0 } : range, stage: [stageId] }).filter(
    (h) => (h.workflow_id ? ids.has(h.workflow_id) : stageId === "vertex" || stageId === "results"),
  );
  const objects = hits.slice(0, objLimit);
  const gcsObjects: GcsObject[] = [];
  const seen = new Set<string>();
  for (const h of objects) {
    const k = h.bucket + "/" + h.object;
    if (seen.has(k)) continue;
    seen.add(k);
    const o = e.gcs.get(h.bucket, h.object);
    if (o) gcsObjects.push(o);
  }
  const created = e.workflows.filter((w) => inR(range, w.created_at));
  const cap = e.getCapacity();
  let m: Record<string, unknown>;
  switch (stageId) {
    case "gcs_input": {
      const objs = e.gcs.objects[e.config.buckets.input].filter((o) => inR(range, o.timeCreated) && o.timeCreated <= now);
      m = { objectsToday: objs.length, bytesToday: sum(objs.map((o) => o.size)), utterancesToday: sum(objs.map((o) => +o.metadata.utterance_count || 0)), lastUploadAt: objs.length ? objs[objs.length - 1].timeCreated : null, byLanguage: countBy(objs, (o) => o.metadata.language) };
      break;
    }
    case "event_bus":
      m = { deliveredToday: created.length, avgDeliveryLatencyMs: 420, p95DeliveryLatencyMs: 1150, redeliveriesToday: Math.round(created.length / 40), subscriptionBacklog: e.workflows.filter((w) => w.status === "RECEIVED").length, deadLetterTopicMessages: 0 };
      break;
    case "ingress":
      m = { receivedToday: created.length, validatedToday: created.filter((w) => w.validated_at).length, duplicatesIgnoredToday: Math.round(created.length / 30), validationErrorsToday: 0, p95RegistrationLatencyMs: 1380, inFlight: wfs.length };
      break;
    case "registry_queue":
      m = { queued: cap.global.backlog, byLanguage: Object.fromEntries(cap.languages.map((l) => [l.code, l.backlog])), oldestQueuedAt: Math.min(...cap.languages.map((l) => l.oldestQueuedAt ?? Infinity)), p95WaitSec: Math.max(...cap.languages.map((l) => l.p95WaitSec)), enqueuedInRange: e.workflows.filter((w) => inR(range, w.queued_at)).length };
      break;
    case "scheduler":
      m = { activeSlots: cap.global.active, globalMax: cap.global.max, reservationsActive: cap.reservationsActive, reservationsOrphaned: cap.reservationsOrphaned, admissionsLastHour: e.workflows.filter((w) => w.reserved_at != null && w.reserved_at > now - 3_600_000).length, admissionsInRange: e.workflows.filter((w) => inR(range, w.reserved_at)).length, saturatedLanguages: cap.languages.filter((l) => l.status === "SATURATED").map((l) => l.code) };
      break;
    case "workflows":
      m = { dispatching: e.workflows.filter((w) => w.status === "DISPATCHING").length, executionsToday: sum(e.workflows.map((w) => w.attempts.filter((a) => inR(range, a.created_at)).length)), cancelledToday: e.workflows.filter((w) => w.status === "CANCELLED" && inR(range, w.completed_at)).length, timedOut7d: e.workflows.filter((w) => w.status === "TIMED_OUT" && inR(range, w.completed_at)).length, p95StartLatencyMs: 4100 };
      break;
    case "vertex": {
      const running = e.workflows.filter((w) => w.status === "RUNNING");
      const legacy: Record<string, number> = Object.fromEntries(C.DAG_TEMPLATE.map((d) => [d.id, 0]));
      for (const w of running) for (const n of w.dag) if (n.status === "RUNNING") legacy[n.id]++;
      const jobs = jobsInRange(range);
      const byPipeline: Record<string, { kind: string; runs: number; running: number; succeeded: number; failed: number; successRate: number | null; avgDurationSec: number; runningByNode: Record<string, number> }> = {};
      const runningByComponent: Record<string, number> = { ...legacy };
      const leafRunning: Record<string, number> = {};
      let gpu = 0;
      for (const { job } of jobs) {
        const def = definitions().find((d) => d.id === job.pipeline_id);
        const b = (byPipeline[job.pipeline_id] ||= { kind: def?.kind ?? "root", runs: 0, running: 0, succeeded: 0, failed: 0, successRate: null, avgDurationSec: 0, runningByNode: {} });
        b.runs++;
        if (job.status === "RUNNING") b.running++;
        if (job.status === "SUCCEEDED") b.succeeded++;
        if (job.status === "FAILED") b.failed++;
        for (const n of job.nodes)
          if (n.status === "RUNNING") {
            b.runningByNode[n.id] = (b.runningByNode[n.id] || 0) + 1;
            if (n.component) {
              leafRunning[n.component] = (leafRunning[n.component] || 0) + 1;
              if (n.resources.gpu) gpu += n.resources.gpu.count;
            }
          }
      }
      const durs: Record<string, number[]> = {};
      for (const { job } of jobs) if (job.status === "SUCCEEDED" && job.duration_ms != null) (durs[job.pipeline_id] ||= []).push(job.duration_ms);
      for (const [pid, b] of Object.entries(byPipeline)) {
        b.successRate = b.succeeded + b.failed ? round4(b.succeeded / (b.succeeded + b.failed)) : null;
        b.avgDurationSec = Math.round(avg(durs[pid] ?? []) / 1000);
      }
      const rootDurs = jobs.filter((j) => j.job.depth === 0 && j.job.status === "SUCCEEDED").map((j) => j.job.duration_ms ?? 0);
      m = {
        running: running.length,
        runningByComponent,
        runningByLeaf: leafRunning,
        byPipeline,
        runningChildJobs: jobs.filter((j) => j.job.depth > 0 && j.job.status === "RUNNING").length,
        utterancesInFlight: sum(running.map((w) => w.input.utteranceCount)),
        gpuInUse: gpu,
        gpuQuota: 16,
        avgDurationSec: Math.round(avg(rootDurs) / 1000),
        p95DurationSec: Math.round(pctl(rootDurs, 0.95) / 1000),
      };
      break;
    }
    case "results": {
      const sr = e.workflows.filter((w) => w.status === "SUCCEEDED" && inR(range, w.completed_at));
      const rows = sum(sr.map((w) => w.result?.rows ?? 0));
      const pass = sum(sr.map((w) => w.result?.passCount ?? 0));
      m = { succeededToday: sr.length, rowsWrittenToday: rows, csvBytesToday: sum(sr.map((w) => w.result?.sizeBytes ?? 0)), bqTable: e.config.bigquery.resultsTable, passRateToday: rows ? round4(pass / rows) : null, aggregateFile: e.results.file.uri, byPipeline: countBy(sr, (w) => w.pipeline_id), byModelVersion: countBy(sr, (w) => w.model_version) };
      break;
    }
    case "retry":
      m = { retryWait: e.workflows.filter((w) => w.status === "RETRY_WAIT").length, retriesToday: sum(created.map((w) => Math.max(0, w.attempts.length - 1))), retryRate: created.length ? round4(created.filter((w) => w.attempts.length > 1).length / created.length) : 0, nextRetryAt: wfs.filter((w) => w.status === "RETRY_WAIT").length ? Math.min(...wfs.filter((w) => w.retry_at != null).map((w) => w.retry_at!)) : null, policy: e.config.retry };
      break;
    default: {
      const inRangeDl = e.dlq.filter((d) => inR(range, d.created_at));
      m = { pendingReview: e.dlq.filter((d) => d.status === "PENDING_REVIEW").length, total: e.dlq.length, createdInRange: inRangeDl.length, byStatus: countBy(inRangeDl, (d) => d.status), byCategory: countBy(inRangeDl, (d) => d.failure_category), byPath: countBy(inRangeDl, (d) => d.failed_path), replays: e.replays.filter((r) => inR(range, r.created_at)).length };
    }
  }
  return {
    stage: st,
    workflows: wfs.map(toSummary),
    counts: countBy(wfs, (w) => w.status) as Partial<Record<WorkflowStatus, number>>,
    gcsObjects,
    events: evs,
    logs,
    metrics: m,
    objects,
    range,
  };
}

// ───────────────────────────────────────── GCS ──
export function buckets(): GcsBucket[] {
  return getEngine().gcs.buckets.map((b) => ({ ...b }));
}

function bucketOr404(name: string | undefined): string {
  const e = getEngine();
  if (!name) throw badRequest("bucket 파라미터가 필요합니다.", { allowed: e.gcs.buckets.map((b) => b.name) });
  if (!e.gcs.buckets.some((b) => b.name === name)) throw notFound(`버킷을 찾을 수 없습니다: ${name}`);
  return name;
}

/** GET /gcs/objects — listing filtered to objects created within the range (`range=all` disables). */
export function gcsList(req: NextRequest): GcsListing & { range: ResolvedRange | null } {
  const e = getEngine();
  const q = Query.of(req);
  const bucket = bucketOr404(q.str("bucket"));
  const sp = req.nextUrl.searchParams;
  const delimiter = sp.has("delimiter") ? (sp.get("delimiter") ?? "") : undefined;
  const limit = q.int("limit", { min: 1, max: 5000 });
  const prefix = q.str("prefix") ?? "";
  const all = sp.get("range") === "all";
  const range = all ? null : readRange(req);
  const text = q.str("q")?.toLowerCase();
  const base = e.gcs.list(bucket, prefix, { delimiter: "" });
  const objs = base.objects.filter((o) => (!range || (o.timeCreated >= range.from && o.timeCreated <= range.to)) && (!text || o.name.toLowerCase().includes(text)));
  const delim = delimiter === undefined ? "/" : delimiter;
  const pre: Record<string, number> = {};
  const out: GcsObject[] = [];
  for (const o of objs) {
    const rest = o.name.slice(prefix.length);
    const k = delim ? rest.indexOf(delim) : -1;
    if (k >= 0) {
      const p = prefix + rest.slice(0, k + 1);
      pre[p] = (pre[p] || 0) + 1;
    } else out.push(o);
  }
  out.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { bucket, prefix, prefixes: Object.keys(pre).sort(), prefixCounts: pre, objects: limit ? out.slice(0, limit) : out, range };
}

export function gcsObject(req: NextRequest): GcsObjectContent {
  const e = getEngine();
  const q = Query.of(req);
  const bucket = bucketOr404(q.str("bucket"));
  const name = q.str("name");
  if (!name) throw badRequest("name 파라미터가 필요합니다.");
  const o = e.gcs.get(bucket, name);
  if (!o || o.timeCreated > e.now()) throw notFound(`객체를 찾을 수 없습니다: gs://${bucket}/${name}`);
  const limit = q.int("limit", { min: 1, max: 500, def: 20 });
  return { object: o, content: e.gcs.read(bucket, name, { limit }) };
}

// ───────────────────────────────────────── events ──
export function recentEvents(req: NextRequest): RangedList<WorkflowEvent> {
  const e = getEngine();
  const q = Query.of(req);
  const range = readRange(req);
  const limit = q.int("limit", { min: 1, max: 5000, def: 50 })!;
  const items = e.events.recent(limit, {
    stage: q.str("stage"),
    language: q.str("language"),
    severity: q.enumList("severity", SEVERITIES),
    names: q.list("name"),
    workflow_id: q.str("workflow_id"),
    pipeline_id: q.str("pipeline_id"),
    component: q.str("component"),
    pipeline_job_id: q.str("pipeline_job_id"),
    job_scope: q.enumOne("job_scope", ["self", "tree"] as const, "tree"),
    from: range.from,
    to: range.to,
  });
  return rangedList(items, range);
}

// ───────────────────────────────────────── audit ──
export function auditPage(req: NextRequest): Paginated<AuditEntry> & { range: ResolvedRange } {
  const e = getEngine();
  const q = Query.of(req);
  const actor = q.str("actor");
  const actions = q.list("action");
  const target = q.str("target");
  const text = q.str("q")?.toLowerCase();
  const range = readRange(req);
  const rows = e.audit.filter((a) => {
    if (actor && a.actor !== actor && a.actorName !== actor) return false;
    if (actions && !actions.includes(a.action)) return false;
    if (target && !a.target.includes(target)) return false;
    if (a.ts < range.from || a.ts > range.to) return false;
    if (text && !(a.action + " " + a.target + " " + (a.reason ?? "") + " " + a.actorName).toLowerCase().includes(text)) return false;
    return true;
  });
  const { page, pageSize } = q.page(50, 500);
  return { ...paginate(rows, page, pageSize), range };
}

// ───────────────────────────────────────── alerts / incidents ──
export function alerts(req: NextRequest): RangedList<Alert> & { openOutsideRange: number } {
  const e = getEngine();
  const q = Query.of(req);
  const range = readRange(req);
  const st = q.enumList("status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as AlertStatus[]);
  const sev = q.list("severity");
  const lang = q.str("language");
  const base = e.alerts.filter((a) => (!st || st.includes(a.status)) && (!sev || sev.includes(a.severity)) && (!lang || a.language === lang));
  const items = base.filter((a) => a.opened_at >= range.from && a.opened_at <= range.to);
  return { ...rangedList(items, range), openOutsideRange: base.filter((a) => a.status !== "RESOLVED" && (a.opened_at < range.from || a.opened_at > range.to)).length };
}

export function incidents(req: NextRequest): RangedList<Incident> {
  const range = readRange(req);
  return rangedList(
    getEngine().incidents.filter((i) => i.started_at <= range.to && (i.resolved_at ?? Number.POSITIVE_INFINITY) >= range.from),
    range,
  );
}

export function replays(req: NextRequest): RangedList<Replay> {
  const q = Query.of(req);
  const range = readRange(req);
  const dl = q.str("dead_letter_id");
  const st = q.list("status");
  const rows = getEngine().replays.filter((r) => (!dl || r.dead_letter_id === dl) && (!st || st.includes(r.status)) && r.created_at >= range.from && r.created_at <= range.to);
  return rangedList([...rows].sort((a, b) => b.created_at - a.created_at), range);
}

export function ackAlert(id: string, operatorId: string, note: string | null): Alert {
  const e = getEngine();
  const a = e.alerts.find((x) => x.alert_id === id);
  if (!a) throw notFound(`알림을 찾을 수 없습니다: ${id}`);
  if (a.status === "RESOLVED") throw conflict(`이미 해소된 알림입니다: ${id}`);
  if (a.status === "ACKNOWLEDGED") throw conflict(`이미 확인 처리된 알림입니다: ${id}`);
  e.actions.acknowledgeAlert(id, operatorId);
  e._internal.pushAudit(e._internal.audit(e.now(), operatorId, "ALERT_ACKNOWLEDGED", "alert:" + id, { status: "OPEN" }, { status: "ACKNOWLEDGED" }, note));
  return a;
}

export function resolveAlert(id: string, operatorId: string, note: string | null): Alert {
  const e = getEngine();
  const a = e.alerts.find((x) => x.alert_id === id);
  if (!a) throw notFound(`알림을 찾을 수 없습니다: ${id}`);
  if (a.status === "RESOLVED") throw conflict(`이미 해소된 알림입니다: ${id}`);
  const before = a.status;
  e.actions.resolveAlert(id);
  e._internal.pushAudit(e._internal.audit(e.now(), operatorId, "ALERT_RESOLVED", "alert:" + id, { status: before }, { status: "RESOLVED" }, note));
  return a;
}

// ───────────────────────────────────────── reservations ──
export function reservations(req: NextRequest): Reservation[] {
  const e = getEngine();
  const q = Query.of(req);
  const st = q.list("status");
  const lang = q.str("language");
  return e.reservations.filter((r) => (!st || st.includes(r.status)) && (!lang || r.language === lang)).slice().reverse();
}
