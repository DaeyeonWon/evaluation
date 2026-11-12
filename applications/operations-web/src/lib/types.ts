/**
 * AIPO · 빅스비 실발화 평가 — shared domain + API types.
 *
 * These mirror the shapes produced by the mock engine (a 1:1 port of designs/mock-data.js).
 * Conventions:
 *  - Every `*_at`, `ts`, `timeCreated`, `opened_at` … is epoch **milliseconds** (number).
 *    `timestamp` / `*Iso` strings are pre-formatted ISO strings (KST +09:00 for events/audit,
 *    UTC `Z` for logs — same as the prototype).
 *  - "now" is the simulator's VIRTUAL clock (starts 2026-11-12T14:30:00+09:00 and advances
 *    ~20 virtual seconds per real 1.2 s tick at speed 1). Never use Date.now() for relative
 *    times — use `snapshot.now` from the live stream (see useSimNow()).
 */

// ─────────────────────────────────────────────── primitives ──
export type EpochMs = number;
export type LangCode = "ko" | "en" | "ja" | "es";
export type WorkflowStatus =
  | "RECEIVED"
  | "VALIDATED"
  | "QUEUED"
  | "RESERVED"
  | "DISPATCHING"
  | "RUNNING"
  | "RETRY_WAIT"
  | "SUCCEEDED"
  | "DEAD_LETTERED"
  | "CANCELLED"
  | "TIMED_OUT";
export type StageId =
  | "gcs_input"
  | "event_bus"
  | "ingress"
  | "registry_queue"
  | "scheduler"
  | "workflows"
  | "vertex"
  | "results"
  | "retry"
  | "dlq";
/** Standardized status tone → CSS token `--st-<tone>`. */
export type Tone = "success" | "running" | "queued" | "retry" | "failed" | "dlq" | "cancelled";
export type NodeStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELLED";
export type AttemptStatus = "DISPATCHING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
export type DlqStatus = "PENDING_REVIEW" | "APPROVED" | "REPLAYING" | "REPLAYED" | "CLOSED";
export type ReplayStatus = "APPROVED" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "SUPERSEDED";
export type Severity = "DEBUG" | "INFO" | "NOTICE" | "WARNING" | "ERROR" | "CRITICAL";
export type FailureCategory =
  | "PIPELINE_EXECUTION"
  | "MODEL_TRANSIENT"
  | "QUOTA"
  | "TIMEOUT"
  | "INPUT_SCHEMA"
  | "AUTH_PERMISSION"
  | "CODE_DEFECT";
export type FailureReason =
  | "INTENT_MISMATCH"
  | "SLOT_ERROR"
  | "RESPONSE_QUALITY"
  | "TIMEOUT"
  | "ASR_ERROR"
  | "POLICY_VIOLATION";
export type ComponentId = "preprocess" | "intent_eval" | "response_eval" | "latency_check" | "aggregate" | "persist";
/** 'v1.0' | 'v1.1' | 'v1.2-rc' in the mock. */
export type PipelineVersion = string;
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";
export type CapacityStatus = "OK" | "SATURATED" | "BACKLOGGED" | "PAUSED" | "DISABLED";
export type Role = "Admin" | "Operator" | "Viewer";
export type ServiceStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "DISABLED";

// ─────────────────────────────────────────────── catalog (static) ──
export interface LanguageConfig {
  code: LangCode;
  name: string;
  nameEn: string;
  locale: string;
  flag: string;
  maxConcurrent: number;
  batchSize: number;
  priorityWeight: number;
  maxStartsPerMinute: number;
  enabled: boolean;
  paused: boolean;
  backlogAlertThreshold: number;
  p95WaitSloSec: number;
}

export interface Operator {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  lastActiveAt: EpochMs;
}

export interface RolePermission {
  permission: string;
  key: string;
  Viewer: boolean;
  Operator: boolean;
  Admin: boolean;
}

export interface PipelineVersionDetail {
  version: PipelineVersion;
  status: "DEPRECATED" | "STABLE" | "CANARY" | string;
  trafficPct: number;
  releasedAt: EpochMs;
  image: string;
  templateUri: string;
  judgeModel: string;
  modelUnderTest: string;
  notes: string;
}

export interface ServiceInfo {
  id: string;
  name: string;
  runtime: string;
  enabled: boolean;
  status: ServiceStatus | string;
  version: string;
  revision: string;
  instances: number;
  minInstances: number;
  maxInstances: number;
  region: string;
  serviceAccount: string;
  lastDeployAt: EpochMs;
  errorRate: number;
  p95LatencyMs: number;
  note?: string;
}

export interface AlertPolicy {
  id: string;
  name: string;
  metric: string;
  condition: string;
  severity: AlertSeverity;
  channels: string[];
  enabled: boolean;
}

export interface Stage {
  id: StageId;
  order: number;
  kind: "main" | "branch";
  branchFrom?: StageId;
  returnsTo?: StageId;
  label: { ko: string; en: string };
  gcpService: string;
  resource: string;
  trigger?: string;
  /** lucide icon name (kebab-case), e.g. "upload-cloud". */
  icon: string;
  states: WorkflowStatus[];
  services: string[];
  components?: ComponentId[];
  description: string;
}

export interface StageEdge {
  from: StageId;
  to: StageId;
  label: string;
  tone?: Tone;
  dashed?: boolean;
}

export interface MetaEntry {
  label: string;
  tone: Tone;
  /** lucide icon name (kebab-case). */
  icon: string;
}
export interface StatusMetaEntry extends MetaEntry {
  labelEn: string;
  terminal: boolean;
  order: number;
}
export interface SeverityMetaEntry {
  label: string;
  tone: Tone;
}
export interface FailureCategoryMetaEntry {
  label: string;
  policy: string;
  retryable: boolean;
  maxRetries?: number;
  icon: string;
}
export interface FailureReasonMetaEntry {
  label: string;
  tone: Tone;
}
export interface EventCatalogEntry {
  stage: StageId;
  source: string;
  label: string;
}

export interface DagTemplateNode {
  id: ComponentId;
  label: string;
  labelKo: string;
  ev: string;
  deps: ComponentId[];
  /** nominal [start, end] fraction of total pipeline duration */
  f: [number, number];
  machineType: string;
  cpu: number;
  gpu: { type: string; count: number } | null;
  memGb: number;
  image: string;
  description: string;
}

export interface Capsule {
  id: string;
  label: string;
  labelEn: string;
  weight: number;
  adj: number;
  confuse: string;
}

export interface ResultColumn {
  key: keyof ResultRow;
  label: string;
  type: "string" | "enum" | "text" | "number" | "datetime";
}

// ─────────────────────────────────────────────── config ──
export interface RetryPolicy {
  maxRetries: number;
  maxAttempts: number;
  backoffSeconds: number[];
  nonRetryable: FailureCategory[];
  limitedRetry: Partial<Record<FailureCategory, number>>;
}

export interface QueuePolicy {
  mode: string;
  aging: { enabled: boolean; boostPerMinutes: number; maxBoost: number };
  crossLanguage: string;
}

export interface DriftItem {
  key: string;
  terraform: unknown;
  runtime: unknown;
  changedBy: string | null;
  changedAt: EpochMs | null;
  reason: string | null;
}

/** GET /api/v1/config */
export interface AppConfig {
  project: { id: string; number: string; region: string; environment: string; console: string };
  languages: LanguageConfig[];
  global: { maxConcurrent: number; maxStartsPerMinute: number };
  retry: RetryPolicy;
  workflowTimeoutMin: number;
  pipelineTimeoutMin: number;
  reservationLeaseMin: number;
  queuePolicy: QueuePolicy;
  pipelineVersions: PipelineVersion[];
  pipelineVersionDetails: PipelineVersionDetail[];
  defaultPipelineVersion: PipelineVersion;
  services: ServiceInfo[];
  alertPolicies: AlertPolicy[];
  operators: Operator[];
  rolePermissions: RolePermission[];
  buckets: { input: string; artifacts: string; results: string };
  bigquery: { dataset: string; resultsTable: string; eventsTable: string };
  /** Terraform-declared defaults (flattened keys) */
  terraformDefaults: Record<string, unknown>;
  /** Live runtime values (same flattened keys) */
  runtimeConfig: Record<string, unknown>;
  /** terraformDefaults vs runtimeConfig differences */
  drift: DriftItem[];
}

/** PATCH /api/v1/config body — every field optional. */
export interface ConfigPatch {
  retry?: Partial<Pick<RetryPolicy, "maxRetries" | "backoffSeconds">>;
  workflowTimeoutMin?: number;
  pipelineTimeoutMin?: number;
  queuePolicy?: { aging?: Partial<QueuePolicy["aging"]>; mode?: string };
  defaultPipelineVersion?: PipelineVersion;
  /** traffic split per version, e.g. {"v1.1": 50, "v1.2-rc": 50} */
  versionTraffic?: Record<PipelineVersion, number>;
  services?: Record<string, { enabled: boolean }>;
  alertPolicies?: Record<string, { enabled: boolean }>;
  reason?: string;
}

// ─────────────────────────────────────────────── workflow ──
export interface WorkflowInput {
  bucket: string;
  object: string;
  generation: string;
  sizeBytes: number;
  utteranceCount: number;
  md5Hash: string;
  contentType: string;
  uri: string;
}

export interface WorkflowResultFile {
  uri: string;
  summaryUri: string;
  sizeBytes: number;
  rows: number;
  passCount: number;
  failCount: number;
  passRate: number;
  bqTable: string;
  committed_at: EpochMs;
}

export interface WorkflowError {
  code: string;
  category: FailureCategory;
  message: string;
  node: ComponentId | null;
  attempt: number;
}

export interface Artifact {
  name: string;
  type: string;
  uri: string;
  sizeBytes?: number;
  available?: boolean;
}

export interface DagNode {
  id: ComponentId;
  label: string;
  labelKo: string;
  deps: ComponentId[];
  status: NodeStatus;
  start_at: EpochMs | null;
  end_at: EpochMs | null;
  duration_ms: number | null;
  task_id: string;
  progress: { processed: number; total: number; pct: number; pass: number; fail: number };
  resources: {
    machineType: string;
    cpu: { cores: number; utilPct: number };
    gpu: { type: string; count: number; utilPct: number } | null;
    memory: { limitGb: number; usedGb: number };
  };
  image: string;
  inputs: Artifact[];
  outputs: Artifact[];
  error: { code: string; category: FailureCategory; message: string } | null;
  description: string;
}

export interface Attempt {
  attempt: number;
  pipeline_job_id: string;
  workflow_execution_id: string;
  vertex_resource: string;
  pipeline_version: PipelineVersion;
  status: AttemptStatus;
  created_at: EpochMs;
  started_at: EpochMs | null;
  completed_at: EpochMs | null;
  duration_ms: number | null;
  error_code: string | null;
  error_category: FailureCategory | null;
  error_message: string | null;
  failed_node: ComponentId | null;
  backoffSec: number | null;
  retry_at: EpochMs | null;
  dag: DagNode[];
}

/** GET /api/v1/workflows/[id] (full document). */
export interface Workflow {
  workflow_id: string;
  batch_id: string;
  language: LangCode;
  status: WorkflowStatus;
  stage: StageId;
  pipeline_version: PipelineVersion;
  replay_cycle: number;
  replay_of: string | null;
  replayed_by: string | null;
  dead_letter_id: string | null;
  priority: number;
  event_type: "pipeline.batch.requested" | "pipeline.batch.replay.requested";
  event_id: string;
  idempotency_key: string;
  correlation_id: string;
  trace_id: string;
  input: WorkflowInput;
  result: WorkflowResultFile | null;
  created_at: EpochMs;
  validated_at: EpochMs | null;
  queued_at: EpochMs | null;
  reserved_at: EpochMs | null;
  started_at: EpochMs | null;
  completed_at: EpochMs | null;
  updated_at: EpochMs;
  waitMs: number | null;
  runMs: number | null;
  totalMs: number | null;
  attempt: number;
  attempts: Attempt[];
  /** DAG of the latest attempt */
  dag: DagNode[];
  current_node: ComponentId | null;
  progress: { processed: number; total: number; pct: number };
  reservation_id: string | null;
  workflow_execution_id: string | null;
  pipeline_job_id: string | null;
  error: WorkflowError | null;
  retry_at: EpochMs | null;
  cancel_requested_at: EpochMs | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  status_history: { status: WorkflowStatus; at: EpochMs }[];
}

/** Row in GET /api/v1/workflows (slim projection — no dag / attempts arrays). */
export interface WorkflowSummary {
  workflow_id: string;
  batch_id: string;
  language: LangCode;
  status: WorkflowStatus;
  stage: StageId;
  pipeline_version: PipelineVersion;
  priority: number;
  event_type: Workflow["event_type"];
  replay_cycle: number;
  replay_of: string | null;
  replayed_by: string | null;
  dead_letter_id: string | null;
  pipeline_job_id: string | null;
  input: Pick<WorkflowInput, "uri" | "object" | "utteranceCount" | "sizeBytes">;
  result: Pick<WorkflowResultFile, "uri" | "rows" | "passRate" | "passCount" | "failCount"> | null;
  attempt: number;
  attemptsCount: number;
  retries: number;
  current_node: ComponentId | null;
  progress: Workflow["progress"];
  error: WorkflowError | null;
  lastErrorCode: string | null;
  created_at: EpochMs;
  queued_at: EpochMs | null;
  started_at: EpochMs | null;
  completed_at: EpochMs | null;
  updated_at: EpochMs;
  retry_at: EpochMs | null;
  waitMs: number | null;
  runMs: number | null;
  totalMs: number | null;
  trace_id: string;
}

/** GET /api/v1/workflows/[id]/dag */
export interface WorkflowDag {
  workflow_id: string;
  attempt: number | null;
  pipeline_job_id: string | null;
  nodes: DagNode[];
  edges: { from: ComponentId; to: ComponentId }[];
  current_node: ComponentId | null;
  /** DAG of every attempt (index = attempt - 1) */
  attempts: { attempt: number; pipeline_job_id: string; status: AttemptStatus; nodes: DagNode[] }[];
}

// ─────────────────────────────────────────────── events & logs ──
export interface WorkflowEvent {
  event_id: string;
  ts: EpochMs;
  /** ISO KST */
  timestamp: string;
  /** e.g. TASK_PREPROCESS_COMPLETED (see catalog EVENT_CATALOG) */
  name: string;
  label: string;
  stage: StageId;
  source: string;
  severity: Severity;
  workflow_id: string | null;
  batch_id: string | null;
  language: LangCode | null;
  attempt: number | null;
  pipeline_job_id: string | null;
  correlation_id: string | null;
  trace_id: string | null;
  payload: Record<string, unknown>;
}

export interface LogEntry {
  log_id: string;
  ts: EpochMs;
  /** ISO UTC */
  timestamp: string;
  severity: Severity;
  service: string;
  component: string;
  event_type: string | null;
  workflow_id: string | null;
  pipeline_job_id: string | null;
  execution_id: string | null;
  language: LangCode | null;
  attempt: number | null;
  batch_id: string | null;
  error_code: string | null;
  trace_id: string;
  span_id: string;
  duration_ms: number | null;
  message: string;
  stack_trace: string | null;
  labels: Record<string, string> | null;
}

// ─────────────────────────────────────────────── GCS ──
export interface GcsObject {
  bucket: string;
  name: string;
  uri: string;
  size: number;
  generation: string;
  metageneration: string;
  contentType: string;
  md5Hash: string;
  crc32c: string;
  storageClass: string;
  timeCreated: EpochMs;
  updated: EpochMs;
  metadata: Record<string, string>;
  workflow_id: string | null;
}

export interface GcsBucket {
  name: string;
  location: string;
  storageClass: string;
  purpose: string;
  versioning: boolean;
  retentionDays: number;
  trigger: string | null;
  objectCount: number;
  totalBytes: number;
}

/** GET /api/v1/gcs/objects?bucket=&prefix= */
export interface GcsListing {
  bucket: string;
  prefix: string;
  prefixes: string[];
  prefixCounts: Record<string, number>;
  objects: GcsObject[];
}

/** GET /api/v1/gcs/object?bucket=&name= */
export interface GcsObjectContent {
  object: GcsObject;
  /** text preview (first N lines/rows); null if not previewable */
  content: string | null;
}

// ─────────────────────────────────────────────── DLQ / replay ──
export interface DeadLetter {
  dead_letter_id: string;
  workflow_id: string;
  original_event_id: string;
  language: LangCode;
  batch_id: string;
  failure_category: FailureCategory;
  error_code: string;
  failure_reason: string;
  failed_node: ComponentId | null;
  attempts: number;
  pipeline_version: PipelineVersion;
  input_uri: string;
  utterance_count: number;
  last_execution_id: string;
  last_pipeline_job_id: string;
  status: DlqStatus;
  assigned_operator: string | null;
  created_at: EpochMs;
  updated_at: EpochMs;
  last_log_excerpt: string;
  last_stack_trace: string | null;
  attempt_history: {
    attempt: number;
    pipeline_job_id: string;
    status: AttemptStatus;
    error_code: string | null;
    started_at: EpochMs | null;
    completed_at: EpochMs | null;
  }[];
  replay_ids: string[];
  resolution: string | null;
  notes: { at: EpochMs; by: string; text: string }[];
}

export interface Replay {
  replay_id: string;
  dead_letter_id: string;
  original_workflow_id: string;
  replay_workflow_id: string | null;
  replay_cycle: number;
  requested_by: string;
  approved_by: string;
  reason: string;
  pipeline_version_from: PipelineVersion;
  pipeline_version_to: PipelineVersion;
  status: ReplayStatus;
  created_at: EpochMs;
  approved_at: EpochMs;
  scheduled_for?: EpochMs;
  completed_at: EpochMs | null;
}

/** GET /api/v1/dead-letters/[id] */
export interface DeadLetterDetail {
  deadLetter: DeadLetter;
  workflow: Workflow | null;
  replays: Replay[];
  replayWorkflows: WorkflowSummary[];
  events: WorkflowEvent[];
  recentLogs: LogEntry[];
}

/** POST /api/v1/dead-letters/[id]/replay */
export interface ReplayResult {
  deadLetter: DeadLetter;
  replay: Replay;
  workflow: WorkflowSummary;
}

// ─────────────────────────────────────────────── capacity ──
export interface Reservation {
  reservation_id: string;
  workflow_id: string;
  language: LangCode;
  slot_weight: number;
  status: "ACTIVE" | "RELEASED" | "ORPHANED";
  attempt: number;
  lease_expires_at: EpochMs;
  fencing_token: number;
  created_at: EpochMs;
  updated_at: EpochMs;
  released_at: EpochMs | null;
  note?: string;
}

export interface LanguageCapacity {
  code: LangCode;
  name: string;
  nameEn: string;
  enabled: boolean;
  paused: boolean;
  active: number;
  max: number;
  running: number;
  reserved: number;
  dispatching: number;
  retryWait: number;
  backlog: number;
  intake: number;
  utilization: number;
  avgWaitSec: number;
  p95WaitSec: number;
  oldestQueuedAt: EpochMs | null;
  throughputPerHour: number;
  completedLastHour: number;
  utterancesPerHour: number;
  priorityWeight: number;
  maxStartsPerMinute: number;
  batchSize: number;
  backlogAlertThreshold: number;
  p95WaitSloSec: number;
  status: CapacityStatus;
}

/** GET /api/v1/languages/capacity */
export interface CapacitySnapshot {
  at: EpochMs;
  global: { active: number; max: number; utilization: number; maxStartsPerMinute: number; backlog: number };
  languages: LanguageCapacity[];
  reservationsActive: number;
  reservationsOrphaned: number;
}

/** PATCH /api/v1/languages/[lang]/capacity body */
export interface LanguageCapacityPatch {
  max_concurrent?: number;
  priority_weight?: number;
  max_starts_per_minute?: number;
  paused?: boolean;
  enabled?: boolean;
  reason?: string;
}

/** GET/PATCH /api/v1/capacity/global */
export interface GlobalCapacity {
  maxConcurrent: number;
  maxStartsPerMinute: number;
  active: number;
  utilization: number;
}
export interface GlobalCapacityPatch {
  max_concurrent?: number;
  max_starts_per_minute?: number;
  reason?: string;
}

// ─────────────────────────────────────────────── overview ──
export interface Overview {
  at: EpochMs;
  running: number;
  pending: number;
  queued: number;
  completedToday: number;
  failedToday: number;
  cancelledToday: number;
  retryWaiting: number;
  dlqPendingReview: number;
  dlqTotal: number;
  successRate7d: number | null;
  successRateToday: number | null;
  avgProcessingMs: number;
  p95ProcessingMs: number;
  avgWaitMs: number;
  utterancesEvaluatedToday: number;
  utterancePassRateToday: number | null;
  statusDistribution: Record<WorkflowStatus, number>;
  errorDistribution7d: Record<FailureCategory, number>;
  openAlerts: number;
  capacity: CapacitySnapshot;
}

// ─────────────────────────────────────────────── metrics / analytics ──
export interface HourlyMetrics {
  ts: EpochMs[];
  throughput: Record<LangCode, number[]>;
  utterances: Record<LangCode, number[]>;
  queueDepth: Record<LangCode, number[]>;
  successRate: number[];
  retryRate: number[];
  avgDurationSec: number[];
  p95DurationSec: number[];
  errors: Record<FailureCategory, number[]>;
}

export interface FiveMinMetrics {
  ts: EpochMs[];
  utterances: Record<LangCode, number[]>;
  completed: Record<LangCode, number[]>;
  active: Record<LangCode, number[]>;
  queue: Record<LangCode, number[]>;
  successRate: number[];
  passRate: number[];
}

export interface DailyMetrics {
  date: string;
  pipelines: Record<LangCode, number> & { total: number };
  utterances: number;
  successRate: number;
  retries: number;
  deadLettered: number;
  timedOut: number;
  errorCategories: Record<FailureCategory, number>;
  costUsd: {
    vertex: number;
    llmJudge: number;
    workflows: number;
    cloudRun: number;
    firestore: number;
    bigquery: number;
    storage: number;
    total: number;
  };
  partial: boolean;
}

export interface ErrorCategoryCount {
  category: FailureCategory;
  label: string;
  count: number;
}

export interface DurationStat {
  avgSec: number;
  p95Sec: number;
  n: number;
}
export interface ComponentDuration extends DurationStat {
  component: ComponentId;
  label: string;
  labelKo: string;
  byLanguage: Partial<Record<LangCode, DurationStat>>;
  byVersion: Record<PipelineVersion, DurationStat>;
}

export interface RateStat {
  total: number;
  pass: number;
  fail: number;
  passRate: number | null;
}

export interface VersionComparison {
  version: PipelineVersion;
  status: string;
  trafficPct: number;
  modelUnderTest: string;
  judgeModel: string;
  runs: number;
  terminal: number;
  succeeded: number;
  pipelineSuccessRate: number | null;
  retryRate: number | null;
  avgDurationSec: number;
  p95DurationSec: number;
  utterances: number;
  utterancePassRate: number | null;
  byCapsule: Record<string, RateStat>;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgJudgeScore: number;
  costPerRunUsd: number;
}

export interface LanguageSummary {
  code: LangCode;
  name: string;
  workflows: number;
  succeeded: number;
  successRate: number | null;
  deadLettered: number;
  avgDurationSec: number;
  p95DurationSec: number;
  utterancesToday: number;
  passRateToday: number | null;
  capacity: LanguageCapacity;
  throughput7d: number;
}

/** GET /api/v1/analytics/throughput?range=24h|7d|today&granularity=hour|5m */
export interface ThroughputSeries {
  granularity: "hour" | "5m";
  ts: EpochMs[];
  /** pipelines completed per bucket (hour) or utterances per 5m bucket */
  byLanguage: Record<LangCode, number[]>;
  utterances: Record<LangCode, number[]>;
  total: number[];
  queueDepth?: Record<LangCode, number[]>;
  active?: Record<LangCode, number[]>;
}

/** GET /api/v1/analytics/quality (success & retry rates + durations, hourly) */
export interface QualitySeries {
  ts: EpochMs[];
  successRate: number[];
  retryRate: number[];
  avgDurationSec: number[];
  p95DurationSec: number[];
}

/** GET /api/v1/analytics/errors */
export interface ErrorAnalytics {
  top: ErrorCategoryCount[];
  hourly: { ts: EpochMs[]; byCategory: Record<FailureCategory, number[]> };
  /** attempt-level error codes from the workflow registry, most frequent first */
  topErrorCodes: { code: string; category: FailureCategory; count: number; lastAt: EpochMs }[];
}

/** GET /api/v1/analytics/cost */
export interface CostAnalytics {
  daily: { date: string; partial: boolean; costUsd: DailyMetrics["costUsd"] }[];
  total7d: number;
  byComponent7d: Record<Exclude<keyof DailyMetrics["costUsd"], "total">, number>;
}

/** GET /api/v1/analytics/summary — everything S7 needs in one call */
export interface AnalyticsSummary {
  hourly: HourlyMetrics;
  fiveMin: FiveMinMetrics;
  daily: DailyMetrics[];
  errorCategories7d: ErrorCategoryCount[];
  componentDurations: ComponentDuration[];
  versionComparison: VersionComparison[];
  languageSummary: LanguageSummary[];
}

// ─────────────────────────────────────────────── alerts / audit ──
export interface Alert {
  alert_id: string;
  policy_id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  language: LangCode | null;
  workflow_id?: string;
  dead_letter_id?: string;
  status: AlertStatus;
  opened_at: EpochMs;
  resolved_at: EpochMs | null;
  acknowledged_by: string | null;
  incident_id: string | null;
}

export interface Incident {
  incident_id: string;
  title: string;
  severity: string;
  status: string;
  started_at: EpochMs;
  resolved_at: EpochMs | null;
  commander: string;
  alerts: string[];
  languages: LangCode[];
  summary: string;
  timeline: { at: EpochMs; text: string }[];
  postmortem?: string;
}

export interface AuditEntry {
  audit_id: string;
  ts: EpochMs;
  timestamp: string;
  actor: string;
  actorName: string;
  role: Role | "System";
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  request_id: string;
  source_ip: string;
}

// ─────────────────────────────────────────────── results ──
export interface ResultRow {
  utterance_id: string;
  workflow_id: string;
  batch_id: string;
  pipeline_job_id: string;
  language: LangCode;
  capsule: string;
  capsule_id: string;
  intent_expected: string;
  intent_predicted: string;
  utterance_text: string;
  asr_text: string;
  expected_response: string;
  actual_response: string;
  judge_score: number;
  judge_reason: string;
  result: "PASS" | "FAIL";
  failure_reason: FailureReason | "";
  latency_ms: number;
  device_type: string;
  model_version: string;
  pipeline_version: PipelineVersion;
  eval_timestamp: string;
  eval_ts: EpochMs;
}

export interface ResultsSummary extends RateStat {
  byLanguage: Record<string, RateStat>;
  byCapsule: Record<string, RateStat>;
  byVersion: Record<string, RateStat>;
  byDevice: Record<string, RateStat>;
  byCapsuleVersion: Record<string, Record<string, RateStat>>;
  byFailureReason: Partial<Record<FailureReason, number>>;
  latency: { avgMs: number; p50Ms: number; p95Ms: number };
  avgJudgeScore: number;
}

/** Aggregates returned with GET /api/v1/results (computed over the FILTERED rows) */
export interface ResultsAggregates extends ResultsSummary {
  byIntent: Record<string, RateStat>;
  /** KST date (YYYY-MM-DD) of eval_ts */
  byDate: Record<string, RateStat>;
  /** KST hour "HH" of eval_ts */
  byHour: Record<string, RateStat>;
  /** capsule_id → language → rate */
  capsuleLanguage: Record<string, Partial<Record<LangCode, RateStat>>>;
  /** histogram of judge_score in 0.1 buckets (index 0 = [0,0.1)) */
  judgeScoreHistogram: number[];
  /** histogram of latency_ms in 1s buckets up to 12s+ */
  latencyHistogram: number[];
  /**
   * Finer latency histogram matching the approved prototype's bins (additive, optional).
   * `edgesMs` are lower bounds of each bucket; the last bucket is open-ended (8s+ = TIMEOUT).
   */
  latencyHistogramFine?: { edgesMs: number[]; counts: number[] };
}

/** GET /api/v1/results */
export interface ResultsPage {
  rows: ResultRow[];
  total: number;
  page: number;
  pageSize: number;
  aggregates: ResultsAggregates;
  file: ResultFile;
}

export interface ResultFile {
  uri: string;
  bucket: string;
  name: string;
  sizeBytes: number;
  generatedAt: EpochMs;
  rowCount: number;
  scope: string;
}

/** GET /api/v1/results/file */
export interface ResultFileMeta {
  file: ResultFile;
  files: ResultFile[];
  columns: ResultColumn[];
  bigquery: { table: string; rows: number };
}

/** GET /api/v1/results/[utterance_id] */
export interface ResultDetail {
  row: ResultRow;
  workflow: WorkflowSummary | null;
  /** the raw JSONL input line for this utterance (if derivable) */
  inputLine: string | null;
}

// ─────────────────────────────────────────────── stages ──
/** GET /api/v1/stages — one row per stage */
export interface StageSummary {
  stage: Stage;
  count: number;
  counts: Partial<Record<WorkflowStatus, number>>;
  byLanguage: Partial<Record<LangCode, number>>;
}

/** GET /api/v1/stages/[id] */
export interface StageDetail {
  stage: Stage;
  workflows: WorkflowSummary[];
  counts: Partial<Record<WorkflowStatus, number>>;
  gcsObjects: GcsObject[];
  events: WorkflowEvent[];
  logs: LogEntry[];
  /** stage-specific KPI bag (see FOUNDATION.md for keys per stage) */
  metrics: Record<string, unknown>;
}

// ─────────────────────────────────────────────── simulator / stream ──
export interface SimState {
  running: boolean;
  speed: number;
  tick: number;
  now: EpochMs;
  nowIso: string;
  baseNow: EpochMs;
  /** true when ticks are skipped (no SSE subscribers and no API request for 2 min) */
  idle: boolean;
  /** number of open /api/v1/stream connections in THIS server process */
  subscribers: number;
}

/** Workflow position for animations (subset of WorkflowSummary). */
export interface ActiveWorkflowPos {
  workflow_id: string;
  language: LangCode;
  status: WorkflowStatus;
  stage: StageId;
  pct: number;
  current_node: ComponentId | null;
  attempt: number;
  priority: number;
  replay_cycle: number;
  updated_at: EpochMs;
  queued_at: EpochMs | null;
  retry_at: EpochMs | null;
}

/** SSE `tick` payload (also GET /api/v1/sim → snapshot). */
export interface TickSnapshot {
  tick: number;
  now: EpochMs;
  nowIso: string;
  speed: number;
  running: boolean;
  counts: Record<WorkflowStatus, number>;
  stageCounts: Record<StageId, number>;
  kpis: Omit<Overview, "capacity" | "statusDistribution">;
  capacity: CapacitySnapshot;
  active: ActiveWorkflowPos[];
  /** number of workflows in the registry */
  totalWorkflows: number;
  dlqTotal: number;
  auditCount: number;
}

export interface TransitionMessage {
  workflow_id: string;
  language: LangCode;
  from: WorkflowStatus | null;
  to: WorkflowStatus;
  stage: StageId;
  at: EpochMs;
  workflow: ActiveWorkflowPos;
}

/** Map of SSE event name → payload type. */
export interface StreamEventMap {
  tick: TickSnapshot;
  transition: TransitionMessage;
  event: WorkflowEvent;
  log: LogEntry;
  alert: Alert;
  audit: AuditEntry;
  dlq: DeadLetter;
  sim: SimState;
  hello: { sim: SimState; serverTime: number };
}
export type StreamEventType = keyof StreamEventMap;

// ─────────────────────────────────────────────── API envelopes ──
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: {
    /** machine code, e.g. INVALID_ARGUMENT, NOT_FOUND, CONFLICT, FORBIDDEN */
    code: string;
    /** Korean, user-presentable */
    message: string;
    details?: unknown;
  };
}

/** GET /api/v1/meta — static catalog in one payload (also importable from '@/lib/catalog'). */
export interface MetaCatalog {
  baseNow: EpochMs;
  timezone: string;
  project: string;
  region: string;
  languages: LanguageConfig[];
  stages: Stage[];
  stageEdges: StageEdge[];
  stateToStage: Record<WorkflowStatus, StageId>;
  states: WorkflowStatus[];
  activeStates: WorkflowStatus[];
  terminalStates: WorkflowStatus[];
  dagTemplate: DagTemplateNode[];
  statusMeta: Record<WorkflowStatus, StatusMetaEntry>;
  nodeStatusMeta: Record<NodeStatus, MetaEntry>;
  attemptStatusMeta: Record<AttemptStatus, MetaEntry>;
  dlqStatusMeta: Record<DlqStatus, MetaEntry>;
  severityMeta: Record<Severity, SeverityMetaEntry>;
  failureCategoryMeta: Record<FailureCategory, FailureCategoryMetaEntry>;
  failureReasonMeta: Record<FailureReason, FailureReasonMetaEntry>;
  eventCatalog: Record<string, EventCatalogEntry>;
  capsules: Capsule[];
  devices: string[];
  resultColumns: ResultColumn[];
  operators: Operator[];
}

// ─────────────────────────────────────────────── API response shapes (endpoint-specific) ──
/** GET /api/v1/workflows */
export interface WorkflowListResponse extends Paginated<WorkflowSummary> {
  /** facet counts over the FILTERED set (before pagination) */
  facets: {
    status: Partial<Record<WorkflowStatus, number>>;
    language: Partial<Record<LangCode, number>>;
    version: Record<string, number>;
  };
}

/** GET /api/v1/workflows/[id]/attempts */
export interface AttemptHistory {
  workflow_id: string;
  attempts: Attempt[];
  retryPolicy: RetryPolicy;
  /** original → replays (oldest first), including this workflow */
  replayChain: WorkflowSummary[];
  replays: Replay[];
}

/** GET /api/v1/workflows/[id]/logs, GET /api/v1/logs */
export interface LogPage {
  items: LogEntry[];
  total: number;
  /** distinct components / services in the (unfiltered) workflow log, for filter chips */
  components: string[];
  services: string[];
}

/** GET /api/v1/dead-letters */
export interface DeadLetterList extends Paginated<DeadLetter> {
  facets: {
    status: Partial<Record<DlqStatus, number>>;
    category: Partial<Record<FailureCategory, number>>;
    language: Partial<Record<LangCode, number>>;
  };
}

/** POST /api/v1/dead-letters/replay-batch */
export interface BatchReplayResult {
  succeeded: number;
  failed: number;
  results: { id: string; ok: boolean; error?: string; replay?: Replay; workflow?: WorkflowSummary }[];
}

/** Impact analysis returned by capacity PATCH (also with ?dry_run=1). */
export interface CapacityImpact {
  language: LangCode | "global";
  field: string;
  before: number | boolean;
  after: number | boolean;
  activeNow: number;
  backlog: number;
  /** running work above the new limit (it keeps running; no new admissions until below) */
  overLimitBy: number;
  /** Korean human summary */
  message: string;
}

/** PATCH /api/v1/languages/[lang]/capacity */
export interface CapacityChangeResult {
  dryRun: boolean;
  language: LanguageCapacity;
  capacity: CapacitySnapshot;
  impact: CapacityImpact[];
  audit: AuditEntry[];
}

/** PATCH /api/v1/capacity/global */
export interface GlobalCapacityChangeResult {
  dryRun: boolean;
  global: GlobalCapacity;
  impact: CapacityImpact[];
  audit: AuditEntry[];
}

/** PATCH /api/v1/config */
export interface ConfigUpdateResult {
  changed: string[];
  config: AppConfig;
  audit: AuditEntry[];
}

/** GET /api/v1/me */
export interface MeInfo {
  operator: Operator;
  permissions: Record<string, boolean>;
}
