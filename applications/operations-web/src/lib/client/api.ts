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
  CapacityHistory,
  FileSearchResult,
  PipelineDefinition,
  PipelineDetail,
  PipelineJobDetail,
  PipelineRunsPage,
  PipelineSummary,
  RangedList,
  ResolvedRange,
  WorkflowPipelineRuns,
} from "@/lib/types";
import { serializeRange } from "@/lib/time-range";
import type { RangeSpec } from "@/lib/time-range";
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

/**
 * Build "?a=1&b=x,y" — arrays are comma-joined; null/undefined/''/[] are skipped,
 * EXCEPT keys listed in `opts.keepEmpty` (e.g. GCS `delimiter=""` = flat listing).
 */
export function qs(params?: QueryParams, opts: { keepEmpty?: string[] } = {}): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === "" && opts.keepEmpty?.includes(k)) {
      sp.set(k, "");
      continue;
    }
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
const items = <T>(p: Promise<RangedList<T>>) => p.then((r) => r.items);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} });
const patch = <T>(path: string, body: unknown, params?: QueryParams) => request<T>(path + qs(params), { method: "PATCH", body });

// ───────────────────────────────────────── query param shapes ──
/**
 * Time-range params accepted by every ranged endpoint (see src/lib/time-range.ts).
 * `range` = today (default) | yesterday | 1h | 6h | 24h | 7d | 30d | <N>h | <N>d; or custom from/to.
 */
export interface RangeQuery extends QueryParams {
  range?: string;
  /** epoch ms or ISO-8601 (prefer `Z`; `+09:00` must be URL-encoded — qs() does that) */
  from?: number | string;
  to?: number | string;
}
/** RangeSpec → RangeQuery (spread into any query): `{ ...rangeParams(spec), language: "ko" }` */
export function rangeParams(spec: RangeSpec): RangeQuery {
  return serializeRange(spec);
}

export interface WorkflowQuery extends QueryParams {
  q?: string;
  workflow_id?: string;
  pipeline_job_id?: string;
  language?: LangCode | LangCode[];
  status?: string | string[];
  version?: string | string[];
  pipeline_id?: string | string[];
  model_version?: string | string[];
  stage?: StageId;
  batch_id?: string;
  event_type?: string;
  range?: string;
  /** which timestamp the range applies to: lifetime overlap (default) | created_at | updated_at */
  range_by?: "active" | "created" | "updated";
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
  /** job id — matches the job and (job_scope=tree, default) its child jobs */
  pipeline_job_id?: string;
  job_scope?: "self" | "tree";
  pipeline_id?: string;
  node_path?: string;
  range?: string;
}

export interface DeadLetterQuery extends QueryParams {
  status?: string | string[];
  language?: LangCode | LangCode[];
  category?: string | string[];
  error_code?: string;
  operator?: string;
  pipeline_id?: string | string[];
  q?: string;
  range?: string;
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
  /** model under test, e.g. bixby-nlu-2026.10 (alias `model`) */
  model_version?: string | string[];
  pipeline_id?: string | string[];
  range?: string;
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
  range?: string;
  from?: number | string;
  to?: number | string;
  page?: number;
  pageSize?: number;
}

/** Legacy analytics range values; any RangePreset / "<N>h" / "<N>d" is accepted now. */
export type Range = "today" | "yesterday" | "1h" | "6h" | "12h" | "24h" | "48h" | "7d" | "30d" | (string & {});

export interface EventQuery extends RangeQuery {
  limit?: number;
  stage?: StageId;
  language?: LangCode;
  severity?: string | string[];
  name?: string | string[];
  workflow_id?: string;
  pipeline_id?: string;
  component?: string;
  pipeline_job_id?: string;
  job_scope?: "self" | "tree";
}
export interface AlertQuery extends RangeQuery {
  status?: string | string[];
  severity?: string | string[];
  language?: LangCode;
}
export interface PipelineRunsQuery extends RangeQuery {
  status?: string | string[];
  version?: string | string[];
  language?: LangCode | LangCode[];
  workflow_id?: string;
  sort?: "start_desc" | "start_asc" | "duration_desc";
  page?: number;
  pageSize?: number;
}
export interface FileSearchQuery extends RangeQuery {
  q?: string;
  stage?: StageId | StageId[];
  bucket?: string;
  language?: LangCode | LangCode[];
  limit?: number;
}
export interface StageQuery extends RangeQuery {
  limit?: number;
  /** filter `objects` by name (also workflow_id / batch_id) */
  q?: string;
  objects_limit?: number;
}

export type PipelineListItem = PipelineSummary & { definition: PipelineDefinition };

// ───────────────────────────────────────── endpoints ──
export const api = {
  // overview / meta
  overview: (q?: RangeQuery | AbortSignal, signal?: AbortSignal) =>
    q instanceof AbortSignal ? get<Overview>("/overview", undefined, q) : get<Overview>("/overview", q, signal),
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
  /** @deprecated unwraps the envelope — prefer replaysPage (carries `range`) */
  replays: (q?: { dead_letter_id?: string; status?: string | string[] } & RangeQuery) => items(get<RangedList<Replay>>("/replays", q)),
  replaysPage: (q?: { dead_letter_id?: string; status?: string | string[] } & RangeQuery) => get<RangedList<Replay>>("/replays", q),

  // analytics
  throughput: (q?: { granularity?: "auto" | "hour" | "5m"; range?: Range } & RangeQuery) => get<ThroughputSeries>("/analytics/throughput", q),
  quality: (q?: { range?: Range } & RangeQuery) => get<QualitySeries>("/analytics/quality", q),
  errors: (q?: { range?: Range; top?: number } & RangeQuery) => get<ErrorAnalytics>("/analytics/errors", q),
  /** @deprecated unwraps — prefer componentsPage */
  components: (q?: RangeQuery) => items(get<RangedList<ComponentDuration>>("/analytics/components", q)),
  componentsPage: (q?: RangeQuery) => get<RangedList<ComponentDuration>>("/analytics/components", q),
  /** @deprecated unwraps — prefer versionsPage */
  versions: (q?: RangeQuery) => items(get<RangedList<VersionComparison>>("/analytics/versions", q)),
  versionsPage: (q?: RangeQuery) => get<RangedList<VersionComparison>>("/analytics/versions", q),
  /** @deprecated unwraps — prefer languagesPage */
  languages: (q?: RangeQuery) => items(get<RangedList<LanguageSummary>>("/analytics/languages", q)),
  languagesPage: (q?: RangeQuery) => get<RangedList<LanguageSummary>>("/analytics/languages", q),
  cost: (q?: RangeQuery) => get<CostAnalytics>("/analytics/cost", q),
  /** @deprecated unwraps — prefer dailyPage */
  daily: (q?: RangeQuery) => items(get<RangedList<DailyMetrics>>("/analytics/daily", q)),
  dailyPage: (q?: RangeQuery) => get<RangedList<DailyMetrics>>("/analytics/daily", q),
  analyticsSummary: (q?: RangeQuery) => get<AnalyticsSummary>("/analytics/summary", q),
  capacityHistory: (q?: { granularity?: "auto" | "5m" | "1h" | "6h" } & RangeQuery) => get<CapacityHistory>("/capacity/history", q),

  // pipelines (registry + jobs)
  pipelines: (q?: { kind?: "root" | "sub" } & RangeQuery) => get<RangedList<PipelineListItem>>("/pipelines", q),
  pipeline: (id: string, q?: { version?: string } & RangeQuery) => get<PipelineDetail>(`/pipelines/${enc(id)}`, q),
  pipelineRuns: (id: string, q?: PipelineRunsQuery) => get<PipelineRunsPage>(`/pipelines/${enc(id)}/runs`, q),
  workflowPipelineRuns: (id: string) => get<WorkflowPipelineRuns>(`/workflows/${enc(id)}/pipeline-runs`),
  pipelineJob: (jobId: string, q?: { job_scope?: "self" | "tree"; limit?: number }) => get<PipelineJobDetail>(`/pipeline-jobs/${enc(jobId)}`, q),

  // file-name search across stages
  fileSearch: (q: FileSearchQuery) => get<FileSearchResult>("/files/search", q),

  // stages / gcs
  /** @deprecated unwraps — prefer stagesPage */
  stages: (q?: RangeQuery) => items(get<RangedList<StageSummary>>("/stages", q)),
  stagesPage: (q?: RangeQuery) => get<RangedList<StageSummary>>("/stages", q),
  stage: (id: StageId, q?: StageQuery) => get<StageDetail>(`/stages/${id}`, q),
  buckets: () => get<GcsBucket[]>("/gcs/buckets"),
  /** `delimiter: ""` → flat listing (kept by qs); `range: "all"` disables the time filter */
  gcsObjects: (q: { bucket: string; prefix?: string; delimiter?: string; limit?: number; q?: string } & RangeQuery) =>
    request<GcsListing & { range: ResolvedRange | null }>("/gcs/objects" + qs(q, { keepEmpty: ["delimiter"] })),
  gcsObject: (q: { bucket: string; name: string; limit?: number }) => get<GcsObjectContent>("/gcs/object", q),

  // results
  results: (q?: ResultQuery, signal?: AbortSignal) => get<ResultsPage>("/results", q, signal),
  result: (utteranceId: string) => get<ResultDetail>(`/results/${enc(utteranceId)}`),
  resultFile: () => get<ResultFileMeta>("/results/file"),

  // config / audit / alerts
  config: () => get<AppConfig>("/config"),
  patchConfig: (body: ConfigPatch & { reason: string }) => patch<ConfigUpdateResult>("/config", body),
  audit: (q?: AuditQuery) => get<Paginated<AuditEntry> & { range: ResolvedRange }>("/audit", q),
  /** @deprecated unwraps — prefer alertsPage (carries range + openOutsideRange) */
  alerts: (q?: AlertQuery) => items(get<RangedList<Alert>>("/alerts", q)),
  alertsPage: (q?: AlertQuery) => get<RangedList<Alert> & { openOutsideRange: number }>("/alerts", q),
  ackAlert: (id: string, body: { note?: string } = {}) => post<Alert>(`/alerts/${enc(id)}/ack`, body),
  resolveAlert: (id: string, body: { note?: string } = {}) => post<Alert>(`/alerts/${enc(id)}/resolve`, body),
  /** @deprecated unwraps — prefer incidentsPage */
  incidents: (q?: RangeQuery) => items(get<RangedList<Incident>>("/incidents", q)),
  incidentsPage: (q?: RangeQuery) => get<RangedList<Incident>>("/incidents", q),

  // global event / log feeds
  /** @deprecated unwraps — prefer eventsPage */
  events: (q?: EventQuery) => items(get<RangedList<WorkflowEvent>>("/events", q)),
  eventsPage: (q?: EventQuery) => get<RangedList<WorkflowEvent>>("/events", q),
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
