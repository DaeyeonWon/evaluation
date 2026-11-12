/**
 * Typed fetchers for every /api/v1 endpoint. Isomorphic (works in client components; in server
 * components prefer importing the services directly — relative URLs need an origin on the server).
 *
 *   import { api } from "@/lib/client";
 *   const ov = await api.overview();
 *   await api.patchLanguageCapacity("ko", { max_concurrent: 12, reason: "유입 증가" });
 *
 * Errors: non-2xx → throws ApiClientError { status, code, message (Korean), details }.
 */
import type {
  Alert,
  AnalyticsSummary,
  AppConfig,
  AttemptHistory,
  AuditEntry,
  BatchReplayResult,
  CapacityChangeResult,
  CapacitySnapshot,
  ComponentDuration,
  ConfigPatch,
  ConfigUpdateResult,
  CostAnalytics,
  DailyMetrics,
  DeadLetter,
  DeadLetterDetail,
  DeadLetterList,
  ErrorAnalytics,
  GcsBucket,
  GcsListing,
  GcsObjectContent,
  GlobalCapacity,
  GlobalCapacityChangeResult,
  GlobalCapacityPatch,
  Incident,
  LangCode,
  LanguageCapacity,
  LanguageCapacityPatch,
  LanguageSummary,
  LogPage,
  MeInfo,
  MetaCatalog,
  Operator,
  Overview,
  Paginated,
  QualitySeries,
  Replay,
  ReplayResult,
  Reservation,
  ResultDetail,
  ResultFileMeta,
  ResultRow,
  ResultsPage,
  ResultsSummary,
  RolePermission,
  SimState,
  StageDetail,
  StageId,
  StageSummary,
  ThroughputSeries,
  TickSnapshot,
  VersionComparison,
  Workflow,
  WorkflowDag,
  WorkflowEvent,
  WorkflowListResponse,
  WorkflowSummary,
} from "@/lib/types";
import { getOperatorId } from "./operator";

/**
 * Operations API base URL. Default "/api/v1" = this app's built-in mock API (src/app/api/v1).
 * To talk to the real FastAPI Operations API instead, set at BUILD time either
 *   NEXT_PUBLIC_API_BASE=https://ops.example.com/api/v1   (browser calls it directly; needs CORS
 *                                                          for x-operator / idempotency-key headers)
 * or keep this default and set OPERATIONS_API_URL (server-side proxy, see next.config.ts).
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || "/api/v1").replace(/\/+$/, "");

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type QV = string | number | boolean | null | undefined | (string | number)[];
export type QueryParams = Record<string, QV>;

/** Build "?a=1&b=x,y" — arrays are comma-joined; null/undefined/''/[] are skipped. */
export function qs(params?: QueryParams): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = sp.toString();
  return s ? "?" + s : "";
}

export interface RequestOpts {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  /** override the acting operator id (default: the one chosen via useOperator / localStorage) */
  operator?: string;
  /** sent as Idempotency-Key (auto-generated for POST/PATCH unless false) */
  idempotencyKey?: string | false;
}

/** Low-level fetch → JSON; throws ApiClientError on non-2xx. `path` is relative to /api/v1. */
export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const op = opts.operator ?? getOperatorId();
  if (op) headers["x-operator"] = encodeURIComponent(op);
  if (method !== "GET" && opts.idempotencyKey !== false) {
    headers["idempotency-key"] =
      opts.idempotencyKey || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
  }
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? "HTTP_" + res.status, err?.message ?? `요청이 실패했습니다 (${res.status}).`, err?.details);
  }
  return data as T;
}

const enc = encodeURIComponent;
const get = <T>(path: string, params?: QueryParams, signal?: AbortSignal) => request<T>(path + qs(params), { signal });
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} });
const patch = <T>(path: string, body: unknown, params?: QueryParams) => request<T>(path + qs(params), { method: "PATCH", body });

// ───────────────────────────────────────── query param shapes ──
export interface WorkflowQuery extends QueryParams {
  q?: string;
  workflow_id?: string;
  pipeline_job_id?: string;
  language?: LangCode | LangCode[];
  status?: string | string[];
  version?: string | string[];
  stage?: StageId;
  batch_id?: string;
  event_type?: string;
  error_code?: string;
  error_category?: string;
  /** epoch ms or ISO */
  from?: number | string;
  to?: number | string;
  has_retries?: boolean;
  replay?: boolean;
  active?: boolean;
  sort?: "created_desc" | "created_asc" | "wait_desc" | "run_desc" | "updated_desc" | "attempts_desc";
  page?: number;
  pageSize?: number;
}

export interface LogQuery extends QueryParams {
  component?: string | string[];
  service?: string | string[];
  severity?: string | string[];
  min_severity?: string;
  attempt?: number;
  event_type?: string;
  trace_id?: string;
  error_code?: string;
  q?: string;
  from?: number | string;
  to?: number | string;
  order?: "asc" | "desc";
  limit?: number;
}

export interface GlobalLogQuery extends LogQuery {
  system?: boolean;
  workflow_id?: string;
  language?: LangCode;
  pipeline_job_id?: string;
}

export interface DeadLetterQuery extends QueryParams {
  status?: string | string[];
  language?: LangCode | LangCode[];
  category?: string | string[];
  error_code?: string;
  operator?: string;
  q?: string;
  from?: number | string;
  to?: number | string;
  sort?: "created_desc" | "created_asc" | "updated_desc" | "attempts_desc";
  page?: number;
  pageSize?: number;
}

export interface ResultQuery extends QueryParams {
  language?: LangCode | LangCode[];
  capsule?: string | string[];
  intent?: string | string[];
  device?: string | string[];
  version?: string | string[];
  result?: "PASS" | "FAIL";
  failure_reason?: string | string[];
  workflow_id?: string;
  batch_id?: string;
  q?: string;
  min_score?: number;
  max_score?: number;
  min_latency?: number;
  max_latency?: number;
  from?: number | string;
  to?: number | string;
  ids?: string[];
  sort?: "eval_desc" | "eval_asc" | "score_asc" | "score_desc" | "latency_desc" | "latency_asc" | "id_asc";
  page?: number;
  pageSize?: number;
}

export interface AuditQuery extends QueryParams {
  actor?: string;
  action?: string | string[];
  target?: string;
  q?: string;
  from?: number | string;
  to?: number | string;
  page?: number;
  pageSize?: number;
}

export type Range = "6h" | "12h" | "24h" | "48h" | "7d";

// ───────────────────────────────────────── endpoints ──
export const api = {
  // overview / meta
  overview: (signal?: AbortSignal) => get<Overview>("/overview", undefined, signal),
  meta: () => get<MetaCatalog>("/meta"),
  me: () => get<MeInfo>("/me"),
  operators: () => get<{ operators: Operator[]; rolePermissions: RolePermission[] }>("/operators"),

  // workflows
  workflows: (q?: WorkflowQuery, signal?: AbortSignal) => get<WorkflowListResponse>("/workflows", q, signal),
  workflow: (id: string) => get<Workflow>(`/workflows/${enc(id)}`),
  workflowEvents: (id: string) => get<WorkflowEvent[]>(`/workflows/${enc(id)}/events`),
  workflowLogs: (id: string, q?: LogQuery) => get<LogPage>(`/workflows/${enc(id)}/logs`, q),
  workflowAttempts: (id: string) => get<AttemptHistory>(`/workflows/${enc(id)}/attempts`),
  workflowDag: (id: string) => get<WorkflowDag>(`/workflows/${enc(id)}/dag`),
  workflowResults: (id: string) => get<{ rows: ResultRow[]; summary: ResultsSummary | null }>(`/workflows/${enc(id)}/results`),
  cancelWorkflow: (id: string, body: { reason?: string } = {}) => post<WorkflowSummary>(`/workflows/${enc(id)}/cancel`, body),

  // capacity
  capacity: () => get<CapacitySnapshot>("/languages/capacity"),
  languageCapacity: (lang: LangCode) => get<LanguageCapacity>(`/languages/${lang}/capacity`),
  patchLanguageCapacity: (lang: LangCode, body: LanguageCapacityPatch, opts?: { dryRun?: boolean }) =>
    patch<CapacityChangeResult>(`/languages/${lang}/capacity`, body, opts?.dryRun ? { dry_run: 1 } : undefined),
  /** shortcut: pause/resume a language */
  setLanguagePaused: (lang: LangCode, paused: boolean, reason: string) =>
    patch<CapacityChangeResult>(`/languages/${lang}/capacity`, { paused, reason }),
  globalCapacity: () => get<GlobalCapacity>("/capacity/global"),
  patchGlobalCapacity: (body: GlobalCapacityPatch, opts?: { dryRun?: boolean }) =>
    patch<GlobalCapacityChangeResult>("/capacity/global", body, opts?.dryRun ? { dry_run: 1 } : undefined),
  reservations: (q?: { status?: string | string[]; language?: LangCode }) => get<Reservation[]>("/reservations", q),

  // DLQ / replay
  deadLetters: (q?: DeadLetterQuery) => get<DeadLetterList>("/dead-letters", q),
  deadLetter: (id: string) => get<DeadLetterDetail>(`/dead-letters/${enc(id)}`),
  replayDeadLetter: (id: string, body: { reason: string; pipeline_version?: string; priority?: number }) =>
    post<ReplayResult>(`/dead-letters/${enc(id)}/replay`, body),
  replayBatch: (body: { ids: string[]; reason: string; pipeline_version?: string }) => post<BatchReplayResult>("/dead-letters/replay-batch", body),
  closeDeadLetter: (id: string, body: { resolution: string }) => post<DeadLetter>(`/dead-letters/${enc(id)}/close`, body),
  assignDeadLetter: (id: string, body: { operator_id: string | null; reason?: string }) => post<DeadLetter>(`/dead-letters/${enc(id)}/assign`, body),
  replays: (q?: { dead_letter_id?: string; status?: string | string[] }) => get<Replay[]>("/replays", q),

  // analytics
  throughput: (q?: { granularity?: "hour" | "5m"; range?: Range }) => get<ThroughputSeries>("/analytics/throughput", q),
  quality: (q?: { range?: Range }) => get<QualitySeries>("/analytics/quality", q),
  errors: (q?: { range?: Range; top?: number }) => get<ErrorAnalytics>("/analytics/errors", q),
  components: () => get<ComponentDuration[]>("/analytics/components"),
  versions: () => get<VersionComparison[]>("/analytics/versions"),
  languages: () => get<LanguageSummary[]>("/analytics/languages"),
  cost: () => get<CostAnalytics>("/analytics/cost"),
  daily: () => get<DailyMetrics[]>("/analytics/daily"),
  analyticsSummary: () => get<AnalyticsSummary>("/analytics/summary"),

  // stages / gcs
  stages: () => get<StageSummary[]>("/stages"),
  stage: (id: StageId, q?: { limit?: number }) => get<StageDetail>(`/stages/${id}`, q),
  buckets: () => get<GcsBucket[]>("/gcs/buckets"),
  gcsObjects: (q: { bucket: string; prefix?: string; delimiter?: string; limit?: number }) => get<GcsListing>("/gcs/objects", q),
  gcsObject: (q: { bucket: string; name: string; limit?: number }) => get<GcsObjectContent>("/gcs/object", q),

  // results
  results: (q?: ResultQuery, signal?: AbortSignal) => get<ResultsPage>("/results", q, signal),
  result: (utteranceId: string) => get<ResultDetail>(`/results/${enc(utteranceId)}`),
  resultFile: () => get<ResultFileMeta>("/results/file"),

  // config / audit / alerts
  config: () => get<AppConfig>("/config"),
  patchConfig: (body: ConfigPatch & { reason: string }) => patch<ConfigUpdateResult>("/config", body),
  audit: (q?: AuditQuery) => get<Paginated<AuditEntry>>("/audit", q),
  alerts: (q?: { status?: string | string[]; severity?: string | string[]; language?: LangCode }) => get<Alert[]>("/alerts", q),
  ackAlert: (id: string, body: { note?: string } = {}) => post<Alert>(`/alerts/${enc(id)}/ack`, body),
  resolveAlert: (id: string, body: { note?: string } = {}) => post<Alert>(`/alerts/${enc(id)}/resolve`, body),
  incidents: () => get<Incident[]>("/incidents"),

  // global event / log feeds
  events: (q?: { limit?: number; stage?: StageId; language?: LangCode; severity?: string | string[]; name?: string | string[] }) =>
    get<WorkflowEvent[]>("/events", q),
  logs: (q?: GlobalLogQuery) => get<LogPage>("/logs", q),

  // simulator
  sim: () => get<{ sim: SimState; snapshot: TickSnapshot }>("/sim"),
  simPause: () => post<{ sim: SimState }>("/sim", { action: "pause" }),
  simResume: () => post<{ sim: SimState }>("/sim", { action: "resume" }),
  simSpeed: (speed: number) => post<{ sim: SimState }>("/sim", { action: "speed", speed }),
  simStep: (steps = 1) => post<{ sim: SimState; snapshot: TickSnapshot }>("/sim", { action: "step", steps }),
  simInject: (language?: LangCode) => post<{ sim: SimState; workflow: WorkflowSummary }>("/sim", { action: "inject", language }),
};

export type Api = typeof api;
