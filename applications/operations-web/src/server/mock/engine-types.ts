/**
 * Typed surface of the (untyped, verbatim-ported) mock engine in ./engine.ts.
 * Server-only. Route handlers should go through ./runtime + ./projections rather than
 * touching these arrays directly, and must never mutate them except via `actions`.
 */
import type {
  Alert,
  AppConfig,
  AuditEntry,
  CapacitySnapshot,
  ComponentDuration,
  ConfigPatch,
  DailyMetrics,
  DeadLetter,
  ErrorCategoryCount,
  FiveMinMetrics,
  GcsBucket,
  GcsListing,
  GcsObject,
  HourlyMetrics,
  Incident,
  LanguageConfig,
  LanguageSummary,
  LogEntry,
  Operator,
  Overview,
  PipelineVersionDetail,
  Replay,
  Reservation,
  ResultColumn,
  ResultFile,
  ResultRow,
  ResultsSummary,
  ServiceInfo,
  AlertPolicy,
  Stage,
  StageId,
  VersionComparison,
  Workflow,
  WorkflowEvent,
  WorkflowStatus,
  LangCode,
  Severity,
} from "@/lib/types";

export interface WorkflowFilter {
  language?: string | string[];
  status?: string | string[];
  pipeline_version?: string | string[];
  stage?: StageId;
  event_type?: string;
  batch_id?: string;
  error_code?: string;
  error_category?: string;
  from?: number;
  to?: number;
  hasRetries?: boolean;
  replay?: boolean;
  q?: string;
  sort?: "created_desc" | "created_asc" | "wait_desc" | "run_desc" | "updated_desc";
  limit?: number;
}

export interface LogFilter {
  workflow_id?: string;
  system?: boolean;
  severity?: Severity | Severity[];
  minSeverity?: Severity;
  service?: string | string[];
  component?: string | string[];
  attempt?: number;
  language?: string;
  trace_id?: string;
  pipeline_job_id?: string;
  error_code?: string;
  event_type?: string;
  from?: number;
  to?: number;
  q?: string;
  order?: "asc" | "desc";
  limit?: number;
}

export interface MockSimulator {
  tick(): unknown;
  setSpeed(n: number): MockSimulator;
  getSpeed(): number;
}

interface ActionOpts {
  operator?: string;
  reason?: string;
}

export interface MockEngine {
  meta: { baseNow: number; baseNowIso: string; timezone: string; project: string; region: string };
  now(): number;
  config: Omit<AppConfig, "drift"> & { drift(): AppConfig["drift"] };
  languages: LanguageConfig[];
  operators: Operator[];
  stages: Stage[];
  workflows: Workflow[];
  getWorkflow(id: string): Workflow | null;
  listWorkflows(f?: WorkflowFilter): Workflow[];
  workflowsByStage(): Record<StageId, Workflow[]>;
  stageDetail(
    id: string,
    opts?: { limit?: number },
  ): {
    stage: Stage;
    workflows: Workflow[];
    counts: Partial<Record<WorkflowStatus, number>>;
    gcsObjects: GcsObject[];
    events: WorkflowEvent[];
    logs: LogEntry[];
    metrics: Record<string, unknown>;
  } | null;
  events: {
    all: WorkflowEvent[];
    byWorkflow: Record<string, WorkflowEvent[]>;
    recent(n?: number, f?: { stage?: string; language?: string; severity?: string | string[]; names?: string | string[] }): WorkflowEvent[];
  };
  getEvents(id: string): WorkflowEvent[];
  logs: { all: LogEntry[]; system: LogEntry[]; query(f: LogFilter): LogEntry[] };
  getLogs(id: string, f?: LogFilter): LogEntry[];
  gcs: {
    buckets: GcsBucket[];
    objects: Record<string, GcsObject[]>;
    list(bucket: string, prefix?: string, opts?: { delimiter?: string; limit?: number }): GcsListing;
    get(bucket: string, name: string): GcsObject | null;
    read(bucket: string, name: string, opts?: { limit?: number }): string | null;
    sampleLines(workflowId: string, n?: number): string[];
  };
  dlq: DeadLetter[];
  replays: Replay[];
  getDeadLetter(id: string): DeadLetter | null;
  reservations: Reservation[];
  getCapacity(): CapacitySnapshot;
  overview(): Overview;
  metrics: {
    hourly: HourlyMetrics;
    fiveMin: FiveMinMetrics;
    daily: DailyMetrics[];
    errorCategories7d: ErrorCategoryCount[];
    componentDurations(): ComponentDuration[];
    versionComparison(): VersionComparison[];
    languageSummary(): LanguageSummary[];
  };
  alerts: Alert[];
  incidents: Incident[];
  audit: AuditEntry[];
  results: {
    columns: ResultColumn[];
    rows: ResultRow[];
    file: ResultFile & { filter?: unknown };
    files: (ResultFile & { filter?: unknown })[];
    byWorkflow(id: string): ResultRow[];
    summary(rows?: ResultRow[]): ResultsSummary;
    toCSV(rows: ResultRow[], opts?: { bom?: boolean; columns?: string[]; eol?: string }): string;
  };
  actions: {
    injectBatch(o?: { language?: LangCode; utteranceCount?: number; pipelineVersion?: string; priority?: number }): Workflow;
    cancelWorkflow(id: string, o?: ActionOpts): Workflow | null;
    replayDeadLetter(
      id: string,
      o?: ActionOpts & { pipelineVersion?: string; priority?: number },
    ): { deadLetter: DeadLetter; replay: Replay; workflow: Workflow } | null;
    closeDeadLetter(id: string, o?: { operator?: string; resolution?: string }): DeadLetter | null;
    assignDeadLetter(id: string, operatorId: string | null): DeadLetter | null;
    updateLanguage(code: LangCode, patch: Partial<LanguageConfig>, o?: ActionOpts): LanguageConfig | null;
    setGlobalCapacity(n: number, o?: ActionOpts): { maxConcurrent: number; maxStartsPerMinute: number };
    setGlobalStartsPerMinute(n: number, o?: ActionOpts): { maxConcurrent: number; maxStartsPerMinute: number };
    updateConfig(patch: ConfigPatch, o?: ActionOpts): string[];
    acknowledgeAlert(id: string, operatorId?: string): Alert | null;
    resolveAlert(id: string): Alert | null;
  };
  on(name: string, cb: (payload: never) => void): () => void;
  off(name: string, cb: (payload: never) => void): void;
  createSimulator(opts?: { seed?: number; tickMs?: number; speed?: number }): MockSimulator;
  _internal: {
    audit(
      ts: number,
      actor: string,
      action: string,
      target: string,
      before: unknown,
      after: unknown,
      reason?: string | null,
    ): AuditEntry;
    pushAudit(a: AuditEntry): AuditEntry;
    refreshRuntime(): void;
    emit(name: string, payload: unknown): void;
    clock: { now: number };
    OP: Record<string, Operator>;
    LANG: Record<LangCode, LanguageConfig>;
    WF: Record<string, Workflow>;
    gcsGet(bucket: string, name: string): GcsObject | null;
    inputLine(row: ResultRow, wf: Workflow, i: number): string;
    genUtterances(wf: Workflow): ResultRow[];
    RESULTS_BY_WF: Record<string, ResultRow[]>;
    PIPELINE_VERSIONS: PipelineVersionDetail[];
    SERVICES: ServiceInfo[];
    ALERT_POLICIES: AlertPolicy[];
    kstDate(ts: number): string;
    isoKst(ts: number): string;
    BASE_NOW: number;
    TODAY_START: number;
  };
}
