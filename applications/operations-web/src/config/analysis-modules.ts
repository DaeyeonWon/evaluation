/**
 * Analysis-module registry — the single typed source for "which deep-analysis feature needs which module".
 * Isomorphic and dependency-free (no `next`, no server imports): read by the Deep Analysis (/issues/**) module
 * badges, the /issues/modules page and the docs. Display text lives in the `modules` i18n namespace, keyed by the
 * ids below (modules.mod.<M>.*, modules.col.*, modules.ref.<R>.*, modules.feature.<feature id>).
 *
 * Three layers (the user's framing):
 *   1. 단건 분석 — per utterance, ALREADY emitted by the pipeline: result + judge_reason + failure_reason (6 codes).
 *   2. 집계 통계 — GROUP BY / window aggregation over result rows + reference tables → 품질 대시보드 (/quality), no module.
 *   3. 교차·시계열 분석 — across utterances and across time → 심층 분석 (/issues), needs modules M1–M9.
 *
 * Three buckets:
 *   A. PIPELINE_COLUMNS  — result-CSV columns the pipeline must emit (status: existing | maybe-add)
 *   B. REFERENCE_TABLES  — R1–R6, owned by product/data teams as tables, not code
 *   C. ANALYSIS_MODULES  — M1–M9 compute (+ FUTURE_MODULES M10/M11, mention only)
 *
 * Discriminating test: a feature needs NO module if it is GROUP BY / window aggregation over result rows plus static
 * lookups. It needs a module for cross-day identity, weighted scoring, semantic classification of judge reasons,
 * novelty vs a baseline, capability knowledge, narrative generation, persisted lifecycle state or traffic weighting.
 */

// ───────────────────────────────────────── bucket A · pipeline columns ──
/** existing = the pipeline already emits it today · maybe = may still need adding / enriching in production */
export type ColumnStatus = "existing" | "maybe";
export interface PipelineColumn {
  id: string;
  status: ColumnStatus;
  /** the per-row analysis the pipeline already produces (layer 1) — highlighted on the modules page */
  core?: boolean;
}
export const PIPELINE_COLUMNS: readonly PipelineColumn[] = [
  { id: "utterance_id", status: "existing" },
  { id: "workflow_id", status: "existing" },
  { id: "batch_id", status: "existing" },
  { id: "pipeline_job_id", status: "existing" },
  { id: "language", status: "existing" },
  { id: "market", status: "existing" },
  { id: "device_type", status: "maybe" },
  { id: "bixby_version", status: "maybe" },
  { id: "one_ui_version", status: "existing" },
  { id: "os_version", status: "existing" },
  { id: "capsule", status: "existing" },
  { id: "intent_expected", status: "existing" },
  { id: "intent_predicted", status: "existing" },
  { id: "utterance_text", status: "existing" },
  { id: "asr_text", status: "existing" },
  { id: "expected_response", status: "existing" },
  { id: "actual_response", status: "existing" },
  { id: "judge_score", status: "existing" },
  { id: "result", status: "existing", core: true },
  { id: "judge_reason", status: "existing", core: true },
  { id: "failure_reason", status: "existing", core: true },
  { id: "latency_ms", status: "existing" },
  { id: "model_version", status: "existing" },
  { id: "pipeline_id", status: "existing" },
  { id: "pipeline_version", status: "existing" },
  { id: "eval_timestamp", status: "existing" },
  { id: "utterance_pattern", status: "maybe" },
];
/** the ~6 per-row failure codes the pipeline already emits (failure_reason) */
export const FAILURE_CODES = ["INTENT_MISMATCH", "SLOT_ERROR", "RESPONSE_QUALITY", "TIMEOUT", "ASR_ERROR", "POLICY_VIOLATION"] as const;

// ───────────────────────────────────────── bucket B · reference tables ──
export const REF_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
export type RefId = (typeof REF_IDS)[number];
export interface ReferenceTable {
  id: RefId;
  /** key → value, shown verbatim (technical) */
  key: string;
  /** where the mock keeps it today (as code; production: a maintained table) */
  mock: string;
}
export const REFERENCE_TABLES: readonly ReferenceTable[] = [
  { id: "R1", key: "device_type → division", mock: "src/config/domain.ts deviceDivision" },
  { id: "R2", key: "market → region", mock: "src/config/domain.ts marketRegion" },
  { id: "R3", key: "capsule / intent → agent_function", mock: "issues-engine.ts fnOfIntent" },
  { id: "R4", key: "bixby_version × device × region → supported features", mock: "src/config/domain.ts capabilities" },
  { id: "R5", key: "feature name → launch date", mock: "issues-taxonomy.ts (new-feature term rules)" },
  { id: "R6", key: "failure_reason → severity class", mock: "issues-engine.ts severityClassOf" },
];

// ───────────────────────────────────────── bucket C · analysis modules ──
export const MODULE_IDS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export const FUTURE_MODULE_IDS = ["M10", "M11"] as const;
export type FutureModuleId = (typeof FUTURE_MODULE_IDS)[number];

export type ModuleTier = "mvp" | "enhancer";
/** mock = rule-based simulation inside the mock engine (src/server/services/issues*.ts) · none = not implemented · planned = future */
export type ModuleStatus = "mock" | "none" | "planned";

export interface AnalysisModule {
  id: ModuleId;
  slug: string;
  tier: ModuleTier;
  status: ModuleStatus;
  /** bucket A columns read */
  columns: readonly string[];
  /** bucket B tables read */
  refs: readonly RefId[];
  /** upstream modules whose output it requires (docs/analysis-modules.md §3.0 "선행 모듈") */
  upstream: readonly ModuleId[];
  /** optional upstream modules — used when present, NOW rule or 0 otherwise (the doc's parenthesised entries) */
  upstreamOptional?: readonly ModuleId[];
  /** output fields (API / contract names, technical) */
  outputs: readonly string[];
  /** where the mock simulates it today */
  mock: readonly string[];
  /** the most important gap (M9) — gets the callout */
  critical?: boolean;
}

export const ANALYSIS_MODULES: readonly AnalysisModule[] = [
  {
    id: "M1",
    slug: "issue-clustering",
    tier: "mvp",
    status: "mock",
    columns: ["result", "failure_reason", "intent_expected", "intent_predicted", "judge_reason", "agent_function", "eval_timestamp"],
    refs: ["R3"],
    upstream: [],
    outputs: ["issue.id", "issue.signature", "issue.count", "issue.first_seen / last_seen", "issue.results_query", "issue.similar[]"],
    mock: ["issues-engine.ts groupKey · compute (signature clusters)", "issues-store.ts issueIdOf (hash of the signature)"],
  },
  {
    id: "M2",
    slug: "baseline-anomaly",
    tier: "mvp",
    status: "mock",
    columns: ["result", "eval_timestamp", "model_version", "bixby_version", "pipeline_version", "division"],
    refs: ["R1"],
    upstream: ["M1"],
    outputs: ["baseline {mode, from, to, sufficient}", "factor.trend (z)", "issue.regression", "issue.bixby_regression", "issue.novelty"],
    mock: ["issues-engine.ts baselineFor · compute (Poisson z, one-sided z ≥ 1.64)", "issues.ts bixbyCells"],
  },
  {
    id: "M3",
    slug: "criticality-scoring",
    tier: "mvp",
    status: "mock",
    columns: ["market", "device_type", "language", "failure_reason"],
    refs: ["R6"],
    upstream: ["M1", "M2"],
    upstreamOptional: ["M4", "M6", "M9"],
    outputs: ["issue.score (0–100)", "issue.severity (P0–P3)", "issue.factors[6]", "issue.reasons[]"],
    mock: ["issues-engine.ts FACTOR_WEIGHTS · compute (volume 20 · severity 25 · trend 15 · regression 15 · reach 10 · novelty 15)"],
  },
  {
    id: "M4",
    slug: "taxonomy-classifier",
    tier: "enhancer",
    status: "mock",
    columns: ["failure_reason", "judge_reason", "intent_expected", "intent_predicted", "agent_function", "utterance_pattern"],
    refs: ["R3", "R6"],
    upstream: ["M1"],
    upstreamOptional: ["M2", "M5"],
    outputs: ["issue.category", "issue.user_impact_type", "issue.dev_miss_type", "issue.severity_class", "*_reason"],
    mock: ["issues-taxonomy.ts classify (rule cascade)", "issues-engine.ts severityClassOf"],
  },
  {
    id: "M5",
    slug: "capability-registry",
    tier: "enhancer",
    status: "mock",
    columns: ["intent_expected", "device_type", "bixby_version", "market", "failure_reason"],
    refs: ["R4", "R5"],
    upstream: [],
    outputs: ["issue.must_handle", "dev_miss_type = out_of_scope", "must_handle_reason"],
    mock: ["issues-taxonomy.ts capabilityOf · supportOf"],
  },
  {
    id: "M6",
    slug: "pattern-novelty",
    tier: "enhancer",
    status: "mock",
    columns: ["utterance_text", "asr_text", "language", "utterance_pattern", "intent_expected", "eval_timestamp"],
    refs: ["R5"],
    upstream: [],
    upstreamOptional: ["M1"],
    outputs: ["patterns[] {template, kind, fail_rate, examples}", "novel_terms[]", "factor.novelty input"],
    mock: ["issues-text.ts tokens · terms · patternKind · isCodeSwitch", "issues-engine.ts patternsOf"],
  },
  {
    id: "M7",
    slug: "insight-narrative",
    tier: "enhancer",
    status: "mock",
    columns: [],
    refs: [],
    upstream: ["M1", "M2", "M3", "M4", "M5", "M6"],
    upstreamOptional: ["M9"],
    outputs: ["insights[] {kind, text, evidence}", "report headline / standfirst", "Markdown brief"],
    mock: ["issues.ts buildInsights (templates)", "issues.ts issuesMarkdown"],
  },
  {
    id: "M8",
    slug: "issue-store",
    tier: "mvp",
    status: "mock",
    columns: [],
    refs: [],
    upstream: ["M1"],
    outputs: ["issue.state {status, owner, ticket_id, note, history[]}", "PATCH /issues/{id}", "live stream (new_critical)"],
    mock: ["issues-store.ts (in-memory, seeded; resets on restart)"],
  },
  {
    id: "M9",
    slug: "traffic-weighting",
    tier: "enhancer",
    status: "none",
    columns: ["intent_expected", "device_type", "market", "bixby_version"],
    refs: ["R1", "R2"],
    upstream: ["M1"],
    upstreamOptional: ["M2"],
    outputs: ["issue.affected_users (est.)", "issue.traffic_share", "market-impact rank"],
    mock: [],
    critical: true,
  },
];
export const MODULES: Record<ModuleId, AnalysisModule> = Object.fromEntries(ANALYSIS_MODULES.map((m) => [m.id, m])) as Record<ModuleId, AnalysisModule>;

export interface FutureModule {
  id: FutureModuleId;
  slug: string;
  status: "planned";
}
export const FUTURE_MODULES: readonly FutureModule[] = [
  { id: "M10", slug: "session-analysis", status: "planned" },
  { id: "M11", slug: "user-dedup", status: "planned" },
];

// ───────────────────────────────────────── feature → module map ──
export const FEATURE_PAGES = ["triage", "categories", "analysis", "report", "detail", "export"] as const;
export type FeaturePage = (typeof FEATURE_PAGES)[number];

export interface FeatureDeps {
  page: FeaturePage;
  modules: readonly ModuleId[];
  /** traffic-sensitive wording (시장 영향 / affected users): the ranking is eval-set based until M9 exists */
  traffic?: boolean;
  /** the row-aggregation part is available without modules in 품질 대시보드 (/quality) */
  quality?: boolean;
  /** has a note (modules.featureNote.<id>) */
  note?: boolean;
}

/**
 * Every Issue Report feature, built from the components that render it (field-based: a feature depends on a module
 * iff it renders a field that only exists after that module). Order = page order.
 */
export const FEATURES = {
  // ── Triage (/issues) ──
  "triage.lens.user": { page: "triage", modules: ["M1", "M3", "M4"], traffic: true },
  "triage.lens.dev": { page: "triage", modules: ["M1", "M2", "M4", "M5"] },
  "triage.ribbon": { page: "triage", modules: ["M1", "M2", "M3", "M8"] },
  insights: { page: "triage", modules: ["M2", "M7"] },
  newPatterns: { page: "triage", modules: ["M2", "M6"] },
  "triage.grouping.impact": { page: "triage", modules: ["M1", "M3"], traffic: true },
  "triage.cards": { page: "triage", modules: ["M1", "M3", "M4", "M8"] },
  "triage.kanban": { page: "triage", modules: ["M1", "M3", "M8"] },
  "triage.quicklook": { page: "triage", modules: ["M1", "M2", "M3", "M4", "M8"] },
  // ── 분해 보기 (/issues/categories) ──
  "categories.dim.category": { page: "categories", modules: ["M1", "M3", "M4"] },
  "categories.dim.severity": { page: "categories", modules: ["M1", "M3"] },
  "categories.dim.status": { page: "categories", modules: ["M1", "M8"] },
  "categories.dim.novelty": { page: "categories", modules: ["M1", "M2"] },
  "categories.dim.mustHandle": { page: "categories", modules: ["M1", "M5"] },
  "categories.dim.row": { page: "categories", modules: ["M1", "M3", "M6"], quality: true, note: true },
  // ── Analysis (/issues/analysis) ──
  "analysis.tiles": { page: "analysis", modules: ["M1", "M2", "M3"] },
  "analysis.heatmap.rowDims": { page: "analysis", modules: [], quality: true, note: true },
  "analysis.heatmap.issueCount": { page: "analysis", modules: ["M1"], quality: true, note: true },
  "analysis.heatmap.issueDims": { page: "analysis", modules: ["M1", "M4"] },
  "analysis.bubble": { page: "analysis", modules: ["M1", "M2", "M3"], traffic: true },
  "analysis.treemap": { page: "analysis", modules: ["M1", "M3", "M4"] },
  "analysis.patterns": { page: "analysis", modules: ["M2", "M6"] },
  "analysis.insights": { page: "analysis", modules: ["M2", "M7"] },
  "analysis.ledger": { page: "analysis", modules: ["M1", "M3", "M8"] },
  "analysis.detailPane": { page: "analysis", modules: ["M1", "M2", "M3", "M4", "M8"] },
  // ── Report (/issues/report) ──
  "report.masthead": { page: "report", modules: ["M1", "M3", "M7"] },
  "report.exec": { page: "report", modules: ["M2", "M3", "M7"] },
  "report.dossiers": { page: "report", modules: ["M1", "M3", "M4", "M7"], traffic: true },
  "report.userImpact": { page: "report", modules: ["M1", "M3", "M4"], traffic: true },
  "report.devMiss": { page: "report", modules: ["M1", "M4", "M5"] },
  "report.division": { page: "report", modules: ["M1", "M3", "M7"], quality: true },
  "report.region": { page: "report", modules: ["M1", "M3", "M7"], quality: true, traffic: true },
  "report.bixby": { page: "report", modules: ["M1", "M2"], quality: true },
  "report.regression": { page: "report", modules: ["M1", "M2"] },
  "report.patterns": { page: "report", modules: ["M2", "M6"] },
  "report.markets": { page: "report", modules: [], quality: true, traffic: true, note: true },
  "report.appendix": { page: "report", modules: ["M3", "M4", "M8"] },
  "report.notes": { page: "report", modules: ["M1", "M7"] },
  // ── Single issue (/issues/[id]) ──
  "detail.header": { page: "detail", modules: ["M1", "M3", "M4", "M5", "M8"] },
  "detail.anatomy": { page: "detail", modules: ["M3"], traffic: true },
  "detail.reasons": { page: "detail", modules: ["M2", "M3"] },
  "detail.trend": { page: "detail", modules: ["M1", "M2"] },
  "detail.breakdowns": { page: "detail", modules: ["M1"] },
  "detail.utterances": { page: "detail", modules: [], quality: true, note: true },
  "detail.patterns": { page: "detail", modules: ["M6"] },
  "detail.similar": { page: "detail", modules: ["M1", "M4"] },
  "detail.workflows": { page: "detail", modules: [], quality: true },
  "detail.triage": { page: "detail", modules: ["M8"] },
  // ── Export (frame header) ──
  "export.csv": { page: "export", modules: ["M1", "M3", "M4", "M8"] },
  "export.markdown": { page: "export", modules: ["M1", "M3", "M4", "M7"] },
} as const satisfies Record<string, FeatureDeps>;

export type FeatureId = keyof typeof FEATURES;
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];
export const featureDeps = (id: FeatureId): FeatureDeps => FEATURES[id];

/** features of one page, in page order */
export const featuresOf = (page: FeaturePage): FeatureId[] => FEATURE_IDS.filter((f) => FEATURES[f].page === page);
/** union of the modules a set of features needs (registry order) */
export function modulesOf(features: readonly FeatureId[]): ModuleId[] {
  const s = new Set<ModuleId>();
  for (const f of features) for (const m of FEATURES[f].modules as readonly ModuleId[]) s.add(m);
  return MODULE_IDS.filter((m) => s.has(m));
}
/** features that depend on a module */
export const dependantsOf = (m: ModuleId): FeatureId[] => FEATURE_IDS.filter((f) => (FEATURES[f].modules as readonly ModuleId[]).includes(m));
/** features with traffic-sensitive wording (M9 note) */
export const trafficFeatures = (): FeatureId[] => FEATURE_IDS.filter((f) => (FEATURES[f] as FeatureDeps).traffic);

/** issue-level dims → the module that produces them (row dims need none) — for dynamic badges (heatmap axes, breakdown dim) */
export const ISSUE_DIM_MODULES: Record<string, readonly ModuleId[]> = {
  category: ["M1", "M4"],
  user_impact: ["M1", "M4"],
  dev_miss: ["M1", "M4"],
  risk: ["M1", "M4"],
  severity: ["M1", "M3"],
  status: ["M1", "M8"],
  novelty: ["M1", "M2"],
  must_handle: ["M1", "M5"],
};
