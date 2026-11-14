# AIPO Operations Console — Data / API Contract

Audience: UI engineers building on the Atlas console. This is the contract of the data layer
(`src/lib/types.ts`, `src/lib/time-range.ts`, `src/lib/client/*`, `/api/v1/**`, `src/config/domain.ts`).
It is the authoritative API contract (the old FOUNDATION.md was removed; see `docs/architecture.md` for the app structure). All types named here are exported from
`@/lib/types` unless stated otherwise.

> **Auth.** `/api/v1/**` now requires the session cookie from engineer B's auth layer (`docs/auth.md`).
> Mock mode: `POST /api/v1/auth/login {"userId":"op-kim-sy"}` sets the cookie. `api.*` fetchers work
> unchanged in the browser.

---

## 0. What changed (summary)

| Area | Change |
| --- | --- |
| Time range | Every list/aggregate endpoint takes `?range=` or `?from=&to=` (default **today, KST, virtual clock**) and echoes `range: ResolvedRange`. |
| History | 30 days of seeded data (lower density before day 8, plus 02:00 nightly regression runs). `GET /meta` → `dataWindow`. |
| Envelopes | Endpoints that returned a bare array now return `RangedList<T> = { items, total, range }`. The legacy `api.*` fetchers unwrap `.items`, so existing UI code keeps working. |
| Pipelines | Versioned registry with sub-pipelines (`src/config/domain.ts`). Root job + child jobs per attempt. New `/pipelines`, `/pipeline-jobs`, `/workflows/[id]/pipeline-runs`. |
| Legacy DAG | `Workflow.dag`, `Attempt.dag`, `WorkflowDag.nodes`, `current_node`, `error.node`, `DeadLetter.failed_node` and `metrics.runningByComponent` are kept in the **six legacy phases** as a derived projection. Use the job endpoints for the real DAG. |
| Search | `GET /files/search` (file name at every stage). `GET /stages/[id]` returns `objects` for every stage and accepts `?q=`. |
| Issue Report | New `/issues*` endpoints (ranked FAIL clusters, criticality factors, new patterns, insights, triage `PATCH` with `issues:write`, CSV + Markdown export), SSE `issue`, result columns `agent_function`, `agent_function_predicted`, `market`, `os_version`, `one_ui_version`, `utterance_pattern`. See §8. |
| Issue dimensions | Result columns `division`, `region`, `bixby_version` (domain.ts tables), issue taxonomy `category` + triage lenses `user_impact_type` / `dev_miss_type` / `must_handle`, new `/issues/breakdown` and `/issues/matrix`, `GET /issues?group=&subgroup=`, richer facets. See §8.10–8.11. |
| Results | `model_version` (e.g. `bixby-nlu-2026.10`, independent of `pipeline_version`), plus `pipeline_id`. Both are filters and facets (`aggregates.byModelVersion`, `aggregates.byPipeline`, `facets`). |
| Fixes | Config drift `changedBy`/`changedAt`/`reason` update on every PATCH (config, language capacity, global capacity). `api.gcsObjects({ delimiter: "" })` now sends `delimiter=` (flat listing). |
| SSE | New event `job` (`PipelineJobTransition`) for root and child job status changes. |

---

## 1. Time range

### 1.1 URL convention (pages and API are identical)

| Form | Meaning |
| --- | --- |
| *(no param)* | `today` (default; omit it from URLs) |
| `?range=today` | `[KST 00:00 of now, now]` |
| `?range=yesterday` | `[KST 00:00 − 24h, KST 00:00 − 1ms]` |
| `?range=1h` / `6h` / `24h` / `7d` / `30d` | `[now − N, now]` |
| `?range=<N>h` / `<N>d` | any "last N" (1h … 90d). Legacy analytics `12h` and `48h` keep working this way. |
| `?from=<ISO\|epoch ms>&to=<ISO\|epoch ms>` | custom range; **wins over `range`**. A missing `to` means now. ISO strings with `Z` are preferred; a raw `+09:00` must be URL-encoded. |

- "now" is always the **virtual clock** (`engine.now()` on the server, `useSimNow()` on the client). Never use `Date.now()`.
- Bounds are inclusive: `from ≤ ts ≤ to`.
- Invalid input returns **400** `INVALID_ARGUMENT` with a message in the request locale (`console_locale` cookie → `Accept-Language` → ko) and its `key` (`errors.validation.range*` / `validation.timestamp`), plus `details.field` and `details.allowed`. `response.range.label` is also built in the request locale.

### 1.2 `ResolvedRange`

```ts
interface ResolvedRange { from: EpochMs; to: EpochMs; label: string; preset: string; fromIso: string; toIso: string }
// label: "오늘 · 11월 12일 (목)" | "어제 · 11월 11일 (수)" | "최근 7일" | "최근 12시간" | "2026-11-10 09:00 ~ 2026-11-12 14:30"
//        en: "Today · Thu, Nov 12" | "Yesterday · Wed, Nov 11" | "Last 7 days" | "Last 12 hours" | "… ~ now"
// preset: "today" | "yesterday" | "1h" | "6h" | "24h" | "7d" | "30d" | "12h" (last-N) | "custom"
```

The server's `response.range` is authoritative. Show its `label` next to the period selector.

### 1.3 `@/lib/time-range` (isomorphic)

| Export | Signature / notes |
| --- | --- |
| `RANGE_PRESETS` | `RangePresetInfo[]` `{ id, label, labelEn }` for the 7 presets (also in `GET /meta`.rangePresets) |
| `DEFAULT_RANGE` | `{ kind: "preset", preset: "today" }` |
| `RangeSpec` | `{kind:"preset",preset} \| {kind:"last",amount,unit:"h"\|"d"} \| {kind:"custom",from,to}` (`to` = `Infinity` when open) |
| `parseRange(src)` | lenient parse: invalid input falls back to today. `src`: `URLSearchParams` or a `Record` (Next `searchParams`). |
| `parseRangeParams(src)` | strict; throws `RangeParseError { field }` (used by the server) |
| `parseRangeToken("7d")` | strict token parse |
| `serializeRange(spec, {keepDefault?})` | → `{}` for today, `{range}` for presets and last-N, `{from,to}` as ISO-Z for custom |
| `applyRangeToSearchParams(sp, spec)` | returns a new `URLSearchParams` with `range`/`from`/`to` replaced |
| `resolveRange(spec, virtualNow)` | → `ResolvedRange` (KST day boundaries) |
| `rangeKey(spec)` | stable string for cache keys: `"today"`, `"7d"`, `"custom:<from>-<to\|now>"` |
| `sameRange`, `overlaps(r, a, b)`, `inRange(r, ts)`, `spanMs(r)`, `kstDayStart(ts)`, `kstDateLabel`, `kstDateTime`, `isoKst`, `parseTime` | helpers |

### 1.4 Client hook: `useTimeRange()` (`@/lib/client/use-query-state`)

```tsx
import { useTimeRange } from "@/lib/client/use-query-state"; // not yet re-exported from @/lib/client
const tr = useTimeRange(); // { spec, setSpec, params, resolved, key, isDefault }
const res = useApi(["results", tr.key, q], () => api.results({ ...tr.params, ...q }), { revalidateOn: ["transition"] });
<RangePicker value={tr.spec} onChange={(s) => tr.setSpec(s)} label={res.data?.range.label ?? tr.resolved.label} />
```

- `setSpec` uses `router.replace` (or `{ history: "push" }`), removes `page`, and drops `range` for today.
- Wrap the component in `<Suspense>` (it uses `useSearchParams`).
- `api.rangeParams(spec)` / `serializeRange(spec)` give the same params outside React.

### 1.5 Which timestamp each endpoint filters on

| Endpoint | Range applies to |
| --- | --- |
| `/overview` | legacy `*Today` fields are always the KST day. `inRange` uses each metric's own time (see `RangeKpis`) |
| `/workflows` | lifetime overlap `[created_at, completed_at ?? ∞]` (default). `range_by=created` or `range_by=updated` is optional. |
| `/events`, `/logs` | `ts` |
| `/dead-letters` | `created_at` (+ `outsideRange` counts of items still needing attention) |
| `/replays`, `/audit` | `created_at` / `ts` |
| `/alerts` | `opened_at` (+ `openOutsideRange`) |
| `/incidents` | `[started_at, resolved_at]` overlap |
| `/results`, `/results/csv` | `eval_ts` (`ids=` selection ignores the range) |
| `/analytics/*` | metric buckets overlapping the range (hourly / 5-min / daily), and attempts completed in range |
| `/stages`, `/stages/[id]` | **active** workflows are always included; terminal ones when `updated_at` is in range. `gcs_input`/`event_bus`: originals created in range |
| `/gcs/objects` | `timeCreated` (`range=all` disables) |
| `/files/search` | the record's `updated` |
| `/pipelines*` | job window `[start_at, end_at ?? now]` overlap |
| `/capacity/history` | series buckets |

Detail-by-id endpoints **ignore** the range: `/workflows/[id]*`, `/dead-letters/[id]`, `/results/[utterance_id]`, `/pipeline-jobs/[jobId]`, `/gcs/object`.

---

## 2. Domain config — `src/config/domain.ts`

`export const domain: DomainConfig` (also the default export). It is plain data with only type imports. The engine receives it via `createMockEngine(globalThis, { domain, baseNow })`. `src/lib/catalog.ts` re-exports parts of it; regenerate with `npm run gen:catalog` after edits.

```ts
interface DomainConfig {
  id; name; project: { id; number; region; environment; console }; timezone;
  baseNow: string;            // ISO seed "now" (2026-11-12T14:30:00+09:00)
  historyDays: number;        // 30
  buckets: { input; artifacts; results };  bigquery: { dataset; resultsTable; eventsTable };
  languages: DomainLanguage[];   // LanguageConfig + basePass, bytesPerUtterance, baseMinutes, peakPerHour, costPerRunUsd, mixWeight
  capacity: { global: { maxConcurrent; maxStartsPerMinute }; terraformDefaults: Record<string, unknown>; gpuQuota };
  stages: Stage[]; stageEdges: StageEdge[];
  capsules: Capsule[]; devices: { id; weight; adj; lat: [min, max] }[];
  models: ModelVersionInfo[];          // { id, label, status PRODUCTION|CANDIDATE|RETIRED, releasedAt, passAdj, weight, notes }
  releases: PipelineReleaseInfo[];     // root release train v1.0 / v1.1 / v1.2-rc (traffic split, judge model, …)
  defaultRelease: string;
  components: Record<string, ComponentSpec>;  // leaf components
  pipelines: PipelineDef[];                    // registry
}
interface ComponentSpec { id; label; labelKo; ev /* TASK_<ev>_STARTED… */; weight; machineType; cpu; gpu; memGb; image; description;
  metric: "none"|"intent"|"slot"|"response"|"latency"|"asr"|"safety"|"pass"; outputs: ComponentOutputSpec[]; persists?: boolean }
interface PipelineDef { id; label; labelKo; kind: "root"|"sub"; description; durationFactor?; mixWeight?; languages?; versions: PipelineVersionDef[] }
interface PipelineVersionDef { version; status: "STABLE"|"CANARY"|"DEPRECATED"; releasedAt; notes; nodes: PipelineNodeDef[] }  // topological order
type PipelineNodeDef =
  | { id; kind: "component"; component: string; deps: string[]; label?; legacyPhase? }
  | { id; kind: "subpipeline"; ref: { pipeline: string; version: string }; deps: string[]; label?; legacyPhase? };
```

Edges are derived from `deps`. `legacyPhase` (root nodes only) maps a node onto one of the six legacy phases.

Catalog additions: `PIPELINE_REGISTRY`, `PIPELINE_BY_ID`, `ROOT_PIPELINE_IDS`, `COMPONENTS`, `MODELS`, `MODEL_VERSIONS`. `LANGUAGES` is now `DomainLanguage[]`. `EVENT_CATALOG` gains `TASK_<EV>_{STARTED,COMPLETED,FAILED}` for every component, plus `CHILD_PIPELINE_{STARTED,SUCCEEDED,FAILED,CANCELLED}`.

### 2.1 Registry (current)

| Pipeline | Kind | Versions | DAG |
| --- | --- | --- | --- |
| `bixby-eval-full` | root | v1.0, v1.1, v1.2-rc | preprocess → [asr_eval⟨asr-eval⟩ ‖ nlu_eval⟨nlu-eval⟩ ‖ response_judge⟨response-judge⟩] → aggregate → persist |
| `bixby-eval-quick` | root | v1.1, v1.2-rc | preprocess → nlu_eval⟨nlu-eval⟩ → aggregate → persist *(persist added so every root writes results.csv + BQ)* |
| `bixby-regression-nightly` | root | v1.0, v1.1, v1.2-rc | preprocess → [nlu_eval ‖ response_judge] → compare_baseline → persist (02:00 KST daily) |
| `tts-quality` | root | v1.2-rc (ko/en only) | preprocess → tts_synthesize → [mos_predict ‖ asr_roundtrip⟨asr-eval⟩] → aggregate → persist |
| `asr-eval` | sub | 1.0.0, 1.1.0 | wer_calc ‖ cer_calc (1.1.0: + noise_robustness after wer_calc) |
| `nlu-eval` | sub | 2.0.0, 2.1.0, 2.2.0-rc | intent_classify → [slot_fill ‖ capsule_route] |
| `response-judge` | sub | 1.0.0, 1.1.0 | llm_judge ‖ latency_check; 1.1.0: llm_judge → safety_check⟨policy-guard⟩ **(2-level nesting)** |
| `policy-guard` | sub | 1.0.0 | toxicity ‖ pii_scan |

Root versions pin their sub-pipeline versions (see `domain.ts`). Workflows are assigned mixed by `mixWeight`, subject to version availability, language and failure compatibility. Every workflow carries `pipeline_id` + `pipeline_version` + `model_version`.

---

## 3. Pipeline jobs

### 3.1 IDs

| Thing | Format | Example |
| --- | --- | --- |
| Root PipelineJob (one per attempt) | `{workflow_id}-cycle-{c}-attempt-{a}` | `wf-20261112-en-0005-cycle-0-attempt-3` |
| Child job (sub-pipeline node) | `{parentJobId}.{node_id}` | `…-attempt-3.response_judge` |
| Grandchild | `{parentJobId}.{node_id}` | `…-attempt-3.response_judge.safety_check` |
| Node path (inside root) | node ids joined by `/` | `response_judge/safety_check/pii_scan` |
| Error path | pipeline ids of the chain + leaf component | `response-judge/policy-guard/pii_scan` |
| Artifact | `gs://bixby-pipeline-artifacts/pipeline_root/{jobId}/{node_id}/{file}` | `…attempt-3.response_judge.safety_check/pii_scan/pii_findings.jsonl` |
| Template | `gs://bixby-pipeline-artifacts/templates/{pipeline_id}/{version}.yaml` | `templates/policy-guard/1.0.0.yaml` |

`Attempt.job_ids` lists the root job plus every child job (depth-first). To get the root from any job id, use `jobId.split(".")[0]`.

### 3.2 Types

- `PipelineJob`: `{ job_id, root_job_id, parent_job_id, parent_node_id, depth, workflow_id, attempt, language, pipeline_id, pipeline_version, model_version, vertex_resource, status: JobStatus, start_at, end_at, duration_ms, progress, nodes: JobNode[], edges, children: PipelineJobRef[], error }`
- `PipelineJobTree` is the same, but `children` holds nested trees.
- `JobStatus = PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED | SKIPPED`. A root job whose pipeline timed out is `FAILED`, with code `PIPELINE_TIMEOUT`.
- `JobNode`: `{ id, kind: "component"|"subpipeline", component, ref: {pipeline_id, version}|null, child_job_id, node_path, label, labelKo, deps, status, start_at, end_at, duration_ms, task_id, progress {processed,total,pct,pass,fail}, resources, image, inputs, outputs (available), error {code, category, message, path}|null, description, legacy_phase }`
- A sub-pipeline node mirrors its child job's status. Its `resources` are the sum over the child's leaves. Its `outputs` are the child's sink outputs.
- Failures can start inside any sub-pipeline. The failing leaf is `FAILED`, every ancestor sub-pipeline node and child job is `FAILED`, siblings still running are `CANCELLED`, and nodes not yet started are `SKIPPED`.
- Failure fields:
  - `Attempt.failed_path`, `failed_node_path`, `failed_component`, `failed_job_id`
  - `WorkflowError.path`, `node_path`, `component`, `pipeline_job_id`
  - `DeadLetter.failed_path`, `failed_component`, `failed_job_id`, `pipeline_id`, `model_version`
- `Workflow.current_node_path` / `current_job_id`: the deepest running (or failed) leaf.

### 3.3 Legacy projection (backward compatibility)

`Attempt.dag` / `Workflow.dag` / `GET /workflows/[id]/dag` still return the six `DAG_TEMPLATE` phases (`preprocess, intent_eval, response_eval, latency_check, aggregate, persist`):
- Each phase aggregates the root nodes whose `legacyPhase` matches, listed in `DagNode.mapped_nodes`.
- Phases with no mapped nodes are `PENDING`, or `SKIPPED` once finished. For example, quick has no response_eval or latency_check.
- Mapping for full: asr_eval→latency_check, nlu_eval→intent_eval, response_judge→response_eval.

It exists only so the current UI keeps rendering. New UI should use the job endpoints.

### 3.4 Events and logs carry job context

`WorkflowEvent` and `LogEntry` gained:
- `pipeline_job_id`: the **emitting** job (the child id for sub-pipeline components)
- `root_pipeline_job_id`
- `pipeline_id`
- `node_path`
- `component` (events only; leaf id for `TASK_*`)

Filtering by `pipeline_job_id=X` matches X **and its descendants** by default (`job_scope=tree`). Use `job_scope=self` for that job only. Supported on `/logs`, `/events`, `/workflows/[id]/logs` and `/pipeline-jobs/[jobId]`.

---

## 4. Endpoint reference (`/api/v1`)

R = honors range and returns `range`.

### 4.1 Overview, meta, capacity

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/overview` R | range | `Overview` = `OverviewKpis` (legacy, today) + `statusDistribution` (live) + `capacity` + `range` + `inRange: RangeKpis` |
| GET | `/meta` | — | `MetaCatalog` + `dataWindow {earliest, now, earliestIso, nowIso, historyDays}`, `rangePresets`, `pipelines: PipelineDefinition[]`, `models`, `components` |
| GET | `/capacity/history` R **new** | range, `granularity=auto\|5m\|1h\|6h` (auto: ≤26h→5m, ≤8d→1h, else 6h) | `CapacityHistory { granularity, ts[], active[lang][], queue[lang][], limit[lang], globalActive[], globalLimit, range }` |
| GET/PATCH | `/languages/*`, `/capacity/global`, `/reservations` | unchanged | unchanged (PATCH updates drift metadata) |

`RangeKpis`: `workflows, created, completed, succeeded, failed, deadLettered, timedOut, cancelled, successRate, retries, retryRate, avgProcessingMs, p95ProcessingMs, avgWaitMs, utterancesEvaluated, utterancePassRate, errorDistribution, statusDistribution, byLanguage{created,succeeded,failed,successRate}, byPipeline{runs,succeeded,failed,running,successRate}, dlqCreated, alertsOpened`.

### 4.2 Workflows

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/workflows` R | as before, plus `pipeline_id`[] (alias `pipeline`), `model_version`[] (alias `model`), `range_by=active\|created\|updated`. **`from`/`to` now mean the range** (formerly a created_at filter). | `WorkflowListResponse` + `facets.pipeline_id`, `facets.model_version` + `range` |
| GET | `/workflows/[id]` | — | `Workflow` (+ `pipeline_id`, `model_version`, `current_node_path`, `current_job_id`; attempts carry `pipeline_id`, `job_ids`, `failed_*`) |
| GET | `/workflows/[id]/dag` | — | `WorkflowDag` (legacy six phases, `mapped_nodes`) |
| GET | `/workflows/[id]/pipeline-runs` **new** | — | `WorkflowPipelineRuns { workflow_id, pipeline_id, pipeline_version, attempts: { attempt, status, root: PipelineJobTree }[] }` |
| GET | `/workflows/[id]/logs` | as before, plus `pipeline_job_id`, `job_scope`, `node_path` | `LogPage` |
| GET | `/workflows/[id]/events`, `/attempts`, `/results`, POST `/cancel` | unchanged | unchanged |

`WorkflowSummary` gains `pipeline_id`, `model_version`, `current_node_path`.

### 4.3 Pipelines (new)

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/pipelines` R | `kind=root\|sub` | `RangedList<PipelineSummary & { definition: PipelineDefinition }>` |
| GET | `/pipelines/[id]` R | `version` (default: latest non-deprecated) | `PipelineDetail { definition, version, nodes, edges, nodeStats: NodeAggregate[], summary, recentRuns (20), range }` |
| GET | `/pipelines/[id]/runs` R | `status`[], `version`[], `language`[], `workflow_id`, `sort=start_desc\|start_asc\|duration_desc`, `page`, `pageSize` (50, ≤500) | `PipelineRunsPage` = `Paginated<PipelineRun>` + `facets {status, version, language}` + `range` |
| GET | `/pipeline-jobs/[jobId]` | `job_scope=self\|tree` (logs and events, default self), `limit` (100) | `PipelineJobDetail` = `PipelineJob` + `filters`, `recentLogs`, `recentEvents`, `ancestors: PipelineJobRef[]` |

- A **run** is one job. For a root pipeline that is an attempt's root job; for a sub-pipeline it is each child-job invocation. Retries therefore count as separate runs.
- `PipelineSummary`: `runs, running, succeeded, failed, cancelled, successRate (succ/(succ+failed)), avgDurationMs, p95DurationMs (succeeded), byVersion, lastRunAt, versions, latestVersion`.
- `NodeAggregate`: `{ node_id, kind, component, ref, label, labelKo, deps, counts: Record<JobStatus, n>, duration: {n, avgMs, p50Ms, p95Ms} (SUCCEEDED nodes), topError: {code, count, path} | null }`.
- Sub-pipeline nodes link to their definition through `ref.pipeline_id@ref.version`, which you pass to `/pipelines/{ref.pipeline_id}?version=`.
- `PipelineDefinition.usedBy` lists the root pipelines that call a sub-pipeline.
- `PipelineDefinition.versions[].leafComponents` and `.subpipelines` are precomputed.

### 4.4 Events and logs

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/events` R | `limit` (50, ≤5000), `stage`, `language`, `severity`[], `name`[], `workflow_id`, `pipeline_id`, `component`, `pipeline_job_id`, `job_scope` | `RangedList<WorkflowEvent>` (newest first) — **envelope (was array)** |
| GET | `/logs` R | as before, plus `pipeline_job_id` + `job_scope`, `pipeline_id`, `node_path` | `LogPage` + `range` |

### 4.5 DLQ / replay

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/dead-letters` R | as before, plus `pipeline_id`[]; `q` also matches `failed_path` | `DeadLetterList` + `range` + `outsideRange {pendingReview, approved, replaying}` |
| GET | `/replays` R | `dead_letter_id`, `status`[] | `RangedList<Replay>` — **envelope (was array)** |
| detail / POST | unchanged | | |

### 4.6 Results

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/results` R | as before, plus `model_version`[] (alias `model`), `pipeline_id`[] (alias `pipeline`). `ids`[] ignores the range. | `ResultsPage` + `range` + `facets {model_version, pipeline_id, version, language}`; `aggregates.byModelVersion`, `aggregates.byPipeline` |
| GET | `/results/csv` R | same filters | CSV. Filename includes the range preset and the model. Headers `x-range-from`, `x-range-to`, `x-range-label` (URI-encoded). New column `pipeline_id` (after `model_version`). |
| GET | `/results/[utterance_id]`, `/results/file` | — | unchanged |

`ResultRow.model_version` is the model under test (`bixby-nlu-2026.09|2026.10|2026.11-rc`). `ResultRow.pipeline_id` is new. Rows are derived lazily per workflow (deterministic; LRU of about 80k rows).

> The current results page infers a model→version map by probing (`results.tsx`). Now that models are independent of pipeline versions, switch it to the `model_version` filter and `facets.model_version`.

### 4.7 Analytics (all R)

| Path | Response | Notes |
| --- | --- | --- |
| `/analytics/throughput` | `ThroughputSeries` + `range` | `granularity=auto` (default): 5m when the span is ≤26h and 5-min data covers it (last 48h), else hour. `granularity=5m` or `hour` forces it. Legacy `range=7d` and `granularity=5m` still work. **Default is now today** (was 7d). |
| `/analytics/quality` | `QualitySeries` + `range` | hourly |
| `/analytics/errors` | `ErrorAnalytics` + `range` | `top` is computed over the range; `topErrorCodes[].paths` counts by failure path |
| `/analytics/components` | `RangedList<ComponentDuration>` — **envelope** | one row per **leaf component** across all pipelines (preprocess, wer_calc, …, pii_scan); `byPipeline` added |
| `/analytics/versions` | `RangedList<VersionComparison>` — **envelope** | |
| `/analytics/languages` | `RangedList<LanguageSummary>` — **envelope** | `utterancesToday` / `passRateToday` / `throughput7d` are computed over the range (legacy names) |
| `/analytics/cost` | `CostAnalytics` + `range` | `total7d` / `byComponent7d` = days intersecting the range (legacy names) |
| `/analytics/daily` | `RangedList<DailyMetrics>` — **envelope** | 31 KST days available; today is `partial` |
| `/analytics/summary` | `AnalyticsSummary` + `range` + `pipelineSummary` | `hourly`, `fiveMin` and `daily` are sliced to the range; `errorCategories7d` is over the range |

### 4.8 Stages / GCS / file search

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/stages` R | — | `RangedList<StageSummary>` — **envelope** |
| GET | `/stages/[id]` R | `limit` (events/logs, 60), `q` (filters `objects` by name / workflow_id / batch_id), `objects_limit` (100) | `StageDetail` + `objects: FileSearchHit[]` + `range` |
| GET | `/gcs/objects` R | `bucket`, `prefix`, `delimiter` (`/` default; `delimiter=` = flat), `limit`, `q`, `range=all` | `GcsListing` + `range` |
| GET | `/files/search` R **new** | `q`, `stage`[], `bucket`, `language`[], `limit` (100, ≤1000) | `FileSearchResult { q, items: FileSearchHit[], total, limit, byStage, range }` |

`StageDetail`:
- `gcsObjects` is now filled for **every** stage. It holds the referenced GCS objects behind `objects`, so for non-GCS stages these are the input objects.
- `metrics` keys are unchanged; "…Today" keys are computed over the range.
- New metric keys:
  - `vertex`: `byPipeline {kind, runs, running, succeeded, failed, successRate, avgDurationSec, runningByNode}`, `runningByLeaf`, `runningChildJobs`, `p95DurationSec`. `runningByComponent` stays keyed by legacy phase.
  - `results`: `byPipeline`, `byModelVersion`
  - `dlq`: `createdInRange`, `byPath`
  - `registry_queue`: `enqueuedInRange`
  - `scheduler`: `admissionsInRange`

`FileSearchHit`:

```ts
{ stage, kind: "gcs_object"|"pubsub_message"|"firestore_doc"|"reservation"|"execution"|"dlq_entry",
  bucket, object, uri, generation, size, updated, workflow_id, batch_id, language, pipeline_job_id,
  current_status, ref, match_ranges: { field: "object"|"workflow_id"|"batch_id"; start; end }[] }
```

What gets indexed, per stage:

| Stage | Record (kind, `ref`) |
| --- | --- |
| gcs_input | input JSONL in `bixby-utterance-input` (original uploads only) |
| event_bus | Eventarc/Pub/Sub message; `ref` = ce_id / message_id |
| ingress | Firestore `events/{event_id}` |
| registry_queue | Firestore `workflows/{id}` |
| scheduler | reservation; `ref` = reservation id |
| workflows | execution per attempt; `ref` = execution id, plus `pipeline_job_id` |
| vertex | artifacts in `bixby-pipeline-artifacts` for root **and child** jobs, plus templates |
| results | results.csv, summary.json and the daily aggregates in `bixby-eval-results` |
| retry | attempt doc `workflows/{id}/attempts/{n}` |
| dlq | DLQ entry; `object` = the `input_uri` object, `ref` = dead_letter_id |

- Non-GCS records carry the source input object in `bucket`/`object`, so file-name search works at every stage.
- Matching is a case-insensitive substring on `object`, `workflow_id` and `batch_id`. `match_ranges` gives highlight spans, up to 8 per field.
- Empty `q` lists everything in range.
- Results are sorted by `updated` desc.

### 4.9 Config / audit / alerts / incidents

| Method | Path | Notes |
| --- | --- | --- |
| GET/PATCH | `/config` | `drift[].changedBy/changedAt/reason` now reflect the latest PATCH of each key, including language and global capacity PATCHes. A value returned to its Terraform default drops out of `drift`. |
| GET | `/audit` R | `Paginated<AuditEntry>` + `range` |
| GET | `/alerts` R | `RangedList<Alert>` + `openOutsideRange` — **envelope (was array)** |
| GET | `/incidents` R | `RangedList<Incident>` — **envelope (was array)** |
| POST | `/alerts/[id]/ack`, `/resolve` | unchanged |

### 4.10 Simulator / day loop

- `POST /sim` is unchanged.
- When the virtual clock crosses KST midnight, the engine **re-seeds anchored on the new day** at the seed's time of day. For example, 23:59 on 11-12 → **2026-11-13 14:30**. Thirty days of history are regenerated behind it.
- After that, `today` resolves to the new day and IDs become `wf-20261113-…`. Clients receive an SSE `sim` message and should refetch.
- Operator mutations (audit, drift) do not survive a re-seed.

---

## 5. SSE additions (`GET /api/v1/stream`)

| event | payload | when |
| --- | --- | --- |
| `job` **new** | `PipelineJobTransition { job_id, root_job_id, parent_job_id, workflow_id, language, pipeline_id, pipeline_version, node_path, depth, from, to, at, error_code, error_path }` | root job RUNNING / SUCCEEDED / FAILED / CANCELLED, and each child job start / succeed / fail / cancel |
| `issue` **new** | `IssueStreamMessage { kind: status \| update \| new_critical, issue_id, status, prev_status?, severity?, score?, title?, by?, at }` | every Issue Report triage PATCH; once per newly detected P0/P1 issue in the default view (today, no filters) — §8 |
| `event`, `log` | as before, plus job context fields (§3.4) | `CHILD_PIPELINE_*` and `TASK_<EV>_*` events for every leaf |

`job` is part of the default stream and of `?types=job` (and registered in `live-stream.tsx` `STREAM_TYPES`).

**Ids, backfill and resync.** Every message has `id: <epoch>-<seq>`: `seq` is monotonic across all event
types for one server process, `epoch` changes when the process restarts. The server keeps a ring buffer of
every non-`tick` message (≤ 5,000 messages, ≤ 5 min; `src/server/mock/runtime.ts` `replaySince()`); `tick`
is a full snapshot, so it is never buffered and a fresh one follows every (re)connect.

- Native EventSource reconnect (server sends `retry: 3000`) carries `Last-Event-ID`; a manually recreated
  EventSource passes `?last_event_id=`. If the id is buffered, `hello` has `resumed: true` and the missed
  messages follow in order, then `tick`, then live messages.
- Unknown / expired / other-process id → `hello.resync: true` and no replay. `live-stream.tsx` then
  revalidates every mounted `useApi` query.
- The client keeps the native reconnect for transient drops and only recreates the EventSource (backoff
  1 s → 30 s, `?last_event_id=`) when it reaches `readyState CLOSED` (e.g. an HTTP error status).

`WorkflowEvent` has two optional fields: `seq` (emission order in the engine, for events with equal `ts`)
and `causation_id` (the command id when known, e.g. `replay_id` on `REPLAY_*`, else the previous event of
the same Workflow).

---

## 6. Typed client (`@/lib/client/api.ts`)

- **New fetchers:**
  - `capacityHistory(q)`
  - `pipelines(q)`, `pipeline(id, {version, …range})`, `pipelineRuns(id, q)`
  - `workflowPipelineRuns(id)`, `pipelineJob(jobId, {job_scope, limit})`
  - `fileSearch(q)`
- **Envelope variants** (carry `range`): `eventsPage`, `alertsPage`, `replaysPage`, `incidentsPage`, `stagesPage`, `componentsPage`, `versionsPage`, `languagesPage`, `dailyPage`.
- **Legacy fetchers** `events`, `alerts`, `replays`, `incidents`, `stages`, `components`, `versions`, `languages` and `daily` unwrap `.items` and keep their old array return types. They are marked `@deprecated`.
- **Range params:**
  - Every query type accepts `RangeQuery { range?, from?, to? }`.
  - `rangeParams(spec)` builds one.
  - `api.overview(q?)` accepts a `RangeQuery`; the old `overview(signal)` call shape still works.
- **New query types:** `RangeQuery`, `EventQuery`, `AlertQuery`, `PipelineRunsQuery`, `FileSearchQuery`, `StageQuery`, `PipelineListItem`.
- **`qs(params, { keepEmpty })`:** keys in `keepEmpty` keep `""`. `gcsObjects` uses `keepEmpty: ["delimiter"]`, so `delimiter: ""` sends a flat listing.
- **`Range`** is widened to every preset, legacy `12h`/`48h`, and any string.
- **Cache keys:** put `tr.key` (from `useTimeRange`) into every `useApi` key so each range has its own cache entry.

---

## 7. Backward compatibility and known caveats

- **Existing UI keeps working:**
  - legacy fetchers unwrap envelopes
  - legacy DAG, `current_node` and `runningByComponent` keys are preserved
  - `range=7d` and `granularity=5m` keep working
  - `/gcs/objects` `delimiter="|"` keeps working
- **Default today changes what some screens show without a range param.** DLQ, alerts, audit and analytics now show today only. Use `outsideRange` / `openOutsideRange` to surface pending work outside the range.
- **`ComponentDuration.component`** is now `string` (registry leaf ids), not `ComponentId`.
- **`TickSnapshot.kpis`** is typed `OverviewKpis`. Its contents are the same as before.
- **`results.rows`** (engine-internal) is a computed getter over today's rows. Services use `rowsInRange` / `rowsFor`.
- **Performance** (dev server, warm, 30d): `/results` ≈ 45 ms, `/results/csv` (~21k rows) ≈ 120 ms, `/analytics/summary` ≈ 18 ms, `/pipelines*` ≈ 5 ms, `/files/search` ≈ 10 ms. The first request after boot builds the engine (~0.3 s).

---

## 8. Issue Report (`/issues`, `/api/v1/issues/*`)

Ranks FAIL clusters by a criticality score, detects new utterance patterns and writes data-backed
insights. Server: `src/server/services/issues.ts` (API), `issues-engine.ts` (clustering + scoring +
novelty), `issues-store.ts` (triage lifecycle), `issues-text.ts` (tokenizer, lexicons). Types: the
"Issue Report" block in `src/lib/types.ts`. Client: `api.issues*` + `src/components/atlas/issues-shared/*`.

### 8.1 New result columns (`ResultRow`, CSV, BigQuery)

| Column | Meaning |
| --- | --- |
| `agent_function` | Bixby Agent function of the **expected** intent (intent prefix map, capsule fallback): `device_control`, `smartthings_routine` (`smartthings.scene_run`), `alarm_timer`, `call_message`, `media_play`, `weather`, `navigation`, `settings`, `calendar`, `general_qa`, `camera`, `galaxy_ai_feature` |
| `agent_function_predicted` | function of the predicted intent |
| `market` | `KR` (ko) · `US`/`GB` (en) · `JP` (ja) · `ES`/`MX` (es) |
| `os_version`, `one_ui_version` | e.g. `Android 16` / `One UI 8.5`, `Wear OS 6` / `One UI 8 Watch`, `Tizen 9.0` / `One UI Tizen` |
| `utterance_pattern` | `up-{lang}-{hash}` of the utterance template (slot values replaced by placeholders) |
| `division` | `Mobile · Wearable · Audio · TV · Appliance` — `device_type` through `domain.ts` `deviceDivision` (Galaxy S26 / Z Fold7 / Tab S11 → Mobile, Galaxy Watch → Wearable, Galaxy Buds → Audio, TV / Neo QLED → TV, Family Hub / Bespoke AI Washer / Oven → Appliance; unknown → `defaultDivision`) |
| `region` | `KR · NA · EU · JP · LATAM` — `market` through `marketRegion` (KR→KR, US→NA, GB/ES→EU, JP→JP, MX→LATAM) |
| `bixby_version` | Bixby client version on the device, semver with optional pre-release (`3.6.12`, `4.0.1`, `4.0.3`, `4.1.0-beta`); known versions in `bixbyVersions` (oldest first), sorted by semver (`4.1.0-beta` < `4.1.0`) |

`GET /results` and `/results/csv` accept `agent_function`, `market`, `utterance_pattern`, `intent_predicted`,
`os_version`, `one_ui_version`, `division`, `region`, `bixby_version` filters; `ResultsPage.facets` adds `agent_function`,
`market`, `division`, `region`, `bixby_version`. The CSV appends the three columns after `utterance_pattern`.
Catalog: `DIVISIONS`, `DIVISION_INFO`, `DEVICE_DIVISION`, `REGIONS`, `REGION_INFO`, `MARKET_REGION`, `BIXBY_VERSIONS`,
`BIXBY_VERSION_INFO`, `CAPABILITIES` (`src/lib/catalog.ts`, from `domain.ts`); `DEVICES` lists every concrete model.

### 8.2 Endpoints (all GET need `view`; all ranged; errors localized)

| Endpoint | Returns |
| --- | --- |
| `GET /issues` | `IssueListResponse` = `{ items: Issue[], total, page, pageSize, range, baseline, unfiltered_total, factor_weights }`; with `group=<dim>` also `group`, `subgroup`, `groups: IssueGroup[]` (§8.11) |
| `GET /issues/breakdown` | `IssueBreakdown` — one card per value of `dim` (§8.11) |
| `GET /issues/matrix` | `IssueDimMatrix` — any two dims × `metric` (§8.11) |
| `GET /issues/summary` | `IssueSummary`: `kpis`, `severity_distribution`, `class_distribution`, `status_distribution`, `factor_weights`, `factor_profile`, `columns` (per-column fail stats with baseline deltas), `trend` (hour ≤ 48 h, else day), `matrix` (agent_function × language), `market_matrix` (agent_function × market), `top_movers`, `top_issues` |
| `GET /issues/facets` | `IssueFacets`: per column (incl. division, region, bixby_version) values with `count` (= FAILs), `fails`, `total`, `fail_rate`, `baseline_fail_rate`, `delta`, `issues` — each ignoring its own filter; per issue-level dim (severity, status, novelty, severity_class, category, user_impact, dev_miss, must_handle) `count` (= issues) + `fails` |
| `GET /issues/{id}` | `IssueDetail` = `Issue` + `utterances` (paged, newest first, `page`/`pageSize` ≤ 200), `trend`, `breakdown` (language, market, device, model_version, pipeline_version, os_version, one_ui_version, division, region, bixby_version with baseline), `workflows`, `similar` (relations same_intent · same_function_reason · same_prediction · **same_category**, max 8), `same_category` (issues of the same category, max 8) |
| `GET /issues/patterns` | `PatternList` = `{ items: NewPattern[], total, range, baseline, terms: NovelTerm[] }`; extra `kind`, `limit` (≤ 200) |
| `GET /issues/insights` | `InsightList` = `{ items: IssueInsight[], total, range, baseline }` |
| `PATCH /issues/{id}` | `IssuePatchResult`; body `IssuePatch { status?, owner?, note?, ticket_id?, reason? }`; needs `issues:write`; Idempotency-Key supported; audited `ISSUE_UPDATE`; SSE `issue` |
| `GET /issues/export.csv` | every matching issue (no paging), UTF-8 BOM, localized title + reasons, factor contributions |
| `GET /issues/report.md` | Markdown summary in the request locale (KPIs, insights, top issues with reasons and score breakdown, new patterns, triage counts). Absolute evidence links to `/results` keep the request range; optional `issue_base=/issues` adds issue deep links (`?issue=<id>`) |

Query params (all optional): `range`/`from`/`to`; row filters `agent_function, capsule, intent, language,
market, device, model_version, pipeline, pipeline_version, failure_reason, os_version, one_ui_version, division, region,
bixby_version` (comma lists; applied before clustering); issue filters `severity (P0..P3), status, novelty (new|recurring),
severity_class, category, user_impact, dev_miss, must_handle (true|false), q, min_score`; `group_by=signature|pattern`; `sort=score_desc|count_desc|fail_rate_desc|delta_desc|recent_desc|first_seen_desc`; `page`, `pageSize` (≤ 500, default 25).
Every `/issues*` endpoint (list, summary, facets, breakdown, matrix, detail, patterns, insights, export.csv, report.md) accepts all of them.
`bixby_version` is a release column: when the selected versions have < 50 baseline rows the baseline drops that filter (`baseline.relaxed_columns`).
Errors: `domain.issueNotFound` (404), `domain.issueTransition` (409), `domain.issueTicketRequired` /
`domain.issueTicketInvalid` / `domain.unknownOperator` / `validation.*` (400), `permission.*` (403).

### 8.3 Clustering

FAIL rows in range (after row filters) are grouped by `(agent_function, intent_expected, intent_predicted,
failure_reason)` (`group_by=signature`, default) or additionally by `utterance_pattern` (`group_by=pattern`).
Patterns are language-specific, so the default keeps one defect across languages in one issue and lists its
patterns in `Issue.patterns[]`. Minimum support: 3 FAILs (2 for safety / policy). Issue id =
`iss-` + base36 FNV-1a of the group key — stable across ranges and calls.

### 8.4 Criticality score

`score = Σ weight × value` (0–100). Every factor is returned in `Issue.factors[]` as `{ key, weight, value (0..1), contribution, detail }`.

| Factor | Weight | Value |
| --- | ---: | --- |
| `volume` | 20 | `ln(1 + count) / ln(1 + max(40, largest cluster))` |
| `severity` | 25 | severity class: safety 1.0 · policy 0.7 · wrong_action 0.45 · quality 0.2 |
| `trend` | 15 | Poisson z of FAILs in the compare window vs `expected = (baseline_count + 1) / (baseline_scope + 1) × compare_scope` (scope = rows with the same `intent_expected`; 0.5 when the intent is new); value `z / 5` clipped to [0, 1] |
| `regression` | 15 | newest vs previous `model_version` and `pipeline_version` (max of both), counted only since the newest version's release (co-existence window), each ≥ 6 scope rows, ≥ 3 FAILs on the newest, one-sided two-proportion z ≥ 1.64; value `clip(max((rate_new − rate_prev) / max(rate_prev, 2%) / 1.5, (rate_new − rate_prev) / 25pp)) × clip(z / 3, 0.6, 1)` (saturates at 2.5× or +25 pp). When no axis qualifies, `detail` carries `why` (`insufficient_sample` · `not_significant` · `no_increase`) with `candidate_axis`, `current`, `previous`, `current_rate`, `previous_rate` of the closest candidate |
| `reach` | 10 | `0.4·markets/6 + 0.3·divisions/5 + 0.3·languages/4` (divisions = the five device families; identical to the former 5-device count) |
| `novelty` | 15 | new cluster (intent unseen in the baseline, or 0 baseline FAILs where ≥ 1.5 were expected): `0.35 + 0.65 × novel-pattern share`; otherwise `0.7 × novel-pattern share`; 0 without a sufficient baseline |

Severity class (`severity_class`): `POLICY_VIOLATION` on a lock/door/gas/oven/garage/window intent or on
`device_control` / `smartthings_routine` → **safety**, other `POLICY_VIOLATION` → **policy**; `SLOT_ERROR` on an
action intent, or `INTENT_MISMATCH` / `ASR_ERROR` whose predicted intent performs an action → **wrong_action**;
everything else → **quality**.

Level: P0 ≥ 60 · P1 ≥ 45 · P2 ≥ 30 · P3. Floors: safety with ≥ 3 FAILs → P0 if ≥ 45, else P1; policy with ≥ 5 FAILs → at least P1.

`reasons[]` are `IssueText { key, vars }` under the `issues` i18n namespace (`reasons.safety, policy,
wrongAction, wrongSlot (SLOT_ERROR with the right intent: most frequent `want → got` value pair parsed from judge reasons), wrongSlotNoPair, quality, regression, spike, newCluster, novelPattern, concentration, reach, volume,
baselineInsufficient`), ordered by weight (plus `reasons.bixbyRegression`; `reasons.concentration` checks one_ui_version, division, device, market, bixby_version in that order). `title` is `titles.<failure_reason>` or `titles.safety`. Enum-coded vars
(`fn, reason, axis, column, market, kind, cls, status, severity`) are translated by `formatIssueText()`
(`src/lib/issue-text.ts`); rates are already percentages.

### 8.5 Baseline window

`baseline = [from − max(len, 7 d), from)` clipped to `dataWindow.earliest`. Coverage < 50 % and range ≥ 14 d
→ `mode: "intra_range"`: compare = last 7 d of the range, baseline = the rest of it (this is what `range=30d`
uses, as history is 30 days). Otherwise insufficient → trend / novelty = 0 and reason `baselineInsufficient`.
Every response carries `baseline: IssueBaseline { from, to, days, mode, compare, coverage, sufficient }`.

### 8.6 New-pattern detection

A pattern is **new** when it has rows in the compare window and none in the baseline window (all rows,
PASS + FAIL), with ≥ 3 rows. Terms: lowercase tokens (whitespace; Japanese by script runs) minus stop words
and digits, plus multi-word product names (`PRODUCT_TERMS`); a **novel term** has 0 baseline occurrences and
≥ 2 (pattern) / ≥ 3 (`terms[]`) current ones. Kind: `new_feature_name` (product lexicon or `galaxy_ai.*`) >
`code_switch` (Latin word inside ko/ja, English lexicon word inside es) > `new_term` > `new_phrasing`.
`growth` = rows in the 2nd half / 1st half of the compare window (null = only in the 2nd half).

### 8.7 Insights

`IssueInsight { id, kind, key (issues.insights.*), vars, severity, score, evidence { filter, results, metrics, issue_id?, pattern_id? } }`,
ranked by `score`. Kinds: `overall`, `safety`, `critical` (top 3 non-safety P0/P1; `insights.criticalSameIntent` when predicted = expected), `regression` (strongest),
`spike` (largest z among recurring), `new_pattern` (summary + top failing patterns; `insights.newPatternSameIntent` when every
FAIL kept the expected intent, naming the dominant failure reason and an actual response), `market` (largest market
delta), `hotspot` (agent_function × language cell), `concentration` (FAILs ≥ 80 % on one One UI / division / device /
market / Bixby version that is < 50 % of traffic), `improvement`, `division` / `region` (largest FAIL-rate delta ≥ 1.5 pp, ≥ 30 rows;
`insights.division|region`), `bixby_version` (`insights.bixbyVersion`: per division × agent_function, the division's newest Bixby
version vs the previous one, rows since the newest first appeared in that division, ≥ 15 rows each, ≥ 5 FAILs, one-sided z ≥ 2.33;
strongest delta; evidence filter `division, bixby_version, agent_function`; e.g. "Bixby 4.0.3 on TV: media_play FAIL +34 pp"). `evidence.results` opens `/results`; `evidence.filter`
reproduces it on `/issues`.

### 8.8 Triage lifecycle

`Issue.state = { status, owner, owner_name, note, ticket_id, updated_at, updated_by, history[] }`.
Transitions: NEW → TRIAGED | IGNORED · TRIAGED → TICKETED | RESOLVED | IGNORED | NEW · TICKETED → RESOLVED |
IGNORED | TRIAGED · RESOLVED | IGNORED → NEW. TICKETED needs `ticket_id`. Mock storage is in-memory
(`globalThis`, survives the day re-seed) and seeds four triaged examples. SSE `issue` (`IssueStreamMessage`) on
every PATCH (`kind: status | update`) and once per newly detected P0/P1 in the default view (`new_critical`).

### 8.9 Mock data (seeded scenarios)

`engine.ts` `SCENARIOS` re-label existing rows with their own hash-seeded RNG (the base `|utt` stream is
untouched; ~700 of ~21k rows over 30 d change, **no PASS/FAIL changes**): door-lock unlock without
confirmation on the rc versions (safety), Galaxy S26 Galaxy AI feature names (Now Brief, Now Nudge, Audio
Eraser, Creative Studio), es-MX code-switching, Galaxy Watch alarm timezone bug on One UI 8 Watch, general_qa
medical / financial advice (policy), ko code-switched toggles (`와이파이 off 해줘`), ko SmartThings slot-parser
regression on v1.2-rc, Gemini hand-off (new, mostly healthy) and a camera baseline. Recent scenarios are gated
by days before `BASE_NOW`, so they follow the day re-seed.

Issue Report dimensions (own streams `|dim`, `|dim2`, `|model` — every pre-existing column of every row is byte-identical):
`division` from the base device; `bixby_version` from `bixbyRollout[division]` (weight × linear ramp since `sinceDays`);
the base device is re-labelled to a concrete model (`deviceModels`) after `deviceOs()` (rows a scenario put on a device keep it).
Two more `own` scenarios at the end of `SCENARIOS` re-label FAIL rows only (no PASS/FAIL change, sources are weather /
general_qa FAILs so no seeded issue loses rows): **`tv_bixby_403_media`** — the Bixby 4.0.3 TV OTA (last ~9 days) routes
existing music phrasings (`{genre} 틀어줘`, `play {genre}`, …) to `video.search`; together with 4.0.3 being drawn more
often for TV media FAILs this yields the Bixby regression (4.0.3 vs 4.0.1 on TV, media_play ≈ +35 pp, `iss-11n6j97`
`music.play_genre → video.search`, `bixby_regression`, dev lens `regression`); **`buds_navigation_unsupported`** — Galaxy
Buds asked for directions (capability table: navigation is not on Audio) → the out-of-scope example (`must_handle=false`).
Its signature (`navigation.route → qa.factoid`, INTENT_MISMATCH) is reserved for the seed: generic navigation misroutes from
supported devices go to `qa.chitchat`, so the issue stays Buds-only and out of scope in every range.

Performance (dev, warm): `/issues*` 3–35 ms (breakdown / matrix ≤ 70 ms over 30 d); first call per range ≈ 60–140 ms.

### 8.10 Issue taxonomy and triage lenses (`issues-taxonomy.ts`)

Deterministic rules over real columns only (failure_reason, intent pair, agent_function / agent_function_predicted,
judge_reason keywords, the pattern template with slot placeholders removed, division, bixby_version) plus the engine's
severity class, regression factor and Bixby regression. The same rules classify one row (FAIL rows outside any issue,
baseline rows) so dims have baselines. Every issue carries the result and a localized why (`IssueText`).

`Issue.category` (+ `category_reason`, `categoryReason.*`) — first match wins:

| # | category | rule |
| ---: | --- | --- |
| 1 | `safety` | severity class safety |
| 2 | `policy` | severity class policy |
| 3 | `new_feature` | ≥ 50 % of FAILs: expected `galaxy_ai.*`, a product / feature term in the template (`PRODUCT_TERMS` minus service names) or judge "기능명" |
| 4 | `locale` | ≥ 50 % of FAILs code-switched (template with a Latin word in ko/ja, English lexicon word in es, or judge "code-switching") or time-zone errors (judge "시간대 / timezone / UTC") |
| 5 | `timeout` | `TIMEOUT` |
| 6 | `asr` | `ASR_ERROR` |
| 7 | `wrong_action` | severity class wrong_action with predicted ≠ expected |
| 8 | `slot` | `SLOT_ERROR` |
| 9 | `misroute` | `INTENT_MISMATCH` |
| 10 | `response_quality` | otherwise |

`must_handle` (+ `must_handle_reason`, `mustHandle.*`): `POLICY_VIOLATION` → always (guardrail); else true when ≥ 50 % of
the FAIL rows run on a device / Bixby version that `domain.ts` `capabilities` supports (first intent-prefix match: listed
division or extra device, and `bixby_version ≥ minBixby`; no match = supported everywhere). Otherwise false with
`unsupportedDevice` / `unsupportedVersion`.

`user_impact_type` (user lens, `type_reason.user_impact`, `userImpactReason.*`) — first match: `safety_privacy` (safety class;
or POLICY_VIOLATION with privacy keywords / on call_message, calendar) · `inappropriate_content` (policy class) · `degraded`
(TIMEOUT; SLOT_ERROR whose judge reasons mostly ask again for a missing value) · `wrong_action` (wrong_action class, or
SLOT_ERROR on a task intent) · `minor` (RESPONSE_QUALITY, mostly "verbose") · `task_blocked` (RESPONSE_QUALITY mostly
"evasive"; or a task intent — not general_qa / weather / a query intent — that was not carried out) · `misunderstood`.

`dev_miss_type` (dev lens, `type_reason.dev_miss`, `devMissReason.*`) — first match: `out_of_scope` (must_handle = false) ·
`guardrail_miss` (POLICY_VIOLATION) · `regression` (regression factor ≥ 0.15, or `bixby_regression`) · `new_feature_gap`
(category new_feature) · `locale_gap` (category locale) · `performance` (TIMEOUT) · `asr_robustness` (ASR_ERROR) ·
`slot_extraction` (SLOT_ERROR) · `routing` (INTENT_MISMATCH to another agent function) · `supported_intent_failed`.

Both lenses group by the same impact level = `severity` (P0 Critical · P1 High · P2 Medium · P3 Low, `issues.impactLevel.*`).
The dev lens is `must_handle=true` by default (UI) and sorted by `score_desc`.

`Issue.bixby_regression` (`IssueBixbyRegression | null`, informational — no score change): on the issue's dominant division,
newest vs previous Bixby version with ≥ 10 scope rows each (same intent_expected, rows since the newest version first appeared
in that division), ≥ 4 FAILs on the newest, rate +2 pp and one-sided z ≥ 2.33.

Other new `Issue` fields: `divisions`, `regions`, `bixby_versions` (by FAIL count), `dominant` (`IssueDominant`: the value with
the most FAILs for every row dim — group membership on row dims).

### 8.11 Dimensions: breakdown, matrix, grouped list (`issues-dims.ts`)

`IssueDim` = row dims (`IssueColumn`: agent_function, capsule, intent, language, market, device, model_version, pipeline,
pipeline_version, failure_reason, os_version, one_ui_version, division, region, bixby_version) + issue-level dims
(`IssueTagDim`: category, user_impact, dev_miss, must_handle, severity, status, novelty, severity_class). A FAIL row takes its
issue's value on issue-level dims (rows of a signature that is an issue now — e.g. baseline rows — too; other FAIL rows:
the §8.10 rules on the row, severity / status / novelty: none); PASS rows have none. Hence issue-level dims do not split
PASS rows: their `total` is every row in scope and `fail_rate` is that value's share of the FAIL rate (for category /
user_impact / dev_miss / must_handle every FAIL row has a value, so Σ over values = overall FAIL rate).

Counted FAILs: without issue-level filters every FAIL row counts. With them a FAIL row counts when its issue passes the
issue filters; rows outside any issue count only for the taxonomy filters (category / user_impact / dev_miss / must_handle,
by row tags). Totals never change. (`/issues/summary` keeps its legacy semantics: row stats ignore issue-level filters.)

`IssueDimStat { value, total, fails, fail_rate, baseline_total, baseline_fails, baseline_fail_rate, delta (pp), issues }`.

- **`GET /issues/breakdown?dim=<IssueDim>[&limit=50]`** → `IssueBreakdown { range, baseline, dim, bucket, t[] (bucket starts),
  totals: IssueDimStat, items: IssueBreakdownItem[], truncated }`. Item = `IssueDimStat` + `label` (`IssueText` or null),
  `rank`, `share` (% of counted FAILs), `by_severity` (issues touching the value), `trend[]` (FAILs per bucket — hour ≤ 48 h,
  else day), `trend_rate[]`, `top_issues` (3 by score, + `count_in_value`, `category`, `user_impact_type`, `dev_miss_type`,
  `signature`), `top_pattern` (new pattern with the most compare-window rows in the value, or null). Items: values with counted
  FAILs (and a selected row-dim value), most FAILs first. Missing / unknown `dim` → 400.
- **`GET /issues/matrix?x=<IssueDim>&y=<IssueDim>&metric=fail_rate|fail_count|delta|issue_count[&max_x=12&max_y=12]`**
  (2–40) → `IssueDimMatrix { range, baseline, x, y, metric, x_values, y_values, x_labels, y_labels, x_totals, y_totals,
  cells: IssueDimMatrixCell[] (y-major), domain: [min,max] | null, folded: { x, y } }`. Cell = `IssueDimStat` (without
  `value`) + `x`, `y`, `value` (the metric; null without rows / baseline), `top_issue_id` (highest score). Axis order: natural
  for enumerated dims (severity P0→P3, category / lens order, division, region, market, language, agent_function,
  failure_reason, Bixby semver), else by FAILs. Beyond `max_*` the smallest values fold into `"__other__"` (label
  `dimValue.other`). A cell's total ignores an issue-level axis.
- **`GET /issues?group=<IssueDim>[&subgroup=<IssueDim>&group_size=10&group_key=…&subgroup_key=…&group_page=1]`** adds
  `groups: IssueGroup[]` (`{ key, label, count, fails, by_severity, max_score, items, page, pageSize, subgroups? }`) over the
  filtered, sorted issues. Row dims use `Issue.dominant`, so every issue is in exactly one group. Natural group order for
  enumerated dims, else by top score; items keep `sort`. `group_key` (+ `subgroup_key`) returns only that group / subgroup,
  its items paged by `group_page`. `items` / `total` / `page` keep their usual meaning.
- Labels (`issues` namespace): `agentFunction.*`, `market.*`, `failureReason.*`, `severity.*`, `status.*`, `novelty.*`,
  `severityClass.*`, `category.*` (+ `categoryHelp.*`), `userImpact.*` (+ `userImpactHelp.*`), `devMiss.*` (+ `devMissHelp.*`),
  `mustHandleValue.true|false`, `division.*`, `region.*`, `language.*`, `impactLevel.*`, `dimValue.other`; device, versions,
  intent, capsule, pipeline: the raw value. `ENUM_VARS` (`src/lib/issue-text.ts`) also translates `division`, `region`,
  `category`, `user_impact`, `dev_miss` vars.
