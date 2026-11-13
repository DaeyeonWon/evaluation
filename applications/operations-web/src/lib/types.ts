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
  buckets: { input: string; artifacts: string; results: string; /** raw utterance audio referenced by input JSONL `audio_uri` (read by Preprocess, not listed in the GCS browser) */ audio?: string };
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
  /** LEGACY six-phase id */
  node: ComponentId | null;
  attempt: number;
  /** pipeline-id path of the failing leaf, e.g. "response-judge/policy-guard/pii_scan" (null for timeouts/cancel) */
  path?: string | null;
  /** node-id path, e.g. "response_judge/safety_check/pii_scan" */
  node_path?: string | null;
  component?: string | null;
  /** job (root or child) where the failure originated */
  pipeline_job_id?: string | null;
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
  /** root pipeline node ids mapped onto this legacy phase (new pipelines; may be empty → SKIPPED) */
  mapped_nodes?: string[];
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
  /** LEGACY six-phase projection of the root PipelineJob DAG (use GET /pipeline-jobs/[jobId] for the real DAG). */
  dag: DagNode[];
  /** root pipeline id of this attempt (e.g. bixby-eval-full) */
  pipeline_id: string;
  /** pipeline-id path of the failing leaf, e.g. "response-judge/policy-guard/pii_scan" */
  failed_path: string | null;
  /** node-id path of the failing leaf, e.g. "response_judge/safety_check/pii_scan" */
  failed_node_path: string | null;
  failed_component: string | null;
  /** PipelineJob id (root or child) where the failure originated */
  failed_job_id: string | null;
  /** root job id + every child job id of this attempt (depth-first) */
  job_ids: string[];
}

/** GET /api/v1/workflows/[id] (full document). */
export interface Workflow {
  workflow_id: string;
  batch_id: string;
  language: LangCode;
  status: WorkflowStatus;
  stage: StageId;
  /** root pipeline from the registry (src/config/domain.ts), e.g. bixby-eval-full */
  pipeline_id: string;
  pipeline_version: PipelineVersion;
  /** model under test, e.g. bixby-nlu-2026.10 (independent of pipeline_version) */
  model_version: string;
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
  /** LEGACY six-phase DAG of the latest attempt */
  dag: DagNode[];
  /** LEGACY six-phase id of the running/failed root node */
  current_node: ComponentId | null;
  /** node-id path of the deepest running (or failed) leaf, e.g. "nlu_eval/slot_fill" */
  current_node_path: string | null;
  /** job id (root or child) that owns current_node_path */
  current_job_id: string | null;
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
  pipeline_id: string;
  pipeline_version: PipelineVersion;
  model_version: string;
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
  current_node_path: string | null;
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
  /** job that emitted the event (child job id for sub-pipeline components) */
  pipeline_job_id: string | null;
  /** root PipelineJob of the attempt ({workflow_id}-cycle-{c}-attempt-{a}) */
  root_pipeline_job_id: string | null;
  /** pipeline id of the emitting job */
  pipeline_id: string | null;
  /** leaf component id for TASK_* events, else null */
  component: string | null;
  /** node-id path inside the root job, e.g. "response_judge/safety_check/pii_scan" */
  node_path: string | null;
  correlation_id: string | null;
  trace_id: string | null;
  payload: Record<string, unknown>;
  /**
   * Monotonic emission order within one engine/server instance (optional; not a timestamp order —
   * seeded history is generated per workflow). Use it to order events with equal `ts`.
   */
  seq?: number;
  /**
   * What caused this event: the command id when known (e.g. `replay_id` for REPLAY_*), otherwise the
   * `event_id` of the previous event of the same Workflow. null for the first event. Optional.
   */
  causation_id?: string | null;
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
  /** job that emitted the log (child job id for sub-pipeline components) */
  pipeline_job_id: string | null;
  root_pipeline_job_id: string | null;
  pipeline_id: string | null;
  node_path: string | null;
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
  /** pipeline-id path of the failing leaf (e.g. "response-judge/policy-guard/pii_scan") */
  failed_path: string | null;
  failed_component: string | null;
  failed_job_id: string | null;
  attempts: number;
  pipeline_id: string;
  pipeline_version: PipelineVersion;
  model_version: string;
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
/** Live KPI block (always "today" in KST + live gauges). Carried by SSE `tick.kpis`. */
export interface OverviewKpis {
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
  errorDistribution7d: Record<FailureCategory, number>;
  openAlerts: number;
}

/** KPIs computed over the requested range (GET /overview?range=…). */
export interface RangeKpis {
  /** workflows whose lifetime overlaps the range */
  workflows: number;
  created: number;
  completed: number;
  succeeded: number;
  /** DEAD_LETTERED + TIMED_OUT completed in range */
  failed: number;
  deadLettered: number;
  timedOut: number;
  cancelled: number;
  successRate: number | null;
  retries: number;
  /** share of workflows created in range with ≥2 attempts */
  retryRate: number | null;
  avgProcessingMs: number;
  p95ProcessingMs: number;
  avgWaitMs: number;
  utterancesEvaluated: number;
  utterancePassRate: number | null;
  /** attempt-level failures (completed in range) by category */
  errorDistribution: Record<FailureCategory, number>;
  /** current status of workflows overlapping the range */
  statusDistribution: Record<WorkflowStatus, number>;
  byLanguage: Partial<Record<LangCode, { created: number; succeeded: number; failed: number; successRate: number | null }>>;
  byPipeline: Record<string, { runs: number; succeeded: number; failed: number; running: number; successRate: number | null }>;
  dlqCreated: number;
  alertsOpened: number;
}

/** GET /api/v1/overview — legacy "today" KPIs + live state + ranged KPIs. */
export interface Overview extends OverviewKpis {
  /** LIVE status distribution of the whole registry (not ranged) */
  statusDistribution: Record<WorkflowStatus, number>;
  capacity: CapacitySnapshot;
  range: ResolvedRange;
  inRange: RangeKpis;
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
  /** leaf component id from the registry (preprocess, intent_classify, llm_judge, pii_scan, …) */
  component: string;
  label: string;
  labelKo: string;
  byLanguage: Partial<Record<LangCode, DurationStat>>;
  byVersion: Record<PipelineVersion, DurationStat>;
  /** by root pipeline id */
  byPipeline?: Record<string, DurationStat>;
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
  /** utterances evaluated in range (legacy name) */
  utterancesToday: number;
  passRateToday: number | null;
  capacity: LanguageCapacity;
  /** pipelines completed in range per hourly metrics (legacy name) */
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
  range?: ResolvedRange;
}

/** GET /api/v1/analytics/quality (success & retry rates + durations, hourly) */
export interface QualitySeries {
  ts: EpochMs[];
  successRate: number[];
  retryRate: number[];
  avgDurationSec: number[];
  p95DurationSec: number[];
  range?: ResolvedRange;
}

/** GET /api/v1/analytics/errors */
export interface ErrorAnalytics {
  top: ErrorCategoryCount[];
  hourly: { ts: EpochMs[]; byCategory: Record<FailureCategory, number[]> };
  /** attempt-level error codes from the workflow registry, most frequent first */
  topErrorCodes: { code: string; category: FailureCategory; count: number; lastAt: EpochMs; paths?: Record<string, number> }[];
  range?: ResolvedRange;
}

/** GET /api/v1/analytics/cost */
export interface CostAnalytics {
  daily: { date: string; partial: boolean; costUsd: DailyMetrics["costUsd"] }[];
  /** total over the days intersecting the range (legacy name) */
  total7d: number;
  byComponent7d: Record<Exclude<keyof DailyMetrics["costUsd"], "total">, number>;
  range?: ResolvedRange;
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
  range?: ResolvedRange;
  pipelineSummary?: PipelineSummary[];
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
  /** Idempotency-Key of the API request that made the change (null: seeded/system entries, reads) */
  idempotency_key: string | null;
  /** User-Agent of that request (null: seeded/system entries) */
  user_agent: string | null;
  /** outcome: success · denied (403, Hermes access refused) · error */
  result: AuditResult;
}

export type AuditResult = "success" | "denied" | "error";

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
  pipeline_id: string;
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
  byModelVersion: Record<string, RateStat>;
  byPipeline: Record<string, RateStat>;
}

/** GET /api/v1/results */
export interface ResultsPage {
  rows: ResultRow[];
  total: number;
  page: number;
  pageSize: number;
  aggregates: ResultsAggregates;
  file: ResultFile;
  range: ResolvedRange;
  /** facet counts over rows in range BEFORE the facet's own filter is applied is NOT done — counts are over the filtered set */
  facets: {
    model_version: Record<string, number>;
    pipeline_id: Record<string, number>;
    version: Record<string, number>;
    language: Partial<Record<LangCode, number>>;
  };
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
  range?: ResolvedRange;
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
  /** stage-specific KPI bag (see docs/data-contract.md; "…Today" keys are computed over the range) */
  metrics: Record<string, unknown>;
  /** stage-relevant objects for the workflows in this stage within range (filtered by ?q=) */
  objects: FileSearchHit[];
  range: ResolvedRange;
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
  kpis: OverviewKpis;
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
  /** root or child PipelineJob status change */
  job: PipelineJobTransition;
  /**
   * First message of every connection. `lastEventId` = SSE id at connect time; `resumed` = the server
   * replayed missed messages after the client's Last-Event-ID; `resync` = it could not (unknown or
   * expired id) and the client should refetch its data.
   */
  hello: { sim: SimState; serverTime: number; lastEventId?: string; resumed?: boolean; resync?: boolean };
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
    /** user-presentable, in the request's locale (cookie console_locale → Accept-Language → default) */
    message: string;
    /** `errors.*` message key when the message came from one (e.g. "domain.workflowNotFound") */
    key?: string;
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
  /** available data window: earliest seeded data .. virtual now */
  dataWindow: { earliest: EpochMs; now: EpochMs; earliestIso: string; nowIso: string; historyDays: number };
  rangePresets: RangePresetInfo[];
  pipelines: PipelineDefinition[];
  models: ModelVersionInfo[];
  components: Record<string, ComponentSpec>;
}

// ─────────────────────────────────────────────── API response shapes (endpoint-specific) ──
/** GET /api/v1/workflows */
export interface WorkflowListResponse extends Paginated<WorkflowSummary> {
  /** facet counts over the FILTERED set (before pagination) */
  facets: {
    status: Partial<Record<WorkflowStatus, number>>;
    language: Partial<Record<LangCode, number>>;
    version: Record<string, number>;
    pipeline_id: Record<string, number>;
    model_version: Record<string, number>;
  };
  range: ResolvedRange;
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
  /** present on GET /logs (ranged); absent on per-workflow logs */
  range?: ResolvedRange;
}

/** GET /api/v1/dead-letters */
export interface DeadLetterList extends Paginated<DeadLetter> {
  facets: {
    status: Partial<Record<DlqStatus, number>>;
    category: Partial<Record<FailureCategory, number>>;
    language: Partial<Record<LangCode, number>>;
  };
  range: ResolvedRange;
  /** DLQ items NOT in range that still need attention */
  outsideRange: { pendingReview: number; approved: number; replaying: number };
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

// ═══════════════════════════════════════════════ time range (see src/lib/time-range.ts) ══
export type RangePreset = "today" | "yesterday" | "1h" | "6h" | "24h" | "7d" | "30d";
/** A range request. `last` = any "last N hours/days" (e.g. legacy 12h / 48h). */
export type RangeSpec =
  | { kind: "preset"; preset: RangePreset }
  | { kind: "last"; amount: number; unit: "h" | "d" }
  | { kind: "custom"; from: EpochMs; to: EpochMs };
/** Resolved against the VIRTUAL clock; inclusive bounds (from ≤ ts ≤ to). */
export interface ResolvedRange {
  from: EpochMs;
  to: EpochMs;
  /** Korean label, e.g. "오늘 (11월 12일)", "최근 7일", "2026-11-10 09:00 ~ 2026-11-12 14:30" */
  label: string;
  /** "today" | … | "custom" | "12h" (last-N) */
  preset: string;
  fromIso: string;
  toIso: string;
}
export interface RangePresetInfo {
  id: RangePreset;
  label: string;
  labelEn: string;
}
/** Envelope used by every ranged endpoint whose payload is a list. */
export interface RangedList<T> {
  items: T[];
  total: number;
  range: ResolvedRange;
}

// ═══════════════════════════════════════════════ domain config (src/config/domain.ts) ══
export interface ComponentOutputSpec {
  name: string;
  /** file name under pipeline_root/{jobId}/{nodeId}/ */
  file: string;
  type: string;
  /** size model: bytesPerUtterance × n + fixedBytes */
  bytesPerUtterance?: number;
  fixedBytes?: number;
}
export type ComponentMetric = "none" | "intent" | "slot" | "response" | "latency" | "asr" | "safety" | "pass";
export interface ComponentSpec {
  id: string;
  label: string;
  labelKo: string;
  /** event name stem: TASK_<ev>_STARTED / _COMPLETED / _FAILED */
  ev: string;
  /** relative nominal duration (critical-path weight) */
  weight: number;
  machineType: string;
  cpu: number;
  gpu: { type: string; count: number } | null;
  memGb: number;
  image: string;
  description: string;
  /** which utterance rate drives pass/fail progress counters */
  metric: ComponentMetric;
  outputs: ComponentOutputSpec[];
  /** true → writes results.csv to the results bucket + BigQuery (instead of artifacts) */
  persists?: boolean;
}
export type PipelineNodeDef =
  | { id: string; kind: "component"; component: string; deps: string[]; label?: string; legacyPhase?: ComponentId }
  | { id: string; kind: "subpipeline"; ref: { pipeline: string; version: string }; deps: string[]; label?: string; legacyPhase?: ComponentId };
export interface PipelineVersionDef {
  version: string;
  status: "STABLE" | "CANARY" | "DEPRECATED";
  /** ISO-8601 */
  releasedAt: string;
  notes: string;
  nodes: PipelineNodeDef[];
}
export interface PipelineDef {
  id: string;
  label: string;
  labelKo: string;
  /** root = can be scheduled as a workflow; sub = only called from other pipelines */
  kind: "root" | "sub";
  description: string;
  /** relative pipeline runtime factor vs bixby-eval-full (root only) */
  durationFactor?: number;
  /** assignment weight for new batches (root only) */
  mixWeight?: number;
  /** languages allowed (root only; default: all) */
  languages?: LangCode[];
  versions: PipelineVersionDef[];
}
export interface ModelVersionInfo {
  id: string;
  label: string;
  status: "PRODUCTION" | "CANDIDATE" | "RETIRED";
  releasedAt: string;
  /** pass-probability adjustment */
  passAdj: number;
  /** share of new batches once released (relative weights among released models) */
  weight: number;
  notes: string;
}
export interface DomainLanguage extends LanguageConfig {
  /** base PASS probability */
  basePass: number;
  /** avg JSONL bytes per utterance */
  bytesPerUtterance: number;
  /** nominal pipeline minutes for a full batch */
  baseMinutes: number;
  /** peak pipelines/hour (metrics generator) */
  peakPerHour: number;
  costPerRunUsd: number;
  /** relative share of new batches */
  mixWeight: number;
}
export interface PipelineReleaseInfo {
  version: string;
  status: "DEPRECATED" | "STABLE" | "CANARY";
  trafficPct: number;
  releasedAt: string;
  imageTag: string;
  judgeModel: string;
  modelUnderTest: string;
  notes: string;
  /** pass-probability adjustment of this pipeline release */
  passAdj: number;
  costPerRunUsd: number;
}
export interface DomainConfig {
  id: string;
  name: string;
  project: { id: string; number: string; region: string; environment: string; console: string };
  timezone: string;
  /** seed "now" of the demo scenario (ISO, KST); the day-loop re-anchors to HH:MM of the next day */
  baseNow: string;
  /** days of seeded history (30d preset) */
  historyDays: number;
  buckets: { input: string; artifacts: string; results: string; /** raw utterance audio referenced by input JSONL `audio_uri` (read by Preprocess, not listed in the GCS browser) */ audio?: string };
  bigquery: { dataset: string; resultsTable: string; eventsTable: string };
  languages: DomainLanguage[];
  capacity: {
    global: { maxConcurrent: number; maxStartsPerMinute: number };
    /** Terraform-declared defaults (flattened keys) → config drift */
    terraformDefaults: Record<string, unknown>;
    gpuQuota: number;
  };
  stages: Stage[];
  stageEdges: StageEdge[];
  capsules: Capsule[];
  devices: { id: string; weight: number; adj: number; lat: [number, number] }[];
  models: ModelVersionInfo[];
  /** release train shared by root pipelines (v1.0 / v1.1 / v1.2-rc) */
  releases: PipelineReleaseInfo[];
  defaultRelease: string;
  components: Record<string, ComponentSpec>;
  pipelines: PipelineDef[];
}

// ═══════════════════════════════════════════════ pipelines / jobs ══
export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "SKIPPED";
export interface PipelineEdge {
  from: string;
  to: string;
}
/** A registry definition with its DAG (GET /pipelines, /meta). */
export interface PipelineDefinition {
  id: string;
  label: string;
  labelKo: string;
  kind: "root" | "sub";
  description: string;
  versions: {
    version: string;
    status: string;
    releasedAt: EpochMs;
    notes: string;
    nodes: (PipelineNodeDef & { label: string; labelKo: string })[];
    edges: PipelineEdge[];
    /** distinct leaf component ids reachable (incl. nested sub-pipelines) */
    leafComponents: string[];
    /** sub-pipeline references "id@version" (direct children) */
    subpipelines: string[];
    templateUri: string;
  }[];
  /** root pipelines that call this one (sub only) */
  usedBy: string[];
}
export interface DurationStats {
  n: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}
/** GET /pipelines row */
export interface PipelineSummary {
  id: string;
  label: string;
  labelKo: string;
  kind: "root" | "sub";
  versions: string[];
  latestVersion: string;
  /** runs (root jobs, or child-job invocations for sub pipelines) overlapping the range */
  runs: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  successRate: number | null;
  avgDurationMs: number;
  p95DurationMs: number;
  byVersion: Record<string, { runs: number; succeeded: number; failed: number; successRate: number | null }>;
  lastRunAt: EpochMs | null;
}
export interface NodeAggregate {
  node_id: string;
  kind: "component" | "subpipeline";
  component: string | null;
  ref: { pipeline_id: string; version: string } | null;
  label: string;
  labelKo: string;
  deps: string[];
  counts: Record<JobStatus, number>;
  duration: DurationStats;
  topError: { code: string; count: number; path: string | null } | null;
}
/** GET /pipelines/[id]?version= */
export interface PipelineDetail {
  definition: PipelineDefinition;
  version: string;
  nodes: PipelineDefinition["versions"][number]["nodes"];
  edges: PipelineEdge[];
  nodeStats: NodeAggregate[];
  summary: PipelineSummary;
  recentRuns: PipelineRun[];
  range: ResolvedRange;
}
/** A run of a pipeline = one job (root job for root pipelines; child job for sub pipelines). */
export interface PipelineRun {
  job_id: string;
  root_job_id: string;
  parent_job_id: string | null;
  workflow_id: string;
  attempt: number;
  language: LangCode;
  pipeline_id: string;
  pipeline_version: string;
  model_version: string;
  status: JobStatus;
  start_at: EpochMs | null;
  end_at: EpochMs | null;
  duration_ms: number | null;
  error: { code: string; category: FailureCategory; path: string | null; message: string } | null;
}
export interface PipelineRunsPage extends Paginated<PipelineRun> {
  range: ResolvedRange;
  facets: { status: Partial<Record<JobStatus, number>>; version: Record<string, number>; language: Partial<Record<LangCode, number>> };
}
/** Node of a concrete PipelineJob DAG. */
export interface JobNode {
  id: string;
  kind: "component" | "subpipeline";
  /** leaf component id (component nodes) */
  component: string | null;
  /** referenced definition (subpipeline nodes) */
  ref: { pipeline_id: string; version: string } | null;
  /** child job id = {thisJobId}.{node id} (subpipeline nodes) */
  child_job_id: string | null;
  /** node-id path inside the ROOT job */
  node_path: string;
  label: string;
  labelKo: string;
  deps: string[];
  status: JobStatus;
  start_at: EpochMs | null;
  end_at: EpochMs | null;
  duration_ms: number | null;
  task_id: string;
  progress: { processed: number; total: number; pct: number; pass: number; fail: number };
  resources: DagNode["resources"];
  image: string | null;
  inputs: Artifact[];
  outputs: Artifact[];
  error: { code: string; category: FailureCategory; message: string; path: string | null } | null;
  description: string;
  legacy_phase: ComponentId | null;
}
export interface PipelineJobRef {
  job_id: string;
  pipeline_id: string;
  pipeline_version: string;
  node_id: string;
  status: JobStatus;
}
/** GET /pipeline-jobs/[jobId] (also nodes of the run tree) */
export interface PipelineJob {
  job_id: string;
  root_job_id: string;
  parent_job_id: string | null;
  /** node id in the parent job (null for root) */
  parent_node_id: string | null;
  depth: number;
  workflow_id: string;
  attempt: number;
  language: LangCode;
  pipeline_id: string;
  pipeline_version: string;
  model_version: string;
  vertex_resource: string;
  status: JobStatus;
  start_at: EpochMs | null;
  end_at: EpochMs | null;
  duration_ms: number | null;
  progress: { processed: number; total: number; pct: number };
  nodes: JobNode[];
  edges: PipelineEdge[];
  children: PipelineJobRef[];
  error: JobNode["error"];
}
export interface PipelineJobTree extends Omit<PipelineJob, "children"> {
  children: PipelineJobTree[];
}
/** GET /pipeline-jobs/[jobId] */
export interface PipelineJobDetail extends PipelineJob {
  /** ready-made filters for GET /logs and GET /events scoped to this job */
  filters: { logs: { pipeline_job_id: string; job_scope: "self" | "tree" }; events: { pipeline_job_id: string; job_scope: "self" | "tree" } };
  recentLogs: LogEntry[];
  recentEvents: WorkflowEvent[];
  ancestors: PipelineJobRef[];
}
/** GET /workflows/[id]/pipeline-runs */
export interface WorkflowPipelineRuns {
  workflow_id: string;
  pipeline_id: string;
  pipeline_version: string;
  attempts: { attempt: number; status: AttemptStatus; root: PipelineJobTree }[];
}
/** SSE `job` */
export interface PipelineJobTransition {
  job_id: string;
  root_job_id: string;
  parent_job_id: string | null;
  workflow_id: string;
  language: LangCode;
  pipeline_id: string;
  pipeline_version: string;
  node_path: string | null;
  depth: number;
  from: JobStatus | null;
  to: JobStatus;
  at: EpochMs;
  error_code: string | null;
  error_path: string | null;
}

// ═══════════════════════════════════════════════ file search ══
export type FileHitKind = "gcs_object" | "pubsub_message" | "firestore_doc" | "reservation" | "execution" | "dlq_entry";
export interface FileSearchHit {
  stage: StageId;
  kind: FileHitKind;
  bucket: string;
  /** object name (relative to bucket) */
  object: string;
  uri: string;
  generation: string;
  size: number;
  updated: EpochMs;
  workflow_id: string | null;
  batch_id: string | null;
  language: LangCode | null;
  pipeline_job_id: string | null;
  /** current workflow status (null for objects without a workflow) */
  current_status: WorkflowStatus | null;
  /** non-GCS reference (Pub/Sub message id, Firestore doc path, reservation id, execution id, DLQ id) */
  ref: string | null;
  match_ranges: { field: "object" | "workflow_id" | "batch_id"; start: number; end: number }[];
}
export interface FileSearchResult {
  q: string;
  items: FileSearchHit[];
  total: number;
  limit: number;
  byStage: Partial<Record<StageId, number>>;
  range: ResolvedRange;
}

// ═══════════════════════════════════════════════ capacity history ══
export interface CapacityHistory {
  granularity: "5m" | "1h" | "6h";
  ts: EpochMs[];
  active: Record<LangCode, number[]>;
  queue: Record<LangCode, number[]>;
  /** current configured limit (constant series) */
  limit: Record<LangCode, number>;
  globalActive: number[];
  globalLimit: number;
  range: ResolvedRange;
}
