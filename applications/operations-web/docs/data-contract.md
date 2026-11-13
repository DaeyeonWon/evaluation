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
