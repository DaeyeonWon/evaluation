// Regenerates src/lib/catalog.ts from the mock engine's initial state + src/config/domain.ts.
// Usage: npm run gen:catalog   (needed when the engine's static tables or domain.ts change).
// domain.ts is TypeScript → this script re-executes itself with --experimental-strip-types (Node ≥ 22.6).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.features?.typescript && !process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aipo-catalog-'));
fs.copyFileSync(path.join(APP, 'src/server/mock/engine.ts'), path.join(TMP, 'engine.mjs'));
const { createMockEngine } = await import(path.join(TMP, 'engine.mjs'));
const { domain } = await import(path.join(APP, 'src/config/domain.ts'));
const M = createMockEngine(globalThis, { domain });
const OUT = path.join(APP, 'src/lib/catalog.ts');
const j = (x) => JSON.stringify(x, null, 2);
const c = M.config;
const parts = [];
parts.push(`/**
 * Static catalog — isomorphic (safe to import from client AND server components; no fetch needed).
 * Generated from the mock engine's initial state (same values as designs/mock-data.js).
 * Live/mutable values (capacity limits, paused flags, config) must come from the API instead.
 */
import { domain } from "@/config/domain";
import type {
  AttemptStatus, Capsule, ComponentSpec, DagTemplateNode, DlqStatus, DomainLanguage, EventCatalogEntry, FailureCategory,
  FailureCategoryMetaEntry, FailureReason, FailureReasonMetaEntry, LangCode, MetaEntry, ModelVersionInfo,
  NodeStatus, Operator, PipelineDef, ResultColumn, RolePermission, Severity, SeverityMetaEntry, Stage, StageEdge, StageId,
  StatusMetaEntry, Tone, WorkflowStatus,
} from "./types";
`);
parts.push(`/** 2026-11-12T14:30:00+09:00 — simulator virtual clock starts here. */
export const BASE_NOW = ${M.meta.baseNow};
export const TIMEZONE = "Asia/Seoul";
export const PROJECT_ID = ${j(c.project.id)};
export const PROJECT_NUMBER = ${j(c.project.number)};
export const REGION = ${j(c.project.region)};
export const BUCKETS = ${j(c.buckets)} as const;
export const BIGQUERY = ${j(c.bigquery)} as const;
export const PIPELINE_VERSIONS = ${j(c.pipelineVersions)};
export const DEFAULT_PIPELINE_VERSION = ${j(c.defaultPipelineVersion)};
`);
parts.push(`export const LANG_CODES: LangCode[] = ${j(M.languages.map((l) => l.code))};
/** Initial language config (static defaults). Live values: GET /api/v1/languages/capacity. */
export const LANGUAGES: DomainLanguage[] = ${j(M.languages)};
export const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l])) as Record<LangCode, DomainLanguage>;
`);
parts.push(`export const OPERATORS: Operator[] = ${j(M.operators)};
export const DEFAULT_OPERATOR_ID = "op-kim-sy";
export const ROLE_PERMISSIONS: RolePermission[] = ${j(c.rolePermissions)};
`);
parts.push(`export const STAGES: Stage[] = ${j(M.stages)};
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, Stage>;
export const STAGE_EDGES: StageEdge[] = ${j(M.stageEdges)};
export const STATE_TO_STAGE: Record<WorkflowStatus, StageId> = ${j(M.STATE_TO_STAGE)};
export const STATES: WorkflowStatus[] = ${j(M.states)};
export const ACTIVE_STATES: WorkflowStatus[] = ${j(M.ACTIVE_STATES)};
export const TERMINAL_STATES: WorkflowStatus[] = ${j(M.TERMINAL_STATES)};
`);
parts.push(`export const DAG_TEMPLATE: DagTemplateNode[] = ${j(M.DAG_TEMPLATE)};
`);
parts.push(`export const STATUS_META: Record<WorkflowStatus, StatusMetaEntry> = ${j(M.statusMeta)};
export const NODE_STATUS_META: Record<NodeStatus, MetaEntry> = ${j(M.nodeStatusMeta)};
export const ATTEMPT_STATUS_META: Record<AttemptStatus, MetaEntry> = ${j(M.attemptStatusMeta)};
export const DLQ_STATUS_META: Record<DlqStatus, MetaEntry> = ${j(M.dlqStatusMeta)};
export const SEVERITY_META: Record<Severity, SeverityMetaEntry> = ${j(M.severityMeta)};
export const FAILURE_CATEGORY_META: Record<FailureCategory, FailureCategoryMetaEntry> = ${j(M.failureCategoryMeta)};
export const FAILURE_REASON_META: Record<FailureReason, FailureReasonMetaEntry> = ${j(M.failureReasonMeta)};
export const EVENT_CATALOG: Record<string, EventCatalogEntry> = ${j(M.eventCatalog)};
`);
parts.push(`export const CAPSULES: Capsule[] = ${j(M.capsules)};
export const CAPSULE_BY_ID = Object.fromEntries(CAPSULES.map((c) => [c.id, c])) as Record<string, Capsule>;
export const DEVICES: string[] = ${j(M.devices)};
export const RESULT_COLUMNS: ResultColumn[] = ${j(M.results.columns)};
`);
parts.push(`// ── domain registry (re-exported from src/config/domain.ts) ──
/** Versioned pipeline registry (root + sub-pipelines). Enriched view: GET /api/v1/pipelines or /meta. */
export const PIPELINE_REGISTRY: PipelineDef[] = domain.pipelines;
export const PIPELINE_BY_ID = Object.fromEntries(PIPELINE_REGISTRY.map((p) => [p.id, p])) as Record<string, PipelineDef>;
export const ROOT_PIPELINE_IDS: string[] = PIPELINE_REGISTRY.filter((p) => p.kind === "root").map((p) => p.id);
/** Leaf components by id. */
export const COMPONENTS: Record<string, ComponentSpec> = domain.components;
/** Models under test (results.model_version) — distinct from pipeline_version. */
export const MODELS: ModelVersionInfo[] = domain.models;
export const MODEL_VERSIONS: string[] = MODELS.map((m) => m.id);
`);
parts.push(`/** Standardized status tones (CSS tokens --st-<tone>). */
export const TONES: Tone[] = ["success", "running", "queued", "retry", "failed", "dlq", "cancelled"];
/** Hex values behind the --st-* tokens (use the CSS vars in UI; these are for canvas/ECharts fallbacks). */
export const TONE_COLORS: Record<"light" | "dark", Record<Tone, string>> = {
  light: { success: "#1f8f4e", running: "#2a78d6", queued: "#7a8190", retry: "#c27a00", failed: "#d23f3f", dlq: "#7d3cc8", cancelled: "#5c6370" },
  dark: { success: "#3fb871", running: "#3987e5", queued: "#9aa0aa", retry: "#e0a42a", failed: "#e66767", dlq: "#a77ff0", cancelled: "#8b929c" },
};
/** Hex values behind the --lang-* tokens. */
export const LANG_COLORS: Record<"light" | "dark", Record<LangCode, string>> = {
  light: { ko: "#2a78d6", en: "#eb6834", ja: "#1baf7a", es: "#eda100" },
  dark: { ko: "#3987e5", en: "#d95926", ja: "#199e70", es: "#c98500" },
};
/** Korean short labels for languages (UI chips). */
export const LANG_LABEL: Record<LangCode, string> = { ko: "한국어", en: "영어", ja: "일본어", es: "스페인어" };
`);
fs.writeFileSync(OUT, parts.join('\n'));
console.log('wrote', OUT, fs.statSync(OUT).size);
