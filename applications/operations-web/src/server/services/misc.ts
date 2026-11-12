import type { NextRequest } from "next/server";
import * as C from "@/lib/catalog";
import type {
  Alert,
  AlertStatus,
  AuditEntry,
  GcsBucket,
  GcsListing,
  GcsObjectContent,
  LangCode,
  MetaCatalog,
  Paginated,
  Reservation,
  StageDetail,
  StageId,
  StageSummary,
  WorkflowEvent,
  WorkflowStatus,
} from "@/lib/types";
import { Query, badRequest, conflict, notFound, paginate } from "../http";
import { getEngine } from "../mock/runtime";
import { countBy, toSummary } from "../mock/projections";
import { SEVERITIES } from "./workflows";

export function meta(): MetaCatalog {
  return {
    baseNow: C.BASE_NOW,
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
  };
}

// ───────────────────────────────────────── stages ──
export function stages(): StageSummary[] {
  const e = getEngine();
  const by = e.workflowsByStage();
  return C.STAGES.map((s) => {
    const ws = by[s.id] ?? [];
    return {
      stage: s,
      count: ws.length,
      counts: countBy(ws, (w) => w.status) as Partial<Record<WorkflowStatus, number>>,
      byLanguage: countBy(ws, (w) => w.language) as Partial<Record<LangCode, number>>,
    };
  });
}

export function stageDetail(id: string, req: NextRequest): StageDetail {
  const e = getEngine();
  if (!C.STAGE_BY_ID[id as StageId]) throw notFound(`알 수 없는 단계입니다: ${id}`);
  const limit = Query.of(req).int("limit", { min: 1, max: 500, def: 60 });
  const d = e.stageDetail(id, { limit })!;
  return { ...d, workflows: d.workflows.map(toSummary) };
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

export function gcsList(req: NextRequest): GcsListing {
  const e = getEngine();
  const q = Query.of(req);
  const bucket = bucketOr404(q.str("bucket"));
  const delimiter = q.has("delimiter") ? q.str("delimiter") : req.nextUrl.searchParams.get("delimiter") === "" ? "" : undefined;
  const limit = q.int("limit", { min: 1, max: 5000 });
  return e.gcs.list(bucket, q.str("prefix") ?? "", { delimiter, limit });
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
export function recentEvents(req: NextRequest): WorkflowEvent[] {
  const e = getEngine();
  const q = Query.of(req);
  const limit = q.int("limit", { min: 1, max: 1000, def: 50 })!;
  return e.events.recent(limit, {
    stage: q.str("stage"),
    language: q.str("language"),
    severity: q.enumList("severity", SEVERITIES),
    names: q.list("name"),
  });
}

// ───────────────────────────────────────── audit ──
export function auditPage(req: NextRequest): Paginated<AuditEntry> {
  const e = getEngine();
  const q = Query.of(req);
  const actor = q.str("actor");
  const actions = q.list("action");
  const target = q.str("target");
  const text = q.str("q")?.toLowerCase();
  const from = q.time("from");
  const to = q.time("to");
  const rows = e.audit.filter((a) => {
    if (actor && a.actor !== actor && a.actorName !== actor) return false;
    if (actions && !actions.includes(a.action)) return false;
    if (target && !a.target.includes(target)) return false;
    if (from != null && a.ts < from) return false;
    if (to != null && a.ts > to) return false;
    if (text && !(a.action + " " + a.target + " " + (a.reason ?? "") + " " + a.actorName).toLowerCase().includes(text)) return false;
    return true;
  });
  const { page, pageSize } = q.page(50, 500);
  return paginate(rows, page, pageSize);
}

// ───────────────────────────────────────── alerts ──
export function alerts(req: NextRequest): Alert[] {
  const e = getEngine();
  const q = Query.of(req);
  const st = q.enumList("status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as AlertStatus[]);
  const sev = q.list("severity");
  const lang = q.str("language");
  return e.alerts.filter((a) => (!st || st.includes(a.status)) && (!sev || sev.includes(a.severity)) && (!lang || a.language === lang));
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
