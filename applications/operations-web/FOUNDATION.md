# AIPO Operations Web — Foundation Guide

이 문서는 **공용 기반(foundation)**의 기준 문서입니다. 세 디자인 변형(Flowline · Atlas · Lanes)은 이 기반 위에서 **병렬로** 구현합니다.
공용 파일은 수정하지 말고, 패키지도 추가 설치하지 마세요. 필요한 것은 이미 설치되어 있고 아래에 문서화되어 있습니다.

- Stack: **Next.js 16.4.6** (App Router, Turbopack) · React 19.3 · TypeScript 5.9 (strict) · Tailwind CSS v4 · ECharts 6 · motion 14 · lucide-react · d3-zoom/d3-selection · clsx
- Design spec: `../../designs/{a-flowline,b-atlas,c-lanes}.html` + `../../designs/mock-data.js` (승인된 프로토타입). 화면 구성은 plan.md §6.3 (S1–S7).
- 모든 데이터는 앱 내장 Mock API(`/api/v1/*`)와 서버 시뮬레이터에서 나옵니다. GCP 호출, 비밀 값, 실제 내부 데이터는 없습니다(공개 저장소).
- Next 16은 기존 지식과 다른 점이 있습니다. 의문이 생기면 `node_modules/next/dist/docs/`를 확인하세요(AGENTS.md 참고).

---

## 1. Quick start

```bash
cd applications/operations-web
npm install                      # already done; lockfile pins exact versions
npm run dev                      # http://localhost:3000 (default distDir .next)
npm run typecheck                # next typegen && tsc --noEmit
npm run lint                     # eslint (next core-web-vitals + typescript)
npm run build                    # production build
npx next start -p 3100           # production server (after build)
npm run test:e2e                 # Playwright against PW_BASE_URL (default http://localhost:3100)
npm run oracle                   # proves the mock engine still equals designs/mock-data.js
```

### Running dev servers in parallel (one per variant)

`next.config.ts` reads `distDir` from `NEXT_DIST_DIR`, so each engineer runs an isolated dev server:

| Variant  | Command                                               | URL                            |
| -------- | ----------------------------------------------------- | ------------------------------ |
| Flowline | `NEXT_DIST_DIR=.next-flowline npx next dev -p 3101`   | http://localhost:3101/flowline |
| Atlas    | `NEXT_DIST_DIR=.next-atlas npx next dev -p 3102`      | http://localhost:3102/atlas    |
| Lanes    | `NEXT_DIST_DIR=.next-lanes npx next dev -p 3103`      | http://localhost:3103/lanes    |
| prod smoke | `npm run build && npx next start -p 3100`           | http://localhost:3100          |

- Use **exactly** these dist dir names. `tsconfig.json` pre-registers `.next-flowline|.next-atlas|.next-lanes/{types,dev/types}`. With any other name, `next dev` rewrites `tsconfig.json` (a shared file).
- `next-env.d.ts` is rewritten to point at whichever distDir ran last. It is gitignored and harmless. `npm run typecheck` resets it to `.next`.
- **Each server process has its own simulator state.** Every server starts from the same deterministic scenario at virtual 14:30. A PATCH on :3101 does not affect :3102.
- After editing anything under `src/server/mock/**`, restart the dev server. The singleton lives on `globalThis` and survives HMR on purpose.

---

## 2. File ownership

| Path | Owner | Notes |
| --- | --- | --- |
| `src/app/flowline/**`, `src/components/flowline/**`, `src/styles/flowline.css`, `e2e/flowline/**` | **Flowline engineer** | placeholder `layout.tsx`/`page.tsx`; replace freely |
| `src/app/atlas/**`, `src/components/atlas/**`, `src/styles/atlas.css`, `e2e/atlas/**` | **Atlas engineer** | 〃 |
| `src/app/lanes/**`, `src/components/lanes/**`, `src/styles/lanes.css`, `e2e/lanes/**` | **Lanes engineer** | 〃 |
| `src/app/page.tsx`, `src/components/landing/**`, `src/styles/landing.css`, `e2e/foundation/**` | foundation | landing chooser `/` |
| **everything else** (`src/app/layout.tsx`, `src/app/globals.css`, `src/app/api/**`, `src/server/**`, `src/lib/**`, `src/components/shared/**`, `src/fonts/**`, configs, `package.json`) | foundation (**frozen**) | do not edit; ask the lead |

Rules:

- A variant may add **any number of nested routes** under its own folder, for example `src/app/atlas/workflows/[id]/page.tsx`, `src/app/atlas/(screens)/dlq/page.tsx`, or its own `loading.tsx`/`error.tsx`.
- A variant must **not** add `/api` routes, edit `globals.css`, or install packages. If a shared change is needed (new endpoint, field, token, or primitive), send the lead the exact need. Do not patch shared files locally.
- Variant CSS: every rule goes under `[data-variant="<v>"]` (the placeholder layout renders `<div data-variant="<v>">`). Dark mode is `:root[data-theme="dark"] [data-variant="<v>"] …`. Do **not** `@import "tailwindcss"` in a variant CSS file because it duplicates preflight. For `@apply`, start the file with `@reference "../app/globals.css";`.
- Variant layouts must not render `<html>`/`<body>`. The root layout owns them along with fonts, theme and the live stream.
- Tailwind v4 scans the whole `src/` tree automatically, so utility classes used in variant components just work.

---

## 3. Architecture

```
designs/mock-data.js ──(verbatim port)──▶ src/server/mock/engine.ts   (createMockEngine(): same data, IDs, RNG order)
                                          src/server/mock/engine-types.ts  (typed surface of the engine — MockEngine)
                                          src/server/mock/runtime.ts       (globalThis singleton + 1.2s ticker + SSE fan-out)
                                          src/server/mock/projections.ts   (WorkflowSummary, TickSnapshot, results aggregates)
                                          src/server/services/*.ts         (validation + business rules per domain)
                                          src/server/http.ts               (handle(), Korean ApiError, Query parser, RBAC, idempotency)
                                          src/app/api/v1/**/route.ts       (thin handlers; runtime=nodejs, dynamic=force-dynamic)
src/lib/types.ts      ── all domain + API types (single source for client & server)
src/lib/catalog.ts    ── static catalog (stages, status meta, DAG template, capsules, colors…) — isomorphic, no fetch
src/lib/format.ts     ── fmt.* formatters (KST), port of MOCK.fmt
src/lib/client/**     ── api fetchers, useApi, LiveStreamProvider/useLiveStream, csv, useQueryState, operator
src/components/shared ── StatusPill, EChart, ThemeProvider/Toggle, CatalogIcon, useTween …
src/fonts/index.ts    ── next/font objects + CSS variables
```

- **Engine = verbatim port with a typed facade.** `engine.ts` contains the prototype body unchanged, wrapped in `createMockEngine()`, with `// @ts-nocheck`. Hand-typing 2,100 lines would risk changing RNG consumption order, which would change every ID. The typed boundary is `MockEngine` (`engine-types.ts`) plus `src/lib/types.ts`. Only the clearly marked "AIPO web extensions" block (`updateConfig`, `setGlobalStartsPerMinute`, `_internal`) was added; it never runs during the static build. **`npm run oracle`** fingerprints prototype vs port (workflows, DLQ, 2,400 result rows, events, logs, GCS, metrics, config, 12 simulator ticks, replay/capacity actions) and must print `ORACLE: IDENTICAL`.
- `src/lib/catalog.ts` is generated from the engine's initial state (`npm run gen:catalog`). Import it directly in client or server code. `GET /api/v1/meta` serves the same data.
- **Virtual clock.** The clock starts at `BASE_NOW = 2026-11-12T14:30:00+09:00`. Each 1.2 s real tick advances it by 20 s × speed, so 1× is about 16.7× real time. The virtual day rolls over midnight after about 34 real minutes at 1×. After that, "오늘"/today KPIs reset, as in the prototype. Restart the server to return to 14:30.
- **Idle guard.** If no SSE client is connected and no API request has arrived for 2 real minutes, ticks are skipped (`SimState.idle`). The next request resumes ticking.
- All `*_at`/`ts` values are **epoch ms in virtual time**. Never compare them with `Date.now()`.

---

## 4. REST API reference (`/api/v1`)

Conventions

- JSON in and out. Errors are `ApiErrorBody = { error: { code, message (Korean), details? } }` with `400 INVALID_ARGUMENT`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT` or `500 INTERNAL`.
- **List params**: comma-separated or repeated (`status=RUNNING,QUEUED`). **Time params** (`from`, `to`): epoch ms (preferred) or ISO-8601. In a raw URL, `+09:00` must be encoded as `%2B09:00`.
- **Pagination**: `page` (1-based) and `pageSize`. Responses carry `{ items|rows, total, page, pageSize }`.
- **Operator**: header `x-operator` holds an operator **id**, name or email, URI-encoded because browsers cannot send raw Korean header values. The default is `op-kim-sy` (김서연, Admin). `api.*` sends it automatically (see §6.6).
- **RBAC** (from `ROLE_PERMISSIONS`): Viewer = read and export; Operator = `cancel`, `replay.request`, `language.pause` and alert ack/resolve; Admin = all, including `config.write` and `version.promote`.
- **`reason` is required** on every state change (capacity, global, config, replay, batch replay). Missing reason → 400 `변경 사유(reason)을(를) 입력해 주세요.` Cancel defaults its reason. Close uses `resolution`.
- **`Idempotency-Key`** header (optional) on POST/PATCH: the first **successful** response is cached for 10 minutes and replayed with `idempotent-replay: true`. Errors are not cached. `api.*` auto-generates a key per call.
- Every operator mutation (all POST/PATCH except `/sim`) appends an `AuditEntry` (`GET /audit`, SSE `audit`) and, where meaningful, a `CONFIG_UPDATED`/`REPLAY_*`/`CANCEL_*` event.

### 4.1 Overview / meta

| Method | Path | Params | Response type |
| --- | --- | --- | --- |
| GET | `/overview` | — | `Overview` (KPIs + `statusDistribution` + `errorDistribution7d` + `capacity`) |
| GET | `/meta` | — | `MetaCatalog` (same as `@/lib/catalog`) |
| GET | `/me` | header `x-operator` | `MeInfo { operator, permissions: Record<key, boolean> }` |
| GET | `/operators` | — | `{ operators: Operator[]; rolePermissions: RolePermission[] }` |

### 4.2 Workflows (S3 Explorer · S4 Detail)

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/workflows` | `q` (id, batch, object, idempotency key, correlation/trace id, job id, error code, dlq id), `workflow_id` (substring), `pipeline_job_id` (substring), `language`[], `status`[], `version`[] (alias `pipeline_version`), `stage`, `batch_id`, `event_type` (`pipeline.batch.requested`/`pipeline.batch.replay.requested`), `error_code`, `error_category`, `from`, `to` (on `created_at`), `has_retries`, `replay`, `active`, `sort` = `created_desc`(default)/`created_asc`/`wait_desc`/`run_desc`/`updated_desc`/`attempts_desc`, `page`, `pageSize` (default 50, ≤500) | `WorkflowListResponse` = `Paginated<WorkflowSummary>` + `facets {status, language, version}` |
| GET | `/workflows/[id]` | — | `Workflow` (full: `attempts[]` each with `dag[]`, `status_history`, `input`, `result`, `error`) |
| GET | `/workflows/[id]/events` | — | `WorkflowEvent[]` ascending, only `ts <= now` |
| GET | `/workflows/[id]/logs` | `component`[], `service`[], `severity`[], `min_severity`, `attempt`, `event_type`, `trace_id`, `error_code`, `q`, `from`, `to`, `order` (`asc` default), `limit` | `LogPage { items, total, components[], services[] }` |
| GET | `/workflows/[id]/attempts` | — | `AttemptHistory { attempts, retryPolicy, replayChain: WorkflowSummary[], replays }` |
| GET | `/workflows/[id]/dag` | — | `WorkflowDag { nodes: DagNode[], edges, current_node, attempts[{attempt, nodes}] }` |
| GET | `/workflows/[id]/results` | — | `{ rows: ResultRow[]; summary: ResultsSummary \| null }` (SUCCEEDED only) |
| POST | `/workflows/[id]/cancel` | body `{ reason? }` · perm `cancel` | `WorkflowSummary`; 409 if already terminal |

`WorkflowSummary` is the slim list row (no `attempts`/`dag`). It adds `attemptsCount`, `retries`, `lastErrorCode` and `pipeline_job_id` of the latest attempt.

### 4.3 Capacity (S2)

| Method | Path | Params / body | Response |
| --- | --- | --- | --- |
| GET | `/languages/capacity` | — | `CapacitySnapshot { at, global, languages: LanguageCapacity[], reservationsActive, reservationsOrphaned }` |
| GET | `/languages/[lang]/capacity` | `lang` ∈ ko,en,ja,es (else 404) | `LanguageCapacity` |
| PATCH | `/languages/[lang]/capacity` | `?dry_run=1` (no change, reason optional) · body `{ max_concurrent? 0–100 (≤ global), priority_weight? 1–10, max_starts_per_minute? 1–60, paused?, enabled?, reason }` · perm `language.pause` if body is only `{paused, reason}`, else `config.write` | `CapacityChangeResult { dryRun, language, capacity, impact: CapacityImpact[], audit[] }` |
| GET | `/capacity/global` | — | `GlobalCapacity { maxConcurrent, maxStartsPerMinute, active, utilization }` |
| PATCH | `/capacity/global` | `?dry_run=1` · body `{ max_concurrent? (≥ largest language max, ≤200), max_starts_per_minute? 1–120, reason }` · perm `config.write` | `GlobalCapacityChangeResult { dryRun, global, impact[], audit[] }` |
| GET | `/reservations` | `status`[] (ACTIVE/RELEASED/ORPHANED), `language` | `Reservation[]` newest first |

`CapacityImpact.message` is a ready-to-show Korean impact analysis (plan §6.3 S2 "기존 실행 영향 분석"), for example lowering below active count or the effect of pausing.

### 4.4 DLQ / Replay (S5)

| Method | Path | Params / body | Response |
| --- | --- | --- | --- |
| GET | `/dead-letters` | `status`[] (PENDING_REVIEW/APPROVED/REPLAYING/REPLAYED/CLOSED), `language`[], `category`[], `error_code`, `operator` (assigned id), `q`, `from`, `to`, `sort` = `created_desc`/`created_asc`/`updated_desc`/`attempts_desc`, `page`, `pageSize` (default 100) | `DeadLetterList` = `Paginated<DeadLetter>` + `facets {status, category, language}` |
| GET | `/dead-letters/[id]` | id = dead_letter_id **or** workflow_id | `DeadLetterDetail { deadLetter, workflow, replays, replayWorkflows, events, recentLogs }` |
| POST | `/dead-letters/[id]/replay` | body `{ reason, pipeline_version?, priority? 1–10 }` · perm `replay.request` | **201** `ReplayResult { deadLetter, replay, workflow }`; 409 if REPLAYING/REPLAYED/CLOSED |
| POST | `/dead-letters/replay-batch` | body `{ ids: string[] (≤100), reason, pipeline_version? }` · perm `replay.request` | `BatchReplayResult { succeeded, failed, results[{id, ok, error?, replay?, workflow?}] }` (per-item errors, 200) |
| POST | `/dead-letters/[id]/close` | body `{ resolution }` · perm `replay.request` | `DeadLetter`; 409 if CLOSED or REPLAYING |
| POST | `/dead-letters/[id]/assign` | body `{ operator_id: string \| null, reason? }` · perm `replay.request` | `DeadLetter` |
| GET | `/replays` | `dead_letter_id`, `status`[] | `Replay[]` newest first |

A replay creates a new workflow (`replay_cycle + 1`, priority 8) that enters the queue. The DLQ item becomes `REPLAYING`, then `REPLAYED` (success) or `PENDING_REVIEW` (failure) as the simulator advances.

### 4.5 Analytics (S1 charts · S7)

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/analytics/throughput` | `granularity` = `hour`(default)/`5m`; `range` = `6h`/`12h`/`24h`/`48h`/`7d`(default; hour only) | `ThroughputSeries { ts, byLanguage, utterances, total, queueDepth?, active? }` (5m = today, live-appended) |
| GET | `/analytics/quality` | `range` | `QualitySeries { ts, successRate, retryRate, avgDurationSec, p95DurationSec }` |
| GET | `/analytics/errors` | `range`, `top` (default 20) | `ErrorAnalytics { top: ErrorCategoryCount[], hourly.byCategory, topErrorCodes[] }` |
| GET | `/analytics/components` | — | `ComponentDuration[]` (avg/p95 per DAG component, byLanguage, byVersion) |
| GET | `/analytics/versions` | — | `VersionComparison[]` (v1.0/v1.1/v1.2-rc: success, retry, duration, pass rate, byCapsule, cost) |
| GET | `/analytics/languages` | — | `LanguageSummary[]` |
| GET | `/analytics/cost` | — | `CostAnalytics { daily[], total7d, byComponent7d }` |
| GET | `/analytics/daily` | — | `DailyMetrics[]` (8 days, last `partial`) |
| GET | `/analytics/summary` | — | `AnalyticsSummary` (hourly + fiveMin + daily + all of the above in one call) |

Note: `metrics.*` are BigQuery-style platform aggregates (larger scale than the ~140-workflow registry sample), as in the prototype.

### 4.6 Stages / GCS (pipeline map + stage inspector)

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/stages` | — | `StageSummary[] { stage, count, counts by status, byLanguage }` (10 stages) |
| GET | `/stages/[id]` | `limit` (events/logs, default 60) | `StageDetail { stage, workflows: WorkflowSummary[], counts, gcsObjects, events, logs, metrics }` |
| GET | `/gcs/buckets` | — | `GcsBucket[]` (3 buckets, live objectCount/totalBytes) |
| GET | `/gcs/objects` | `bucket` (required), `prefix`, `delimiter` (default `/`; pass `delimiter=` for flat), `limit` | `GcsListing { prefixes, prefixCounts, objects }` |
| GET | `/gcs/object` | `bucket`, `name`, `limit` (lines, default 20) | `GcsObjectContent { object, content }`. Content is a JSONL preview, CSV head, summary JSON or compiled pipeline YAML |

Stage `workflows`: for stages with states, the workflows currently in those states. For `gcs_input`/`event_bus` (no states), the workflows created in the last 30 virtual minutes.

`StageDetail.metrics` keys per stage:

| stage | metrics keys |
| --- | --- |
| `gcs_input` | `objectsToday, bytesToday, utterancesToday, lastUploadAt, byLanguage` |
| `event_bus` | `deliveredToday, avgDeliveryLatencyMs, p95DeliveryLatencyMs, redeliveriesToday, subscriptionBacklog, deadLetterTopicMessages` |
| `ingress` | `receivedToday, validatedToday, duplicatesIgnoredToday, validationErrorsToday, p95RegistrationLatencyMs, inFlight` |
| `registry_queue` | `queued, byLanguage, oldestQueuedAt, p95WaitSec` |
| `scheduler` | `activeSlots, globalMax, reservationsActive, reservationsOrphaned, admissionsLastHour, saturatedLanguages[]` |
| `workflows` | `dispatching, executionsToday, cancelledToday, timedOut7d, p95StartLatencyMs` |
| `vertex` | `running, runningByComponent{preprocess…persist}, utterancesInFlight, gpuInUse, gpuQuota, avgDurationSec` |
| `results` | `succeededToday, rowsWrittenToday, csvBytesToday, bqTable, passRateToday, aggregateFile` |
| `retry` | `retryWait, retriesToday, retryRate, nextRetryAt, policy` |
| `dlq` | `pendingReview, total, byStatus, byCategory, replays` |

### 4.7 Results (per-utterance PASS/FAIL)

| Method | Path | Params | Response |
| --- | --- | --- | --- |
| GET | `/results` | `language`[], `capsule`[] (id or Korean label), `intent`[], `device`[], `version`[], `result` (PASS/FAIL), `failure_reason`[], `workflow_id`, `batch_id`, `q` (utterance/asr/responses/intents/judge reason), `min_score`/`max_score` (0–1), `min_latency`/`max_latency` (ms), `from`/`to` (eval_ts), `ids`[], `sort` = `eval_desc`(default)/`eval_asc`/`score_asc`/`score_desc`/`latency_desc`/`latency_asc`/`id_asc`, `page`, `pageSize` (default 50, ≤1000) | `ResultsPage { rows, total, page, pageSize, aggregates: ResultsAggregates, file }` |
| GET | `/results/[utterance_id]` | — | `ResultDetail { row, workflow, inputLine }` (`inputLine` is the raw JSONL input) |
| GET | `/results/file` | — | `ResultFileMeta { file, files[3], columns, bigquery }` |
| GET | `/results/csv` | same filters as `/results` + `ids`[] (selected rows) + `columns`[] + `filename` | `text/csv; charset=utf-8` with a **UTF-8 BOM** (`ef bb bf`), CRLF, `Content-Disposition: attachment; filename="bixby-eval-results_<date>[_<lang>_<version>_<result>\|_selected].csv"`, `x-row-count` |

`ResultsAggregates` is computed over the **filtered** rows. Chart fields: `byLanguage`, `byCapsule`, `byIntent`, `byDevice`, `byVersion`, `byCapsuleVersion`, `byFailureReason`, `byDate`, `byHour`, `capsuleLanguage` (capsule × language matrix of `RateStat`), `judgeScoreHistogram[10]`, `latencyHistogram[13]` (1 s buckets, last = 12 s+), plus `latency {avgMs,p50Ms,p95Ms}`, `avgJudgeScore`, `total/pass/fail/passRate`.

Data: about **2,400 rows** at start (today's succeeded workflows: ko 12×100, en 4×200, ja 5×50, es 3×50), growing as the simulator completes workflows. Utterances are Korean, English, Japanese and Spanish. `capsule` is the Korean label and `capsule_id` the key.

### 4.8 Config / audit / alerts (S6)

| Method | Path | Params / body | Response |
| --- | --- | --- | --- |
| GET | `/config` | — | `AppConfig` (languages, global, retry, timeouts, queuePolicy, pipelineVersionDetails, services, alertPolicies, operators, rolePermissions, buckets, bigquery, **`terraformDefaults` vs `runtimeConfig` → `drift: DriftItem[]`**) |
| PATCH | `/config` | `ConfigPatch & { reason }`: `retry {maxRetries 0–5, backoffSeconds int[] 1–3600}`, `workflowTimeoutMin`/`pipelineTimeoutMin` 5–360 (pipeline ≤ workflow), `queuePolicy {mode: PRIORITY_THEN_FIFO\|FIFO, aging {enabled, boostPerMinutes, maxBoost}}`, `defaultPipelineVersion` (not DEPRECATED), `versionTraffic {ver: pct}` (sum must be 100), `services {id: {enabled}}`, `alertPolicies {id: {enabled}}` · perm `config.write` (`version.promote` when the body has defaultPipelineVersion/versionTraffic) | `ConfigUpdateResult { changed[], config, audit[] }` |
| GET | `/audit` | `actor` (id or name), `action`[], `target` (substring), `q`, `from`, `to`, `page`, `pageSize` | `Paginated<AuditEntry>` newest first |
| GET | `/alerts` | `status`[] (OPEN/ACKNOWLEDGED/RESOLVED), `severity`[], `language` | `Alert[]` newest first |
| POST | `/alerts/[id]/ack` | body `{ note? }` · Operator+ | `Alert`; 409 if already ACK/RESOLVED |
| POST | `/alerts/[id]/resolve` | body `{ note? }` · Operator+ | `Alert`; 409 if RESOLVED |
| GET | `/incidents` | — | `Incident[]` (INC-20261112-01 MONITORING, INC-20261110-01 RESOLVED) |

Drift at start: `languages.ko.maxConcurrent` 8→10, `languages.en.maxStartsPerMinute` 10→8, `global.maxConcurrent` 32→36 and `workflowTimeoutMin` 60→90, each with changedBy/changedAt/reason.

### 4.9 Global feeds and simulator

| Method | Path | Params / body | Response |
| --- | --- | --- | --- |
| GET | `/events` | `limit` (default 50), `stage`, `language`, `severity`[], `name`[] | `WorkflowEvent[]` newest first (`ts <= now`) |
| GET | `/logs` | `system=1` (scheduler/reconciler/operations-api), `workflow_id`, `service`[], `component`[], `severity`[], `min_severity`, `language`, `trace_id`, `pipeline_job_id`, `error_code`, `event_type`, `q`, `from`, `to` (default now), `order` (`desc` default), `limit` (default 200) | `LogPage` |
| GET | `/sim` | — | `{ sim: SimState, snapshot: TickSnapshot }` |
| POST | `/sim` | `{action:"pause"}` · `{action:"resume"}` · `{action:"speed", speed: 0.25–20}` · `{action:"step", steps?: 1–50}` (works while paused) · `{action:"inject", language?}` (new GCS batch; 201) | `{ sim, snapshot?, workflow? }` |

### 4.10 SSE — `GET /api/v1/stream`

`text/event-stream`. Optional `?types=tick,transition,…` filter (default: all). On connect the server sends `retry: 3000`, then `event: hello` (`{ sim, serverTime }`) and an immediate `tick`. `: keep-alive` comments follow every 15 s. The subscriber is removed on disconnect (`SimState.subscribers` shows the live count).

| event | payload type | when |
| --- | --- | --- |
| `tick` | `TickSnapshot { tick, now, nowIso, speed, running, counts (by status), stageCounts, kpis (Overview without capacity/statusDistribution), capacity, active: ActiveWorkflowPos[], totalWorkflows, dlqTotal, auditCount }` | every 1.2 s |
| `transition` | `TransitionMessage { workflow_id, language, from, to, stage, at, workflow: ActiveWorkflowPos }` | every status change |
| `event` | `WorkflowEvent` | every registry event (~10–60 / tick) |
| `log` | `LogEntry` | **high volume** (~20–40 / tick); subscribe only where you render live logs |
| `alert` | `Alert` | raised / acknowledged / resolved |
| `audit` | `AuditEntry` | every operator action |
| `dlq` | `DeadLetter` | DLQ created / replayed / closed / assigned |
| `sim` | `SimState` | pause / resume / speed |

---

## 5. Domain cheat-sheet

- **Status → stage** (`STATE_TO_STAGE`): RECEIVED/VALIDATED→`ingress`, QUEUED→`registry_queue`, RESERVED→`scheduler`, DISPATCHING/CANCELLED/TIMED_OUT→`workflows`, RUNNING→`vertex`, RETRY_WAIT→`retry`, SUCCEEDED→`results`, DEAD_LETTERED→`dlq`. `gcs_input`/`event_bus` hold no workflows. Their counts come from `/stages/[id]` metrics.
- **Stages** (`STAGES`, 8 main + 2 branch) and **edges** (`STAGE_EDGES`, with `tone`/`dashed`) are what the pipeline maps draw. `DAG_TEMPLATE` gives the six Vertex components: preprocess → (intent_eval ‖ response_eval ‖ latency_check) → aggregate → persist.
- **Meta maps** (Korean labels, tone, lucide icon name): `STATUS_META`, `NODE_STATUS_META`, `ATTEMPT_STATUS_META`, `DLQ_STATUS_META`, `SEVERITY_META`, `FAILURE_CATEGORY_META` (with retry policy text), `FAILURE_REASON_META`, `EVENT_CATALOG`.
- IDs: `wf-20261112-ko-0033`, `wf-…-cycle-0-attempt-1` (PipelineJob), `dlq-20261112-014`, `rpl-20261112-006`, `ALT-0005`, `aud-00030`, `utt-20261112-ja-0005-0050`.
- Operators: `op-kim-sy` 김서연 Admin (default), `op-han-dy` 한도윤 Admin, `op-park-jh` 박지훈 Operator, `op-lee-he` 이하은 Operator, `op-jung-yn` 정유나 Operator, `op-choi-mj` 최민준 Viewer, `op-sato-k` Kenji Sato Viewer.
- Capacity at start: ko 10 (saturated with a backlog), en 25, ja 5, es 4; global 36.

---

## 6. Client data layer — `@/lib/client`

### 6.1 `useApi` with live revalidation (the main pattern)

```tsx
"use client";
import { api, useApi } from "@/lib/client";

const q = { language: ["ko"], status: ["RUNNING", "QUEUED"], page: 1, pageSize: 50 } as const;

export function RunningTable() {
  const { data, error, isLoading, isValidating, mutate } = useApi(["workflows", q], () => api.workflows(q), {
    revalidateOn: ["transition"], // refetch (throttled 1.5 s) whenever a workflow changes state
  });
  if (isLoading) return <Skeleton />;
  if (error) return <p>{(error as Error).message}</p>; // ApiClientError → Korean message
  return <Table rows={data!.items} total={data!.total} />;
}
```

- `useApi(key, fetcher, opts?)`: `key` is any JSON-serializable value (`null` skips the request). The same key shares one cache entry and one in-flight request.
- `opts`: `revalidateOn?: StreamEventType[]`, `throttleMs` (1500), `refreshInterval` (ms polling, 0), `revalidateOnFocus` (true), `keepPrevious` (true: old data stays visible while a new key loads).
- Returns `{ data, error, isLoading (no data yet), isValidating, updatedAt, mutate }`. `mutate()` refetches; `mutate(data)` writes optimistically.
- `revalidateKey("workflows")` refetches every mounted query whose serialized key contains the string. Call it after a POST.
- Recommended `revalidateOn`: lists/details → `["transition"]`; DLQ → `["dlq"]`; alerts → `["alert"]`; audit → `["audit"]`; capacity → `["tick"]`, or read `snapshot.capacity` directly.

### 6.2 Live stream

```tsx
import { useLiveStream, useSimNow, useStreamEvent } from "@/lib/client";

const { snapshot, status } = useLiveStream();     // TickSnapshot | null; "connecting" | "open" | "reconnecting" | …
const now = useSimNow();                            // virtual epoch ms (BASE_NOW before first tick)
useStreamEvent("transition", (t) => flash(t.workflow_id));        // auto-unsubscribes on unmount
useStreamEvent("log", (l) => { if (l.workflow_id === id) append(l); });
const { subscribe } = useLiveStream();              // imperative: const off = subscribe("alert", cb)
```

The root layout mounts **one** `LiveStreamProvider` (EventSource with exponential reconnect from 1 s to 30 s). Do not open your own EventSource. For KPI strips, pipeline counts and token animation, read `snapshot` (`kpis`, `counts`, `stageCounts`, `capacity`, `active[]`) directly; no fetch is needed.

### 6.3 Typed fetchers — `api.*`

`overview, meta, me, operators, workflows(q), workflow(id), workflowEvents(id), workflowLogs(id,q), workflowAttempts(id), workflowDag(id), workflowResults(id), cancelWorkflow(id,{reason}), capacity(), languageCapacity(lang), patchLanguageCapacity(lang, body, {dryRun}), setLanguagePaused(lang, paused, reason), globalCapacity(), patchGlobalCapacity(body,{dryRun}), reservations(q), deadLetters(q), deadLetter(id), replayDeadLetter(id,{reason,pipeline_version?,priority?}), replayBatch({ids,reason,pipeline_version?}), closeDeadLetter(id,{resolution}), assignDeadLetter(id,{operator_id,reason?}), replays(q), throughput(q), quality(q), errors(q), components(), versions(), languages(), cost(), daily(), analyticsSummary(), stages(), stage(id,q), buckets(), gcsObjects(q), gcsObject(q), results(q), result(uttId), resultFile(), config(), patchConfig(body), audit(q), alerts(q), ackAlert(id,{note}), resolveAlert(id,{note}), incidents(), events(q), logs(q), sim(), simPause(), simResume(), simSpeed(n), simStep(n), simInject(lang?)`

Query param types: `WorkflowQuery`, `LogQuery`, `GlobalLogQuery`, `DeadLetterQuery`, `ResultQuery`, `AuditQuery`, `Range`. Errors throw `ApiClientError { status, code, message, details }`. Low level: `request<T>(path, { method, body, operator, idempotencyKey })` and `qs(params)`.

```tsx
try {
  const r = await api.replayDeadLetter(dl.dead_letter_id, { reason, pipeline_version: "v1.1" });
  toast(`Replay ${r.replay.replay_id} → ${r.workflow.workflow_id}`);
  revalidateKey("dead-letters");
} catch (e) {
  if (e instanceof ApiClientError && e.status === 409) toast(e.message); // "이미 Replay가 진행 중입니다: …"
}
```

### 6.4 CSV

```tsx
import { csvUrl, downloadCsv } from "@/lib/client";
<a href={csvUrl({ language: ["ko"], result: "FAIL" })}>CSV 다운로드</a>
downloadCsv({ ids: selectedIds });                    // selected rows only
downloadCsv(filters, { filename: "ko-fail.csv" });    // the server sets Content-Disposition + BOM
downloadText(jsonl, "logs.jsonl");                    // export arbitrary text (e.g. logs)
```

### 6.5 URL-synced filters

```tsx
import { parseAsInt, parseAsList, parseAsString, useQueryState, useQueryStates } from "@/lib/client";

const PARSERS = { status: parseAsList, language: parseAsList, sort: parseAsString.withDefault("created_desc"), page: parseAsInt.withDefault(1) };
// ↑ module-level constant: an inline object would change identity on every render

function Filters() {
  const [f, setF] = useQueryStates(PARSERS);   // { status: string[], language: string[], sort: string, page: number }
  const [q, setQ] = useQueryState("q");        // string | null
  setF({ status: ["RUNNING"], page: 1 });      // router.replace, scroll preserved; default values are removed from the URL
}
// The page that renders <Filters/> must wrap it in <Suspense> (useSearchParams requirement).
```

### 6.6 Operator (who am I)

`const [operator, setOperatorId] = useOperator();` persists to `localStorage("aipo.operator")`. Every `api.*` call then sends `x-operator`. Switching to `op-choi-mj` (Viewer) makes mutations return 403 with a Korean message, which is useful for demonstrating RBAC.

---

## 7. Shared components — `@/components/shared`

All are design-neutral. Colors come from tokens; shape and size come from your CSS.

| Component / hook | Props | Notes |
| --- | --- | --- |
| `StatusPill` | `status`, `kind?: "workflow"(default)\|"node"\|"attempt"\|"dlq"`, `label?`, `english?`, `showIcon?`(true), `spin?`(true), `size?: "xs"\|"sm"\|"md"`, `unstyled?`, `className`, `style`, `title` | renders `<span class="st-pill" data-tone data-status data-size style="--tone: var(--st-…)">` + icon + `.st-label` |
| `StatusIcon` | `status`, `kind?`, `size?`(14), `spin?`, `className`, `title` | colored lucide icon (`role=img`, Korean aria-label) |
| `TonePill` | `tone: Tone`, `icon?` (catalog icon name), `children`, `size?`, `unstyled?` | generic tone chip (for example `<TonePill tone="retry" icon="rotate-ccw">Backoff 60s</TonePill>`) |
| `SeverityBadge` | `severity: Severity`, `unstyled?` | DEBUG…CRITICAL using `SEVERITY_META` tones |
| `LangBadge` | `lang`, `display?: "code"\|"name"\|"both"`, `unstyled?` | `.lang-badge` with `--lang` var |
| `LangDot` | `lang`, `size?`(8) | colored dot |
| `CatalogIcon` | `name` (kebab-case catalog icon) + `LucideProps` | **use this in render** instead of `const Icon = iconFor(x)` (blocked by lint) |
| `statusInfo(kind, status)`, `toneVar(tone)`, `langVar(lang)`, `ICONS`, `iconFor(name)` | helpers | `toneVar("failed")` → `"var(--st-failed)"` |
| `EChart` | `option: EChartsOption \| (t: ChartTokens) => EChartsOption`, `className`/`style` (**must give a height**), `renderer?`, `setOptionOpts?` (default `{notMerge:true}`), `onEvents?: {click: (p, chart) => …}`, `onReady?`, `loading?`, `ariaLabel?` | client-only, lazy-loads echarts, ResizeObserver, **re-themes on `data-theme`/OS change** when `option` is a function |
| `ChartTokens` | `{ theme, text, muted, grid, surface, tooltipBg, font, mono, tone: Record<Tone,string>, lang: Record<LangCode,string>, read(name, fallback?) }` | read from the chart element via `getComputedStyle`. Override `--chart-text/-muted/-grid/-surface/-tooltip-bg/-font/-mono` inside `[data-variant]` |
| `ThemeProvider`, `ThemeScript` | (root layout only) | preference `system\|light\|dark` in `localStorage("aipo.theme")`; resolved theme on `<html data-theme>` |
| `useTheme()` | → `{ preference, resolved, setPreference, toggle }` | the preference is **shared by all variants** |
| `ThemeToggle` | `className`, `iconSize?`, `title?` | unstyled button (`data-theme-control="toggle"`, `data-resolved`) |
| `ThemeSelect` | `className`, `itemClassName`, `showLabels?`, `iconSize?` | radiogroup 시스템/라이트/다크 (`data-active` on the current one) |
| `useTween(value, {duration?=600, decimals?, fromZero?, easing?})` | → animated number | returns the raw value under `prefers-reduced-motion` |
| `usePrefersReducedMotion()` | → boolean | (for motion components use `useReducedMotion` from `motion/react`) |
| `fmt` (also `@/lib/format`) | `bytes, number(n,d), pct(x,d), usd, duration(ms,{style:"short"}), time, timeMs, hm, date, dateKo, dateTime, iso, relative(ts, now), shortHash, shortWorkflowId` | all KST. `relative` **needs `useSimNow()`** |

Example:

```tsx
<EChart
  className="h-56"
  ariaLabel="언어별 처리량"
  option={(t) => ({
    textStyle: { fontFamily: t.font, color: t.text },
    grid: { left: 36, right: 8, top: 12, bottom: 24 },
    tooltip: { trigger: "axis", backgroundColor: t.tooltipBg, textStyle: { color: t.text } },
    xAxis: { type: "time", axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.grid } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
    series: LANG_CODES.map((l) => ({ type: "line", name: l, showSymbol: false, color: t.lang[l],
      data: tp.ts.map((x, i) => [x, tp.byLanguage[l][i]]) })),
  })}
/>
```

### Global CSS tokens (`src/app/globals.css`)

- Status: `--st-success|running|queued|retry|failed|dlq|cancelled`. Light values are `#1f8f4e #2a78d6 #7a8190 #c27a00 #d23f3f #7d3cc8 #5c6370`; dark values are `#3fb871 #3987e5 #9aa0aa #e0a42a #e66767 #a77ff0 #8b929c`.
- Language: `--lang-ko|en|ja|es`. Light values are `#2a78d6 #eb6834 #1baf7a #eda100`; dark values are `#3987e5 #d95926 #199e70 #c98500`. The same hex values are exported as `TONE_COLORS`/`LANG_COLORS` from `@/lib/catalog`.
- Tailwind utilities: `text-st-failed`, `bg-st-running/15`, `border-lang-ko`, `dark:` (follows `data-theme`).
- Typesetting utilities: `.tnum` (tabular numbers), `.ko-tight` (-0.02em), `.ko-tighter` (-0.035em), `.break-id` (long IDs/URIs).
- Base defaults: `word-break: keep-all`, `line-break: strict`, `overflow-wrap: break-word`, antialiased smoothing, headings at -0.012em with `text-wrap: balance`.

---

## 8. Fonts — `src/fonts/index.ts`

Every font is self-hosted through `next/font`, with no runtime Google requests. All CSS variables are set on `<html>` by the root layout.

| Variable | Family | Source | Weights | Preload |
| --- | --- | --- | --- | --- |
| `--font-pretendard` | Pretendard Variable | `pretendard/dist/web/variable/woff2/PretendardVariable.woff2` | 45–920 | **yes** |
| `--font-flowline-sans` | = `var(--font-pretendard)` (alias in globals.css; one file shared) | | | |
| `--font-flowline-mono` | JetBrains Mono | Google (self-hosted) | variable 100–800 | no |
| `--font-atlas-sans` | SUIT Variable | `@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.woff2` | 100–900 | no |
| `--font-atlas-mono` | IBM Plex Mono | Google | 400 / 500 / 600 | no |
| `--font-lanes-display` | Wanted Sans Variable | `wanted-sans/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2` | 400–1000 | no |
| `--font-lanes-sans` | = `var(--font-pretendard)` | | | |
| `--font-lanes-mono` | Fira Code | Google | variable 300–700 | no |

- Usage: `font-family: var(--font-atlas-sans)` in your CSS, or Tailwind `font-landing`, `font-flowline`, `font-flowline-code`, `font-atlas`, `font-atlas-code`, `font-lanes`, `font-lanes-title`, `font-lanes-code`. The Tailwind keys differ from the CSS variable names on purpose: a theme key equal to the variable name (for example `--font-flowline-mono: var(--font-flowline-mono)`) would be self-referencing and break the font.
- Only Pretendard is preloaded. The other faces download when text first renders in them, so a variant page fetches only its own fonts. Sizes: Pretendard 2.0 MB, Wanted Sans 1.3 MB, SUIT 0.6 MB (full variable files, no subsetting).
- The placeholder layouts set `font-flowline` / `font-atlas` / `font-lanes` on the variant root.
- Verified in Chromium: all 8 variables resolve and `document.fonts.check()` returns true for each family, in both themes.

---

## 9. Gotchas

1. **Time.** Never use `Date.now()` or `new Date()` for "n분 전", ages or SLA math. Use `useSimNow()` and `fmt.relative(ts, now)`. Every timestamp is virtual.
2. **`useSearchParams` / `useQueryState`** requires a `<Suspense>` boundary around the component, or `next build` fails on statically prerendered pages.
3. **Lint (react-hooks v7 rules are errors).** Calling `setState` synchronously in an effect is rejected; derive the value or use `useSyncExternalStore`. Reading `ref.current` during render is rejected. `const Icon = iconFor(x); <Icon/>` inside a component is rejected; use `<CatalogIcon name={x}/>`. `setState` inside rAF or event callbacks is fine.
4. **next/font** options must be inline literals: no shared constants or spreads.
5. **`x-operator` header** must be URI-encoded (`encodeURIComponent("박지훈")`) or an operator id. `api.*` already does this.
6. **Idempotency** caches successful responses only. Retrying after a 4xx re-executes the call.
7. **ISO times in URLs**: `+` decodes to a space, so encode it as `%2B` or pass epoch ms.
8. **Variant CSS**: do not `@import "tailwindcss"`; scope everything under `[data-variant="…"]`; use `@reference "../app/globals.css"` for `@apply`.
9. **motion** imports come from `"motion/react"` (`motion`, `AnimatePresence`, `useReducedMotion`). d3-zoom/d3-selection are ESM and work in client components.
10. **EChart** needs an explicit height. Pass `option` as a function if colors should follow the theme.
11. **SSE `log` volume** is about 20–40 per tick. Filter by `workflow_id` in the callback and cap your buffer (for example the last 500).
12. **List endpoints return `WorkflowSummary`** (no `attempts`/`dag`). Fetch `/workflows/[id]` or `/dag` for detail.
13. The engine's arrays are live server state. Never mutate API payloads expecting a server change; call the mutation endpoint.
14. **Playwright**: put specs in `e2e/<variant>/`. Run them with `PW_BASE_URL=http://localhost:3101 npx playwright test e2e/flowline`. Chromium for @playwright/test 1.65 is installed. If it is missing, run `npx playwright install chromium`.
15. **Restart dev after editing `src/server/mock/**`** (globalThis singleton). After any change to `engine.ts`, run `npm run oracle`.
16. Pages are statically prerendered shells that fetch on the client. That is intended: everything live comes from `/api/v1` and the stream.

---

## 10. Verification record (foundation hand-off)

- `npm run oracle` → **ORACLE: IDENTICAL**: 140 workflows, 14 DLQ, 2,400 result rows, 3,440 events, 4,979 logs, plus identical state after 12 simulator ticks, a DLQ replay and a capacity update.
- `npm run typecheck`, `npm run lint`, `npm run build` all pass. In the build output all 51 `/api/v1/*` routes are dynamic (ƒ); `/`, `/flowline`, `/atlas` and `/lanes` are static shells.
- `next start -p 3100` curl sweep:
  - Every GET endpoint returns 200, including filters, pagination, ISO and epoch time ranges, and Korean `q`.
  - Bad inputs return Korean 400/404 errors.
  - SSE delivered 5 `tick` messages in 5 s plus transition/event/log messages. Subscribers return to 0 after disconnect.
  - CSV returns `text/csv; charset=utf-8` with `Content-Disposition: attachment`, a BOM (`ef bb bf`) and `x-row-count`; the selected-ids export also works.
- Mutations:
  - Capacity PATCH works, including dry-run, pause/resume as Operator, and range/global-max validation.
  - Global PATCH works.
  - Replay returns 201 on the first call and 409 on a repeat; bad versions return 400; batch replay reports per-item results.
  - Assign works; close of a replaying item returns 409.
  - Cancel works for queued and running workflows, returns 409 when already terminal and 403 for a Viewer.
  - Alert ack works and a second ack returns 409.
  - Config PATCH works for retry, traffic, services and alert policies, with validation errors where expected.
  - `sim` pause/resume/speed/step/inject all work, and idempotent replay returns the `idempotent-replay: true` header.
  - The audit trail shows the correct actor and role for each of these.
- Two dev servers (`.next-flowline` on :3101 and `.next-atlas` on :3102) ran concurrently without modifying `tsconfig.json`.
- Playwright (Chromium) checks:
  - All fonts load in light and dark.
  - There are no console errors.
  - At 390 px there is no horizontal overflow.
  - `npm run test:e2e` (`e2e/foundation/smoke.spec.ts`, desktop and mobile) passes 4/4.
