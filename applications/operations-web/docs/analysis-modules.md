# 분석 모듈 (Analysis Modules) — 품질 대시보드 · 심층 분석 구현 스펙

| 항목 | 내용 |
| --- | --- |
| 문서 버전 | v1.0 (2026-11-14) |
| 대상 | Data(BigQuery) · ML Pipeline · Operations API(FastAPI) · Platform · Product/Capsule 담당 |
| 근거 (코드) | `src/server/services/issues-engine.ts`, `issues-taxonomy.ts`, `issues-text.ts`, `issues-dims.ts`, `issues-store.ts`, `issues.ts`, `src/config/domain.ts`, `src/lib/types.ts` (`ResultRow`, `Issue*`) |
| 근거 (문서) | [`docs/data-contract.md`](./data-contract.md) §8, [`docs/integration-spec.md`](./integration-spec.md) §4 · §14 · §15, [`docs/issue-report-frame.md`](./issue-report-frame.md) |
| 용어 | 한국어 본문, 기술 용어·필드명·enum·테이블명은 영어 원문. 모듈 ID(M1–M9)와 참조 테이블 ID(R1–R6)는 콘솔 `/issues/modules` 페이지와 모듈 배지에 그대로 쓰인다 |

> 이 문서의 수식·임계값은 **현재 mock 구현(코드)에서 그대로 옮긴 값**이다. 문서와 코드가 다르면 코드가 기준이며, 이 문서를 고친다.
> "NOW" = 현재 mock(`src/server/services/issues*.ts`)이 요청마다 계산하는 규칙 기반 방식. "TARGET" = 운영 시스템이 구현할 방식.

## 목차

0. 요약 — 3계층, 판별 기준, 3개 버킷, 페이지 분리
1. 버킷 A — 결과 CSV 컬럼 (Phase 1 필수)
2. 버킷 B — 참조 테이블 R1–R6
3. 버킷 C — 분석 모듈 M1–M9
4. 기능 × 모듈 의존성 매트릭스
5. 단계별 로드맵
6. 인터페이스 — 모듈 출력 · 배치 계약 · mock 매핑 · 전환 경로

---

## 0. 요약

### 0.1 3계층: 무엇이 이미 있고 무엇이 없는가

파이프라인은 이미 발화 1건마다 **판정과 그 이유**를 낸다. `result`(PASS/FAIL), LLM Judge의 설명 `judge_reason`, FAIL이면 6개 분류 코드 중 하나인
`failure_reason`(`INTENT_MISMATCH`, `SLOT_ERROR`, `RESPONSE_QUALITY`, `TIMEOUT`, `ASR_ERROR`, `POLICY_VIOLATION`), 그리고 `judge_score`·`latency_ms`다.
부족한 것은 단건 분석이 아니라 **여러 발화와 여러 날을 가로지르는 분석**이다.

| 계층 | 질문 | 상태 | 화면 | 구현 수단 |
| --- | --- | --- | --- | --- |
| **L1. 단건 분석** | "이 발화는 왜 FAIL인가?" | **이미 있음**: PASS/FAIL + `judge_reason` + `failure_reason` (+ `judge_score`, `latency_ms`) | `/results` 행 상세 | 평가 파이프라인 (Judge, Aggregate) |
| **L2. 집계 통계** | "어느 division·버전·기능에서 FAIL이 얼마나, 지난 기간보다 늘었나?" | 컬럼만 추가하면 가능 | **품질 대시보드** `/quality/*` (Q-01) | SQL `GROUP BY` / window 집계 + 정적 lookup 테이블 (모듈 없음) |
| **L3. 교차·시계열 분석** | "이 FAIL 300건은 몇 개의 결함인가? 어제부터 생긴 문제인가? 새 버전 탓인가? 무엇부터 고쳐야 하나? 시장에 얼마나 영향이 있나?" | **없음** (mock이 규칙으로 시뮬레이션) | **심층 분석** `/issues/*` (I-01) | 분석 모듈 M1–M9 |

행 단위 `failure_reason`은 "이 발화가 어떤 방식으로 틀렸나"이다. "이 FAIL들이 같은 결함인가", "얼마나 심각한가", "새로운 일인가"는
행 하나로는 답할 수 없다. 예를 들어 `SLOT_ERROR` 같은 코드가 붙어 있어도 실제 의미는 크게 다르다.

| 같은 `failure_reason = SLOT_ERROR` | 실제 의미 | 필요한 판단 |
| --- | --- | --- |
| `smartthings.door_unlock`에서 다른 문을 엶 | **safety** (잘못된 물리 동작) | intent 속성 (R3/R6), 이슈 단위 분류 (M4) |
| `alarm.create`에서 알람이 9시간 어긋남 (Galaxy Watch, One UI 8 Watch) | **wrong_action** + 특정 기기 집중 + 회귀 | 군집화 (M1), 기기 집중·회귀 탐지 (M2), 분류 (M4) |
| `weather.forecast`에서 도시 slot이 틀림 | **quality** (조회 결과가 틀렸을 뿐) | 분류 (M4) |

### 0.2 판별 기준 (discriminating test)

> 어떤 기능이 **결과 CSV 행에 대한 `GROUP BY` / window 집계 + 정적 lookup 테이블**만으로 만들어지면 **모듈이 필요 없다** (L2, 품질 대시보드).
> 다음 중 하나라도 필요하면 **모듈이 필요하다** (L3, 심층 분석).

| 모듈이 필요한 신호 | 예 | 모듈 |
| --- | --- | --- |
| 날짜를 넘어 유지되는 정체성 (stable issue ID) | Triage 상태가 오늘도 내일도 같은 이슈에 붙어야 함 | M1 |
| Baseline 대비 유의성·이상 탐지·회귀 판정 | z-score spike, 버전 간 two-proportion test | M2 |
| 가중 점수 | Criticality 0–100, P0–P3 | M3 |
| `judge_reason`의 의미 분류 (이슈 단위) | category, user_impact, dev_miss | M4 |
| 지원 범위(capability) 지식 | must_handle / out_of_scope | M5 |
| Baseline 대비 신규성 | 신규 발화 패턴, 신규 용어, code-switching | M6 |
| 서술(narrative) 생성 | 인사이트 문장, 리포트 요약 | M7 |
| 저장되는 lifecycle 상태 | NEW → TRIAGED → TICKETED → RESOLVED | M8 |
| 실제 트래픽 가중 | "영향 사용자 N명" | M9 |

경계 사례: **"직전 같은 길이 구간 대비 Δ"는 단순 window 집계이므로 L2에 허용**한다(품질 대시보드). 유의성 판단(z, p-value), Baseline 충분성 판정,
버전 공존 구간(co-existence window) 보정은 M2다. `failure_reason`은 행 컬럼이므로 품질 대시보드에서 분포·`failure_reason` × 임의 차원·코드별 추세까지
**전부** 쓴다. `judge_reason` 원문은 행 단위로만(`/results` drill-down) 보여 주고, 그 의미를 묶는 일은 M1/M4가 한다.

### 0.3 세 개의 버킷

| 버킷 | 무엇 | 누가 | 형태 | 필요한 Phase |
| --- | --- | --- | --- | --- |
| **A. 파이프라인 출력** | 결과 CSV 컬럼 (§1) | ML Pipeline (Preprocess / Aggregate / Persist) | `results.csv` → BigQuery `utterance_results` | Phase 1 |
| **B. 참조 데이터** | R1–R6 lookup 테이블 (§2) | Product · Data · Capsule · Policy 팀 | BigQuery `ref.*` 테이블 (코드가 아님) | Phase 1 (R1–R3), Phase 2 (R4–R6) |
| **C. 분석 모듈** | M1–M9 계산 (§3) | Data/ML + Operations API | 배치 job → BigQuery/Firestore 출력 테이블 | Phase 2 |

### 0.4 페이지 분리

| 메뉴 | 번호 | Route | 데이터 | 버킷 | Phase |
| --- | --- | --- | --- | --- | --- |
| **품질 대시보드 / Quality** | Q-01 | `/quality` (개요) · `/quality/breakdown` · `/quality/matrix` · `/quality/versions` · `/quality/distributions` | 행 집계 + lookup만. **issues 엔진·서비스를 import하지 않는 별도 quality service** | A + B | **Phase 1** |
| **심층 분석 / Deep Analysis** (기존 이슈 리포트, route 유지) | I-01 | `/issues` (Triage) · `/issues/categories` · `/issues/analysis` · `/issues/report` · `/issues/[id]` · `/issues/modules` (신규, 모듈 레지스트리) | 모듈 출력 | A + B + **C** | **Phase 2** |

품질 대시보드에서 **허용하지 않는 것**: z-score, 이슈 수, severity / 영향도, taxonomy(category · user_impact · dev_miss · must_handle), novelty, narrative.
`/quality/versions`는 단순 Δ 표와 차트만 보여 주며 **유의성 검정을 하지 않는다 (그것은 M2)**. 화면에 그렇게 적는다.
심층 분석의 모든 view와 주요 section은 의존 모듈 배지(예: `M1 M3 M8`)를 달고, tooltip에 모듈 이름과 상태를 보여 준다(§4).

---

## 1. 버킷 A — 결과 CSV 컬럼

기준: 실제 파이프라인 `results.csv`의 현재 컬럼은 integration-spec §4.1의 1–23번이다. 콘솔 mock `ResultRow`(`src/lib/types.ts`)는 §14.1의
24–32번까지 이미 갖고 있다. 아래 "현재 파이프라인"은 **실제 파이프라인 출력 기준**이다.

표기: ✅ 이미 있음 · ➕ 추가 필요 · ➕J = 추가하되 참조 테이블 조인으로 Preprocess가 파생 가능 · ◇ 권장(선택)

### 1.1 Phase 1(품질 대시보드)에 필요한 컬럼

| # | 컬럼 | BigQuery 타입 | 예 | 현재 파이프라인 | 품질 대시보드 용도 | 비고 |
| ---: | --- | --- | --- | :---: | --- | --- |
| 1 | `utterance_id` | STRING NOT NULL | `utt-20261112-ko-0033-0007` | ✅ | drill-down 키 | §4.2 |
| 2 | `workflow_id` | STRING NOT NULL | `wf-20261112-ko-0033` | ✅ | drill-down | |
| 3 | `batch_id` | STRING | `batch-20261112-ko-0033` | ✅ | 필터 | |
| 4 | `pipeline_job_id` | STRING NOT NULL | `wf-20261112-ko-0033-cycle-0-attempt-2` | ✅ | 중복 제거 키(`MERGE ON utterance_id, pipeline_job_id`) | |
| 5 | `language` | STRING | `ko` | ✅ | 차원 | |
| 7 | `capsule_id` | STRING | `device_control` | ✅ | 차원 `capsule` | `capsule`(6번, 한국어 label)은 표시용. 집계 키로 쓰지 않는다(부록 E #31) |
| 8 | `intent_expected` | STRING | `alarm.create` | ✅ | 차원 `intent`, top failing intents | |
| 9 | `intent_predicted` | STRING | `calendar.create` | ✅ | drill-down | |
| 10–13 | `utterance_text`, `asr_text`, `expected_response`, `actual_response` | STRING (policy tag `aipo.pii.utterance`) | | ✅ | 행 단위 표시만 | 집계하지 않음 |
| 14 | `judge_score` | NUMERIC(3,2) | `0.87` | ✅ | 평균 judge score, histogram | |
| 15 | `judge_reason` | STRING (PII tag) | `"오전 7시" → "오후 4시"로 인식…` | ✅ | **행 단위 표시만** | 의미 집계는 M1/M4 |
| 16 | `result` | STRING NOT NULL | `FAIL` | ✅ | pass rate, FAIL 수 | |
| 17 | `failure_reason` | STRING (6 enum, PASS면 `""`) | `SLOT_ERROR` | ✅ | 분포, `failure_reason` × 임의 차원, 코드별 추세 | 품질 대시보드가 **전부** 사용 |
| 18 | `latency_ms` | INT64 | `1432` | ✅ | p50 / p95, histogram | 8000 초과 = TIMEOUT |
| 19 | `device_type` | STRING | `Galaxy Z Fold7` | ✅ (값 정규화 필요) | 차원 `device` | 입력 `device_info`의 모델 코드(예 `SM-F966N`)를 카탈로그 모델명으로 정규화해야 R1 조인이 된다. 원본 코드는 ◇ `device_model_code`로 보존 |
| 20 | `model_version` | STRING | `bixby-nlu-2026.10` | ✅ | 차원, `/quality/versions` | |
| 21 | `pipeline_id` | STRING | `bixby-eval-full` | ✅ | 차원 `pipeline` | |
| 22 | `pipeline_version` | STRING | `v1.1` | ✅ | `/quality/versions` | |
| 23 | `eval_timestamp` → `eval_ts` | TIMESTAMP NOT NULL | `2026-11-12T14:21:07.120+09:00` | ✅ | 시간 범위, 추세, partition | |
| 24 | `agent_function` | STRING (12 enum) | `alarm_timer` | ➕J (R3) | 차원, by-function 집계 | |
| 25 | `agent_function_predicted` | STRING | `calendar` | ➕J (R3) | Phase 2 (오라우팅 분석) | Phase 1에서는 쓰지 않음 |
| 26 | `market` | STRING (`KR, US, GB, JP, ES, MX`) | `MX` | ➕ | 차원 | 언어와 별개(es → ES/MX). 입력 `locale`/계정 국가 |
| 27 | `os_version` | STRING | `Wear OS 6` | ➕ | 차원(선택) | |
| 28 | `one_ui_version` | STRING | `One UI 8 Watch` | ➕ | 차원 | |
| 29 | `utterance_pattern` | STRING | `up-ko-1x2y3z` | ➕ (가능하면) | **Phase 1 불필요** | M1(`group_by=pattern`)·M6 입력. 없으면 M6을 시작할 수 없다 |
| 30 | `division` | STRING (`Mobile, Wearable, Audio, TV, Appliance`) | `Wearable` | ➕J (R1) | by-division 막대, 차원 | |
| 31 | `region` | STRING (`KR, NA, EU, JP, LATAM`) | `LATAM` | ➕J (R2) | by-region 막대, 차원 | |
| 32 | `bixby_version` | STRING (semver, pre-release 허용) | `4.0.3`, `4.1.0-beta` | ➕ **필수** | 차원, `/quality/versions` | 단말의 Bixby client 버전. 비면 `unknown` |

### 1.2 Phase 2 이후에 필요한 추가 컬럼 (권장)

| 컬럼 | 타입 | 필요 모듈 | 이유 |
| --- | --- | --- | --- |
| ◇ `agent_version` | STRING | M2 | Agent 빌드(`modelUnderTest`, 예 `bixby-agent-3.6.0-rc2`) 회귀 축 (§4.6, 부록 E #15) |
| ◇ `judge_model` | STRING | M2 | `pipeline_version` 변경은 Judge 모델 변경을 포함한다(v1.1 `gemini-2.5-flash` → v1.2-rc `gemini-2.5-pro`). **Judge가 바뀐 비교는 "모델 회귀"와 구분**해야 한다 |
| ◇ `judge_tags` | ARRAY&lt;STRING&gt; (JSON) | M4, M6 | Judge 프롬프트가 원인 태그(`code_switch`, `timezone`, `feature_name`, `privacy`, `missing_slot`, `verbose`, `evasive`)를 구조화해 내면 현재의 `judge_reason` 키워드 정규식(§3 M4)이 필요 없어진다 |
| ◇ `slot_expected`, `slot_predicted` | JSON | M1, M6 | slot 단위 차이(`want → got`)를 정규식(`SLOT_PAIR`) 없이 얻음. 템플릿 생성의 근거 |
| ◇ `asr_confidence` | FLOAT64 | M4 | ASR 원인 판정 보조 |
| ◇ `sample_stratum`, `inclusion_prob` | STRING, FLOAT64 | **M9** | 평가 표본이 어떤 층(stratum)에서 어떤 확률로 뽑혔는지. sampling-bias 보정(Horvitz–Thompson / post-stratification)에 필수 |
| ◇ `source_utterance_id`, `line_no`, `attempt`, `replay_cycle` | | M1, M8 | 재평가·replay 시 같은 원천 발화 식별 |
| ◇ `session_id`, `turn_index` | | (M10 예정) | multi-turn 분석 |
| ◇ `user_hash` (회전 salt) | | (M11 예정) | 사용자 단위 중복 제거. 개인정보 검토 필수 |

### 1.3 BigQuery 테이블

- 테이블: `bixby-eval-prod.bixby_eval.utterance_results` (`domain.ts` `bigquery.resultsTable`).
- `PARTITION BY DATE(eval_ts)`, `require_partition_filter = TRUE`.
- `CLUSTER BY agent_function, language, division, failure_reason` (BigQuery는 최대 4개).
  - integration-spec §4.5는 `CLUSTER BY language, pipeline_version, model_version, capsule_id`, §14.1은 `agent_function, language, failure_reason`이다.
    **§14.1 + `division`을 채택한다.** 품질 대시보드와 심층 분석의 거의 모든 쿼리가 function / division / failure_reason으로 자르기 때문이다.
    버전 비교(`/quality/versions`)는 partition pruning + 소수의 버전 값이라 clustering 없이도 충분하다(integration-spec 부록 E #34).
- 품질 대시보드용 사전 집계(권장): `bixby_eval.quality_daily_agg(date, language, market, region, device_type, division, agent_function, capsule_id, intent_expected, bixby_version, one_ui_version, model_version, pipeline_id, pipeline_version, failure_reason, rows, fails, judge_score_sum, latency_hist ARRAY<INT64>)` — 행 집계만이므로 모듈이 아니다. p50/p95는 `latency_hist`(고정 bucket) 또는 `APPROX_QUANTILES` 원본 쿼리로 만든다.
  심층 분석이 쓰는 `issue_daily_agg`(§14.2)와 차원이 거의 같지만 `intent_predicted`, `utterance_pattern`이 없고 judge / latency 통계가 있다.

---

## 2. 버킷 B — 참조 테이블 R1–R6

원칙: 참조 데이터는 **코드가 아니라 소유 팀이 관리하는 테이블**이다. 현재는 `domain.ts`(표)와 서비스 코드(정규식·상수) 두 곳에 흩어져 있다.
운영에서는 BigQuery 데이터셋 `bixby-eval-prod.ref`에 두고, 모든 테이블에 `valid_from`, `valid_to`(SCD Type 2), `version`, `updated_by`를 둔다.
모듈 출력은 어떤 참조 버전으로 계산했는지 `ref_versions`(JSON)로 남긴다.

| ID | 테이블 | 현재 위치 | 형태 | 소유 | 갱신 주기 | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | `ref.dim_device` (device → division) | `domain.ts` `deviceDivision`, `defaultDivision`, `deviceModels`, `devices` | **표** | Device catalog / 상품기획 | 신규 기기 출시 전 (월 1–2회) | 1 |
| R2 | `ref.dim_market` (market → region) | `domain.ts` `marketRegion`, `regions` | **표** | Global ops / Data | 신규 market 추가 시 (연 수회) | 1 |
| R3 | `ref.dim_intent` (capsule / intent → agent_function + intent 속성) | `issues-engine.ts` `fnOfIntent()`, `ACTION_FNS`, `QUERY_INTENT`, `SAFETY_INTENT`; mock `engine.ts` `agentFunctionOf()`; `domain.ts` `capsules` | **코드 → 표로 이관 필요** | Capsule / NLU 팀 | Capsule 배포마다 | 1 (function), 2 (속성) |
| R4 | `ref.capability_registry` (지원 범위) | `domain.ts` `capabilities` | **표** (region 차원 없음) | Capsule PM / 상품기획 | 기능 출시·지원 범위 변경 시 | 2 (M5) |
| R5 | `ref.feature_launch_calendar` | **없음.** 대용품: `issues-text.ts` `PRODUCT_TERMS`, `SERVICE_TERMS`(`issues-taxonomy.ts`), `galaxy_ai.*` prefix; 출시 시각은 `bixbyVersions`, `models[].releasedAt`, `releases[].releasedAt`뿐 | **신설** | Product marketing / PM | 주 1회 + 출시 이벤트 | 2 (M5, M6) |
| R6 | `ref.severity_rules` (failure_reason → severity class seed 규칙) | `issues-engine.ts` `severityClassOf()` | **코드 → 표로 이관 필요** | Quality lead + Trust & Safety | 분기 1회 + 사고 발생 시 | 2 (M3, M4) |

### R1 `ref.dim_device`

```sql
device_type STRING NOT NULL,      -- 카탈로그 모델명 (결과 컬럼 device_type)
model_codes ARRAY<STRING>,        -- SM-S936N, SM-F966N … (입력 device_info 정규화용)
base_device STRING,               -- Galaxy S26 (mock: deviceModels의 상위 기기)
division STRING NOT NULL,         -- Mobile | Wearable | Audio | TV | Appliance
launched_at DATE, valid_from TIMESTAMP, valid_to TIMESTAMP, version STRING
```

현재 값(`deviceDivision`): Galaxy S26 · Galaxy Z Fold7 · Galaxy Tab S11 → Mobile, Galaxy Watch → Wearable, Galaxy Buds → Audio, TV · Neo QLED → TV,
Family Hub · Bespoke AI Washer · Bespoke AI Oven → Appliance. 매핑에 없는 기기는 `defaultDivision = "Mobile"`이며 운영에서는 **경고 로그 + `unknown` 집계**를 권장한다(조용히 Mobile에 섞이지 않게).

### R2 `ref.dim_market`

`market STRING, region STRING, default_language STRING, valid_from, valid_to, version`. 현재 값: KR→KR, US→NA, GB·ES→EU, JP→JP, MX→LATAM.

### R3 `ref.dim_intent`

```sql
intent_id STRING NOT NULL,        -- alarm.create
capsule_id STRING,                -- alarm_timer
agent_function STRING NOT NULL,   -- 12 enum
is_action BOOL,                   -- 현재: ACTION_FNS에 속하고 QUERY_INTENT 접미사가 아님
is_query BOOL,                    -- 현재: QUERY_INTENT 정규식 (.status|.query|.forecast|.eta|.factoid|.chitchat|… )
safety_critical BOOL,             -- 현재: SAFETY_INTENT 정규식 ^smartthings\.(door_unlock|door|lock|unlock|gas|oven|garage|window)
launched_at DATE, valid_from, valid_to, version
```

현재 `fnOfIntent()` 규칙: `smartthings.scene_run|routine*` → `smartthings_routine`, 그 외 prefix 맵 `camera→camera`, `galaxy_ai→galaxy_ai_feature`,
`smartthings→device_control`, `alarm|timer→alarm_timer`, `call|message→call_message`, `music→media_play`, `settings→settings`, `calendar|reminder→calendar`,
`navigation→navigation`, `weather→weather`, `qa→general_qa`. 정규식은 신규 intent가 생길 때 조용히 틀리므로 **intent별 행으로 명시**하고, 표에 없는 intent는 `unknown`으로 집계한다.

### R4 `ref.capability_registry`

```sql
intent_prefix STRING NOT NULL,    -- galaxy_ai.gemini_handoff | galaxy_ai. | camera. …  (가장 긴 prefix 우선)
divisions ARRAY<STRING>, devices ARRAY<STRING>,   -- 지원 division 또는 개별 기기 예외
regions ARRAY<STRING>,            -- 신규 (현재 표에 없음). NULL = 전 지역
min_bixby STRING, max_bixby STRING,
status STRING,                    -- GA | BETA | DEPRECATED
note STRING, valid_from, valid_to, version
```

현재 값(`domain.ts` `capabilities`, 가장 긴 prefix 일치 우선, 일치 없음 = 전 기기 지원):

| intent prefix | divisions | 예외 devices | min Bixby | note |
| --- | --- | --- | --- | --- |
| `galaxy_ai.gemini_handoff` | Mobile | | 4.1.0-beta | Gemini 연동은 4.1 베타부터 |
| `galaxy_ai.` | Mobile | | 4.0.1 | Galaxy AI 기능은 모바일 전용 |
| `camera.` | Mobile | | | 카메라는 모바일 전용 |
| `navigation.` | Mobile, Wearable | | | |
| `call.`, `message.` | Mobile, Wearable, Audio | | | |
| `music.` | Mobile, Wearable, Audio, TV | Family Hub | | 가전 중 Family Hub만 미디어 재생 지원 |

mock도 운영 표와 같은 **longest-prefix** 규칙이다(`capabilityOf()`, 표 순서와 무관 — `galaxy_ai.gemini_handoff`는 표 어디에 있든 `galaxy_ai.`보다 우선). 이전에는 "배열의 첫 일치"였다(integration-spec 부록 E, 해결됨).

### R5 `ref.feature_launch_calendar`

```sql
feature_id STRING NOT NULL,       -- now_brief
names STRUCT<ko ARRAY<STRING>, en ARRAY<STRING>, ja ARRAY<STRING>, es ARRAY<STRING>>,  -- 별칭 포함: "now brief", "나우 브리프"
term_type STRING,                 -- feature | third_party_service (Spotify처럼 "신기능"이 아닌 이름)
intent_prefix STRING,             -- galaxy_ai.now_brief
launch_date DATE, regions ARRAY<STRING>, divisions ARRAY<STRING>, min_bixby STRING,
status STRING,                    -- ANNOUNCED | BETA | GA
valid_from, valid_to, version
```

현재 대용품: `PRODUCT_TERMS = ["now brief", "now nudge", "audio eraser", "creative studio", "gemini", "나우 브리프", "나우 넛지", "오디오 지우개", "크리에이티브 스튜디오", "제미나이", "spotify"]`,
`SERVICE_TERMS = {"spotify"}`(신기능에서 제외), `galaxy_ai.*` prefix. 출시일·지역 정보가 없으므로 "출시 전 지역에서의 신기능 FAIL"을 구분할 수 없다(M5 한계).

### R6 `ref.severity_rules`

```sql
rule_id STRING, priority INT64,           -- 낮을수록 먼저 (first match wins)
failure_reason STRING,                    -- NULL = any
intent_safety_critical BOOL, agent_functions ARRAY<STRING>,
expected_is_action BOOL, predicted_is_action BOOL, predicted_differs BOOL,
severity_class STRING,                    -- safety | policy | wrong_action | quality
version STRING, valid_from, valid_to
```

현재 `severityClassOf(fn, expected, predicted, reason)`를 행으로 옮기면:

| priority | 조건 | severity_class |
| ---: | --- | --- |
| 1 | `POLICY_VIOLATION` ∧ (safety-critical intent ∨ fn ∈ {`device_control`, `smartthings_routine`}) | safety |
| 2 | `POLICY_VIOLATION` | policy |
| 3 | safety-critical intent ∧ reason ∈ {`INTENT_MISMATCH`, `SLOT_ERROR`} | safety |
| 4 | `SLOT_ERROR` ∧ expected is action | wrong_action |
| 5 | reason ∈ {`INTENT_MISMATCH`, `ASR_ERROR`} ∧ predicted ≠ expected ∧ predicted is action | wrong_action |
| 6 | 그 외 | quality |

"action" = R3 `is_action` (현재 `ACTION_FNS = {device_control, smartthings_routine, alarm_timer, call_message, settings, camera, calendar, galaxy_ai_feature}` ∧ ¬`QUERY_INTENT`).
이 표는 **seed**다. M4 TARGET에서 LLM 분류기가 이슈 단위로 상향(escalate)할 수 있지만, R6이 safety로 판정한 것을 자동으로 낮추지는 못한다(§3 M4).

### 보조 참조 (이미 존재)

`domain.ts` `models[]`(`releasedAt`, status), `releases[]` = `pipelineVersionDetails`(`releasedAt`, `judgeModel`, `modelUnderTest`), `bixbyVersions[]`(status) — M2의 버전 순서·공존 구간 계산에 쓴다.
운영에서는 `ref.release_registry(axis, version, released_at, status, judge_model, agent_version)`로 둔다. `bixbyRollout`은 mock 데이터 생성 전용이며 참조 테이블이 아니다.

---

## 3. 버킷 C — 분석 모듈 M1–M9

### 3.0 레지스트리

| ID | 이름 | 티어 | 상태 | 실행 주기 | 노력 | 선행 모듈 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | issue-clustering · 이슈 클러스터링 & ID 관리 | MVP | Mock 시뮬레이션 | 배치 후 증분 + 일 1회 재군집 | L | — |
| M2 | baseline-anomaly · Baseline·이상/회귀 탐지 | MVP | Mock 시뮬레이션 | 배치 후 증분(집계) + 일 1회(검정) | M | M1 |
| M3 | criticality-scoring · Criticality 스코어링 | MVP | Mock 시뮬레이션 | 요청 시(범위 의존) + 프리셋 snapshot | S–M | M1, M2, (M4, M6, M9) |
| M4 | taxonomy-classifier · 이슈 분류기 | Enhancer (Triage lens가 의존) | Mock 시뮬레이션 | 이슈 생성·구성 변경 시 + 일 1회 | M–L | M1, (M2, M5) |
| M5 | capability-registry · Capability 판정 (must-handle) | Enhancer | Mock 시뮬레이션 | 배치 후 (행 단위) | S (+ 데이터 운영) | R4, R5 |
| M6 | pattern-novelty · 발화 패턴·신규성 탐지 | Enhancer | Mock 시뮬레이션 | 일 1회 | M | (M1) |
| M7 | insight-narrative · 인사이트·리포트 생성 | Enhancer | Mock 시뮬레이션 | 일 1회 + 요청 시 | M | M1–M6, (M9) |
| M8 | issue-store · 이슈 저장소 & Triage 워크플로 | MVP | Mock 시뮬레이션 | 실시간 (사용자 작업) | M | M1 |
| M9 | traffic-weighting · 트래픽 가중·시장 영향 추정 | Enhancer (가장 중요한 공백) | 미구현 / not implemented | 일 1회 | L | M1, (M2) + 운영 트래픽 데이터 |

노력: S ≤ 2 인·주, M 3–6 인·주, L ≥ 7 인·주 (데이터 접근 승인·개인정보 검토 기간 제외).
향후(언급만): **M10** session / multi-turn 분석(`session_id`, `turn_index` 필요), **M11** 사용자 단위 중복 제거(해시된 user / device id 필요).

공통 품질 기준: 모든 모듈 출력은 `module_version`, `ref_versions`, `run_id`를 가진다. 모든 TARGET 방법은 **현재 규칙과의 shadow 비교 기간**(최소 2주)을 거친 뒤 전환한다(§6.5).

---

### M1 issue-clustering · 이슈 클러스터링 & ID 관리

**목적.** 범위 안의 FAIL 행을 "같은 결함"끼리 묶어 이슈를 만들고, 그 이슈에 날짜·범위·필터와 무관하게 유지되는 ID를 준다. 다른 모든 L3 기능의 단위다.

**의존 UI.** 이슈가 등장하는 모든 곳: Triage 카드·swimlane·kanban·quick-look, 분해 보기의 이슈 수·top issues, Analysis의 issue ledger·bubble·treemap·heatmap `issue_count`,
Report dossiers, 상세 페이지 전체(발화 목록 = 멤버십), FilterBar의 이슈 수 facet, `export.csv`, SSE `new_critical`.

**입력.** 버킷 A: `result`, `failure_reason`, `agent_function`, `intent_expected`, `intent_predicted`, `utterance_pattern`(pattern 모드), `judge_reason`(TARGET), `eval_ts`; R3.

**출력.**

| 테이블 | 키 | 주요 컬럼 |
| --- | --- | --- |
| `issue_analysis.issue_registry` (BigQuery, Firestore 미러 선택) | `issue_id` | `signature_id`, `group_key`, `group_by`, `status` (`active \| merged \| split \| dormant`), `merged_into`, `split_from`, `centroid` (ARRAY&lt;FLOAT64&gt;, TARGET), `first_seen`, `last_seen`, `created_run_id`, `module_version` |
| `issue_analysis.issue_membership` | `(utterance_id, pipeline_job_id)` | `issue_id`, `distance`, `assigned_run_id`, `module_version`; `PARTITION BY DATE(eval_ts)`, `CLUSTER BY issue_id` |
| `issue_analysis.issue_alias` | `old_id` | `new_id`, `reason` (`merge \| split \| signature_change`), `at` — API는 옛 ID 요청에 새 ID 이슈를 돌려주고 본문에 `alias_of`를 표시(권장) |

**NOW (mock 규칙).** `issues-engine.ts compute()`

- 그룹 키 `groupKey(r, g)` = `{group_by}|{agent_function}|{intent_expected}|{intent_predicted}|{failure_reason}`, `group_by=pattern`이면 `|{utterance_pattern}`을 더한다.
  기본 `signature` 모드는 언어별 패턴을 하나의 이슈로 묶고 `Issue.patterns[]`(상위 8개)에 나열한다.
- 최소 지지도: FAIL 3건(`MIN_SUPPORT`), severity class가 safety / policy면 2건(`MIN_SUPPORT_SEVERE`).
- ID: `issueIdOf(key)` = `"iss-" + hash36(key)`, `hash36` = FNV-1a 32-bit → base36, 7자리 0 padding. 범위·호출과 무관하게 같다.
- 부가 출력: `dominant`(행 차원마다 FAIL이 가장 많은 값 — 그룹 소속 결정), `spark`(≤ 48 h hour bucket, 그 외 KST day bucket), 대표 `sample`(가장 최근 FAIL 행),
  `divisions` / `regions` / `bixby_versions`(FAIL 순), `results_query`(drill-down 필터).
- 한계: (1) `judge_reason`을 보지 않아 **같은 signature 안의 서로 다른 원인**(예: `alarm.create` SLOT_ERROR 안에 timezone 버그와 단순 slot 누락)이 한 이슈로 섞인다.
  (2) 반대로 같은 원인이 `intent_predicted`가 다르면 여러 이슈로 쪼개진다. (3) merge / split이 없다. (4) signature가 바뀌면 ID가 바뀌어 Triage 상태를 잃는다.
  (5) 32-bit 해시는 충돌 가능성이 0이 아니다(이슈 수만 개에서 낮지만 존재) — `group_key`를 함께 저장해 검증한다(§14.3).

**TARGET.** failure code + intent 쌍 + `judge_reason` 의미 유사도.

1. **Blocking**: `failure_reason` × `intent_expected`(+ `agent_function`)로 후보 블록을 나눈다. 블록 간에는 묶지 않는다(행 단위 분류 코드를 존중).
2. **의미 군집**: 블록 안에서 FAIL 행의 텍스트 표현 = `judge_reason` + slot 차이(`slot_expected/predicted`, 없으면 `SLOT_PAIR` 추출) + `intent_predicted` + 패턴 템플릿을
   다국어 embedding(예: Vertex `text-multilingual-embedding-002` 계열)으로 벡터화하고, HDBSCAN(min_cluster_size = 3, safety / policy 블록은 2) 또는 cosine 임계 agglomerative로 군집한다.
   `intent_predicted`가 다르지만 judge 사유가 같은 행은 같은 이슈가 될 수 있다(오라우팅 대상만 다른 같은 결함).
3. **Stable ID (centroid matching)**: 각 이슈의 centroid를 `issue_registry`에 저장한다. 새 실행의 군집을 기존 centroid와 Hungarian matching(비용 = 1 − cosine)으로 대응시키고,
   cosine ≥ τ_match(초기값 0.85, 평가 세트로 보정) ∧ 같은 블록이면 기존 ID를 잇는다. 대응이 없으면 새 ID를 발급한다.
4. **Merge**: 두 활성 이슈의 centroid cosine ≥ τ_merge(0.92)가 연속 2회 실행에서 유지되면 작은 쪽을 `merged_into`로 표시하고 `issue_alias`를 쓴다. Triage 상태는 M8 규칙으로 합친다.
   **Split**: 이슈 내부가 2개 이상 군집으로 안정적으로 갈라지면(silhouette ≥ 0.25, 각 ≥ 최소 지지도, 연속 2회) 가장 큰 자식이 부모 ID를 잇고 나머지는 새 ID(`split_from`).
5. **증분 할당**: 배치가 끝날 때마다 새 FAIL 행을 최근접 centroid에 할당(거리 ≤ τ_match)하고, 할당되지 않은 행은 일 1회 재군집에서 처리한다.
6. **호환**: 첫 적재 때 현재 signature마다 이슈 하나를 만들고 **ID = 현재 `iss-` 해시**로 둔다. 따라서 기존 Triage 상태(§14.3)가 그대로 이어진다. `signature_id`는 이슈 속성으로 유지하고
   API `group_by=signature`는 signature 단위 집계 view로 계속 제공한다.

**주기.** 배치 완료 후 증분 할당(≤ 5분), KST 02:00 일 1회 재군집·merge / split. **의존.** 버킷 A, R3. M2–M9 전부의 선행.

**품질 지표 / 수용 기준.**

- 사람이 라벨한 FAIL 쌍 ≥ 1,000쌍(블록 층화)에서 pairwise precision ≥ 0.85, recall ≥ 0.80; V-measure ≥ 0.75.
- ID 안정성: 원인이 바뀌지 않은 이슈의 일간 ID 유지율 ≥ 95%; 하루 merge + split ≤ 활성 이슈의 3%.
- 운영자 "분리 필요 / 병합 필요" 피드백 비율 < 5%.
- signature 모드 parity: TARGET 전환 전, mock과 같은 행에서 signature ID·멤버십 100% 일치(§6.5 golden test).

**노력** L. **티어** MVP.

---

### M2 baseline-anomaly · Baseline·이상/회귀 탐지

**목적.** "평소와 다른가?"에 답한다. Baseline 창 정의, 이슈 단위 spike(추세) 탐지, 신규 이슈 판정(`Issue.novelty`), `model_version` / `pipeline_version` / `bixby_version` 회귀 판정.

**의존 UI.** Baseline 배지(frame), FilterBar facet의 Δ vs baseline, Triage mover ribbon(`top_movers`), Analysis bubble(volume × trend z), 상세 Trend(spike · Bixby / release 회귀),
Report의 Bixby version regression · model / pipeline regression section, 인사이트 `spike` · `regression` · `bixby_version` · `market` · `division` · `region` · `hotspot` · `improvement`(baseline Δ),
dev lens `regression` 타입(M4 경유), M3의 trend · regression · novelty factor.

**입력.** 버킷 A 행(또는 `issue_daily_agg`), M1 멤버십, 보조 참조 `release_registry`.

**출력.**

| 테이블 | 키 | 주요 컬럼 |
| --- | --- | --- |
| `issue_daily_agg` (§14.2) | `(date, 차원…)` | `rows`, `fails` — 범위·필터 의존 계산의 원천 |
| `issue_analysis.issue_trend_daily` | `(as_of, window_key, issue_id)` | `compare_count`, `expected`, `z`, `p_value`, `q_value`, `baseline_count`, `baseline_scope`, `novelty` (`new \| recurring`), `method` |
| `issue_analysis.version_regression` | `(as_of, scope_type, scope_key, axis, current, previous)` | `scope_type` (`issue \| division_function`), `current_total`, `current_fails`, `previous_total`, `previous_fails`, rates, `z`, `p_value`, `q_value`, `posterior_prob`, `decision` (`regression \| not_significant \| insufficient_sample \| no_increase`), `judge_changed` BOOL |

**NOW (mock 규칙).** `baselineFor()`, `compute()`, `bixbyCells()`

- **Baseline 창**: `len = to − from`, `want = max(len, 7 d)`. preceding = `[from − want, from)`를 `dataWindow.earliest`로 자른다. coverage = 덮인 길이 / want.
  coverage ≥ 0.5 → `mode: preceding`, sufficient. 아니고 len ≥ 14 d → `mode: intra_range`(compare = 범위의 마지막 7 d, baseline = 그 앞). 그 외 preceding, `sufficient = coverage ≥ 0.25`.
- **Release 필터 완화**: release 컬럼(`model_version, pipeline, pipeline_version, os_version, one_ui_version, bixby_version`) 필터 값의 baseline 행 < 50이면 baseline에서 그 필터를 뺀다(`baseline.relaxed_columns`).
- **추세 (Poisson z)**: scope = 같은 `intent_expected`의 행.
  `expected = max(0.5, baseScope > 0 ? (baseCount + 1) / (baseScope + 1) × cmpScope : 0.5)`, `z = (cmpCount − expected) / √expected` (+1 smoothing: baseline FAIL 0건이 자동 spike가 되지 않게).
  baseline 불충분이면 z = 0.
- **신규 이슈 (`Issue.novelty`)**: `isNew = sufficient ∧ baseCount = 0 ∧ (baseScope = 0 ∨ cmpScope / (baseScope + 1) < 1.5)`. 그 외 `recurring`.
- **모델 / 파이프라인 회귀** (axis = `model_version`, `pipeline_version`): 최신 버전 출시 시각 이후 행만(co-existence window). 버전마다 scope ≥ 6행, 직전 대비
  `diff = rate_new − rate_prev > 0.01`, 최신 FAIL ≥ 3, pooled two-proportion `z = diff / √(p̄(1−p̄)(1/n_new + 1/n_prev)) ≥ 1.64`(one-sided 95%).
  불합격 시 가장 가까운 후보와 이유(`insufficient_sample · not_significant · no_increase`)를 `detail.why`로 남긴다.
- **Bixby 버전 회귀 (`Issue.bixby_regression`, 점수 미반영)**: 이슈의 dominant division에서 최신 vs 직전 Bixby 버전, division별 최신 버전 **첫 관측 시각** 이후 행만(OTA는 division별로 진행),
  scope ≥ 10행씩, 최신 FAIL ≥ 4, diff > 2 pp, z ≥ 2.33. 여러 division × 버전을 검정하므로 1.64보다 엄격하다.
- **인사이트용 Bixby 셀 (`bixbyCells`)**: division × agent_function 셀, ≥ 15행씩, 최신 FAIL ≥ 5, z ≥ 2.33, diff ≥ 3 pp, 가장 큰 Δ.
- **차원 Δ**: `IssueDimStat.delta = fail_rate − baseline_fail_rate` (pp) — baseline 정의가 M2이므로 심층 분석 쪽 Δ는 M2 소관이다. (품질 대시보드의 "직전 같은 길이 구간 Δ"는 모듈 없음.)
- 한계: (1) 다중 검정 보정이 없다(이슈 수백 × 축 2–3개 → 우연한 양성). (2) Poisson은 과산포(overdispersion)를 무시한다. (3) 요일·시간대 계절성 없음.
  (4) 구간 간 구성 변화(mix shift: 기기·시장 비율 변화, Simpson's paradox)를 통제하지 않는다. (5) **Judge 모델 변경이 섞인 `pipeline_version` 비교**를 모델 회귀로 오인할 수 있다.

**TARGET.**

- **Baseline**: 현재 창 규칙을 유지하되 `issue_daily_agg`에서 계산(매 요청 스캔 금지, §14.2). 요일 효과를 위해 baseline을 7일 배수로 맞춘다.
- **추세**: quasi-Poisson / negative binomial GLM, `log(fails) ~ offset(log(scope_rows)) + weekday`로 expected와 분산을 추정하고 Pearson z를 쓴다.
  지속적 상승은 CUSUM 또는 EWMA control chart로 별도 탐지(하루 spike와 서서히 오르는 문제를 구분).
- **회귀 검정**: (a) 기본은 two-proportion z, 셀 기대값 < 5면 Fisher exact. (b) mix shift 보정 — language × division(또는 market) 층별 **Cochran–Mantel–Haenszel** 검정.
  (c) **Benjamini–Hochberg FDR** q ≤ 0.10을 실행 단위(축별)로 적용. (d) Bayesian 대안: Beta-Binomial, 사전분포는 intent 단위 baseline에서 경험적 Bayes로 추정,
  `P(p_new > p_prev + δ | data) ≥ 0.95`(δ = 1 pp)이면 회귀. 표본이 작은 canary 비교에 적합.
  (e) canary가 계속 쌓이는 동안에는 always-valid p-value(mSPRT)로 순차 검정해 "들여다볼 때마다 검정" 문제를 피한다.
- **축**: `model_version`, `pipeline_version`, `agent_version`, `bixby_version`(division별, 첫 관측 기준). `judge_model`이 다른 두 버전 비교는 `judge_changed = true`로 표시하고(NOW: UI가 `domain.ts releases[].judgeModel`로 caveat를 표시 — `/quality/versions`, Report Bixby · regression section, 상세 Trend 회귀 비교; `src/lib/judge.ts`),
  가능하면 같은 발화를 두 Judge로 재채점한 calibration 셋으로 Judge 효과를 분리한다.

**주기.** 배치 후 `issue_daily_agg` 증분 갱신(≤ 5분, §14.2 신선도), KST 02:00 일 1회 검정 + 프리셋 범위 snapshot. 사용자 지정 범위·필터는 API가 집계 테이블에서 요청 시 계산.
**의존.** M1(이슈 단위 scope), 버킷 A, release registry.

**품질 지표 / 수용 기준.**

- A/A 검정(같은 버전을 무작위로 둘로 나눔): 축별 주간 false positive ≤ 5%.
- 과거 데이터에 합성 회귀(+5 pp, n ≥ 200/버전)를 주입한 backtest에서 검출력 ≥ 80%, 주입 후 탐지까지 ≤ 1일.
- 알려진 사고(예: mock 시나리오 `tv_bixby_403_media` — TV 4.0.3 media_play ≈ +35 pp) 재현 100%.

**노력** M. **티어** MVP.

---

### M3 criticality-scoring · Criticality 스코어링

**목적.** 이슈를 "먼저 볼 순서"로 정렬한다. 6개 factor 가중합 0–100, 영향도 P0–P3, 사람이 읽을 수 있는 근거(`reasons[]`).

**의존 UI.** Triage 정렬·swimlane(영향도 = severity 그룹), 카드 gauge, lens KPI band, factor ribbon, Analysis metric tiles · issue ledger · bubble 크기, Report dossiers · 통계 부록(factor 분해),
상세 Hero gauge · Anatomy waterfall, FilterBar severity(영향도) · `min_score`, `export.csv` factor 기여도, SSE `new_critical`(P0/P1).

**입력.** M1 이슈, M2(trend z, regression, novelty 상태), M4(severity class — NOW는 R6 규칙), M6(novel-pattern share), (M9 TARGET).

**출력.** `issue_analysis.issue_snapshot(run_id, as_of, window_key, filter_hash, issue_id, score, severity, factors JSON, reasons JSON, scoring_version)` — 프리셋 범위(today, 24h, 7d, 30d) × 필터 없음.
그 외 범위·필터는 API가 요청 시 같은 함수로 계산한다(점수는 범위 의존).

**NOW (mock 규칙).** `FACTOR_WEIGHTS = { volume: 20, severity: 25, trend: 15, regression: 15, reach: 10, novelty: 15 }` (합 100), `score = Σ weight_f × value_f`, value ∈ [0, 1].

| factor | weight | value |
| --- | ---: | --- |
| volume | 20 | `ln(1 + n) / ln(1 + max(40, 최대 cluster 크기))` |
| severity | 25 | `CLASS_VALUE`: safety 1.0 · policy 0.7 · wrong_action 0.45 · quality 0.2 |
| trend | 15 | `clip(z / 5, 0, 1)` (M2 Poisson z; baseline 불충분이면 0) |
| regression | 15 | 축별 `clip(max(diff / max(rate_prev, 0.02) / 1.5, diff / 0.25), 0, 1) × clip(z / 3, 0.6, 1)`의 최대 (2.5배 또는 +25 pp에서 포화, 겨우 유의하면 60%, z ≥ 3이면 100%) |
| reach | 10 | `0.4·markets/6 + 0.3·divisions/5 + 0.3·languages/4` |
| novelty | 15 | 신규 이슈(M2 `isNew`)면 `0.35 + 0.65 × novel-pattern share`, 아니면 `0.7 × share` (share = compare 창 FAIL 중 M6 신규 패턴 비율); baseline 불충분이면 0 |

- 영향도: P0 ≥ 60 · P1 ≥ 45 · P2 ≥ 30 · P3. Floor: safety이고 FAIL ≥ 3이면 score ≥ 45 → P0, 아니면 P1. policy이고 FAIL ≥ 5이면 최소 P1.
- `reasons[]`: 후보마다 가중치(예: safety 100, policy 90, wrong_action `severity×25`, bixby 회귀 9, 회귀 `vReg×15+5`, spike `vTrend×15`, 신규 이슈 `vTrend×15+2`, 신규 패턴 `vNovelty×15+1`,
  집중 `6 + share×4`, reach `vReach×10`, volume `vVolume×20×0.6`)로 정렬해 상위 6개. 집중(concentration)은 FAIL ≥ 5에서 `one_ui_version → division → device → market → bixby_version` 순으로
  한 값이 FAIL의 ≥ 80%이고 전체 트래픽의 < 50%인 첫 차원.
- 정렬: score desc → count desc → id.
- 한계: (1) volume이 **범위 안 최대 cluster로 정규화**되어 범위·필터가 바뀌면 같은 이슈의 점수가 바뀐다(범위 간 비교 불가). (2) 가중치가 사람 판단으로 보정되지 않았다.
  (3) reach는 "평가 세트에 몇 개 시장이 나왔나"이지 사용자 수가 아니다(M9 공백). (4) ~~인사이트의 score→severity 매핑(80/60/40)과 이슈 매핑(60/45/30)이 다르다~~ — 해결: 둘 다 `src/lib/severity.ts` `SEVERITY_THRESHOLDS`(60/45/30)를 쓴다(M7 참고).

**TARGET.**

- 선형·설명 가능한 형태는 유지한다(Anatomy waterfall이 그대로 동작해야 함). 가중치는 `ref.scoring_config(version, weights, thresholds, floors)`에 두고 버전을 출력에 남긴다.
- **가중치 보정**: 과거 Triage 결과(TICKETED / RESOLVED = 실제 결함, IGNORED = 비결함, 사람이 매긴 우선순위)를 라벨로 non-negative 제약 ordinal logistic regression 또는 pairwise learning-to-rank로
  가중치를 추정하고 합 100으로 재척도한다. 분기 1회 재보정.
- **절대 volume**: 범위 최대값 대신 고정 기준(최근 90일 이슈 일평균 FAIL의 p99)으로 정규화해 범위 간 점수를 비교 가능하게 한다.
- **reach → impact**: M9가 준비되면 reach factor를 `affected_users` 추정치(로그 척도, CI 하한 사용)로 바꾼다. 그 전까지 reach는 "eval-set reach"로 라벨한다.
- severity factor는 M4의 이슈 단위 severity class를 쓴다(R6 seed + LLM 상향).

**주기.** 일 1회 snapshot + 요청 시. **의존.** M1, M2 필수; M4, M6, M9 선택(없으면 해당 factor는 NOW 규칙 또는 0).

**품질 지표 / 수용 기준.** 사람 우선순위 gold set(≥ 200 이슈)과 Spearman ρ ≥ 0.6; P0 precision ≥ 0.8, 사람-P0 recall ≥ 0.9(safety는 1.0); 구성이 변하지 않은 이슈의 일간 점수 변동 < 5점.

**노력** S–M. **티어** MVP.

---

### M4 taxonomy-classifier · 이슈 분류기

**목적.** 행 단위 분류 코드(`failure_reason`)와 Judge 사유를 입력으로, **이슈 단위** 분류를 만든다: `category`(10종), `user_impact_type`(7종, 사용자 영향 lens),
`dev_miss_type`(10종, Bixby 미처리 lens), `severity_class`(4종). 각 결과에 사람이 읽을 근거(`*_reason: IssueText`)를 단다.

**왜 행 단위 코드로 부족한가.** `failure_reason`은 "어떻게 틀렸나"의 6개 코드다. Triage는 "사용자에게 무슨 일이 생겼나"와 "개발 쪽 무엇이 빠졌나"를 묻는다.

- 같은 `SLOT_ERROR`가 safety(`door_unlock`의 대상 문 오류), wrong_action(알람 시각 오류), quality(조회 slot 오류)가 된다 → intent 속성 + 이슈 맥락 필요.
- 같은 `INTENT_MISMATCH`가 routing(다른 agent function으로 감), 신기능 미지원(new_feature_gap), 지원 범위 밖(out_of_scope)이 된다 → R4/R5, M5 필요.
- 원인은 `judge_reason` 텍스트에만 있다(code-switching, 시간대, 기능명, 개인정보, 슬롯 누락, 장황, 회피). 이를 **이슈의 FAIL 행들 전체에 걸쳐 비율로 집계**해야 한다.
- `dev_miss = regression`은 버전 비교(M2) 결과에서만 나온다.

**의존 UI.** Triage lens(카드 타입 배지, 기본 subgroup = `user_impact` / `dev_miss`), FilterBar category · user_impact · dev_miss · risk(`severity_class`), 분해 보기(`dim=category` 기본, user_impact, dev_miss),
Analysis heatmap 이슈 단위 축 · treemap 계층, Report user impact · Bixby must-handle misses · 교차표 · type tag, 상세 Hero taxonomy tile · Similar(`same_category`), `export.csv`.
M4 없이 Triage는 `failure_reason`으로만 묶을 수 있고 두 lens 모두 성립하지 않는다(그래서 Enhancer지만 Triage lens의 전제).

**입력.** 이슈의 FAIL 행(`failure_reason`, intent 쌍, `agent_function(_predicted)`, `judge_reason`, 패턴 템플릿에서 slot placeholder를 뺀 문자열, `division`, `bixby_version`),
R3, R6, M2(regression ≥ 0.15, bixby_regression), M5(must_handle).

**출력.** `issue_analysis.issue_taxonomy(issue_id, as_of, category, category_reason, user_impact_type, user_impact_reason, dev_miss_type, dev_miss_reason, severity_class, must_handle, must_handle_reason, confidence, source (rule | llm | human), classifier_version, rubric_version, sample_hash)`;
이슈에 속하지 않은 FAIL 행·baseline 행용 `issue_analysis.row_tags(utterance_id, pipeline_job_id, category, user_impact, dev_miss, must_handle, severity_class, classifier_version)` — 차원 Δ의 baseline이 같은 규칙으로 계산되어야 하므로 필요(data-contract §8.11).

**NOW (mock 규칙).** `issues-taxonomy.ts classify()` — 결정적 규칙, first match wins. 비율 조건은 "이슈 FAIL 행의 ≥ 50%"(`half`).

- 신호(`shares`): feature = expected `galaxy_ai.*` ∨ 템플릿에 `PRODUCT_TERMS`(서비스명 제외) ∨ judge `/기능명|feature name/`; code-switch = `isCodeSwitch(템플릿)` ∨ judge `/code[- ]?switch/`;
  tz = judge `/시간대|time ?zone|timezone|UTC/`; privacy = `/개인정보|privacy|personal data/`; missing = `/누락|되묻|missing|re-?ask/`; verbose = `/장황|verbose/`; evasive = `/회피|evad/`;
  support = M5 `supportOf()`(ok · device · version).
- **category**: safety(class) > policy(class) > new_feature(feature ≥ 50%) > locale(cs + tz ≥ 50%; cs ≥ tz면 code-switch 사유, 아니면 timezone) > timeout(`TIMEOUT`) > asr(`ASR_ERROR`)
  > wrong_action(class wrong_action ∧ predicted ≠ expected) > slot(`SLOT_ERROR`) > misroute(`INTENT_MISMATCH`) > response_quality.
- **user_impact_type**: safety_privacy(class safety; 또는 POLICY_VIOLATION ∧ (privacy ≥ 50% ∨ fn ∈ {call_message, calendar})) > inappropriate_content(class policy) > degraded(TIMEOUT)
  > degraded(SLOT_ERROR ∧ missing ≥ 50%) > wrong_action(class wrong_action ∨ (SLOT_ERROR ∧ task intent)) > minor(RESPONSE_QUALITY ∧ verbose ≥ 50%) > task_blocked(RESPONSE_QUALITY ∧ evasive ≥ 50%)
  > task_blocked(task intent ∧ reason ≠ RESPONSE_QUALITY) > misunderstood. task intent = ¬`QUERY_INTENT` ∧ fn ∉ {general_qa, weather}.
- **dev_miss_type**: out_of_scope(must_handle = false) > guardrail_miss(POLICY_VIOLATION) > regression(M2 regression value ≥ 0.15) > regression(bixby_regression) > new_feature_gap(category new_feature)
  > locale_gap(category locale) > performance(TIMEOUT) > asr_robustness(ASR_ERROR) > slot_extraction(SLOT_ERROR) > routing(INTENT_MISMATCH ∧ fn_predicted ≠ fn) > supported_intent_failed.
- **severity_class**: R6 표(`severityClassOf`).
- 같은 함수가 행 하나(`rows: [r]`)도 분류해 `row_tags`를 만든다(`rowTagsOf`). 분류는 ID에 포함되지 않으므로 규칙이 바뀌어도 이슈 ID는 그대로다.
- 한계: Judge 문구가 키워드를 쓰지 않으면 규칙이 다음 단계로 떨어진다(조용한 오분류). 다국어 Judge 사유에 정규식이 취약하다.

**TARGET.**

- **LLM 분류기 (이슈 단위)**: 입력 = 이슈의 집계 통계(코드 분포, intent 쌍, division / 버전 분포, M2 · M5 결과) + 층화 표본 FAIL 10–20행(언어·기기별, `judge_reason`, 템플릿, actual response 요약).
  **Rubric**: 각 category / user_impact / dev_miss의 정의, 포함·제외 예, 결정 순서(현재 우선순위)를 프롬프트에 명시. **구조화 출력**(JSON schema: enum + `rationale` + 근거 `utterance_id` 2–5개 + `confidence`).
- **가드레일**: R6 / 규칙이 safety · policy로 판정하면 LLM은 낮출 수 없다(상향만 허용, 하향은 사람 검토 큐). `out_of_scope`는 M5 결정만 따른다. `regression`은 M2 결정만 따른다.
  LLM 출력이 enum 밖이거나 근거 ID가 이슈에 없으면 규칙 결과로 fallback.
- **행 태그**: 행마다 LLM을 부르지 않는다. 규칙(키워드 → `judge_tags` 컬럼으로 대체) 또는 LLM 라벨로 distill한 소형 분류기.
- **비용 · 캐시**: 키 = `(issue_id, rubric_version, sample_hash)`. 멤버십이 20% 이상 바뀌거나 rubric이 바뀌면 재분류.
- **평가 세트**: 사람이 라벨한 이슈 ≥ 300개(category별 층화, 2인 라벨, Cohen κ ≥ 0.7 확인). rubric 변경마다 회귀 평가.

**주기.** 이슈 생성 · 구성 변경 시(증분) + 일 1회. **의존.** M1 필수, M2 · M5 선택(없으면 regression / out_of_scope 단계 생략).

**품질 지표 / 수용 기준.** category macro-F1 ≥ 0.80, user_impact · dev_miss macro-F1 ≥ 0.75, safety recall ≥ 0.98, 규칙 대비 사람 선호율 ≥ 60%(shadow 비교), 이슈당 분류 비용·지연 예산 내.

**노력** M–L. **티어** Enhancer (Triage lens의 전제).

---

### M5 capability-registry · Capability 판정 (must-handle)

**목적.** "Bixby가 이 기기 · 버전 · 지역에서 이 요청을 처리해야 했나?"를 판정한다. `must_handle = false`(out_of_scope)인 이슈는 개발 결함이 아니라 지원 범위 밖 요청이다.

**의존 UI.** Triage dev lens(진입 시 `must_handle=true` 기본, out_of_scope 토글), FilterBar Must-handle segment, Report Bixby must-handle misses, 상세 taxonomy tile(`must_handle_reason`),
M4 `dev_miss = out_of_scope`.

**입력.** 버킷 A(`intent_expected`, `division`, `device_type`, `bixby_version`, `region`, `eval_ts`, `failure_reason`), R4, R5.

**출력.** 행 단위 `capability_status`(`supported | unsupported_device | unsupported_version | not_launched_region | unknown_intent`)를 `issue_membership`(또는 `row_tags`)에 기록, 이슈 단위
`must_handle`, `must_handle_reason`, 상태별 비율을 `issue_taxonomy`에 기록.

**NOW (mock 규칙).** `issues-taxonomy.ts capabilityOf()`, `supportOf()`, `classify()`

- `capabilityOf(intent)`: `CAPABILITIES`에서 `intent.startsWith(c.intent)`인 항목 중 **prefix가 가장 긴 것**(표 순서 무관). 없으면 전 기기 지원.
- `supportOf(row)`: division이 목록에 없고 device도 예외 목록에 없으면 `device`; `minBixby`가 있고 `compareVersion(bixby_version, minBixby) < 0`이면 `version`; 그 외 `ok`.
  `compareVersion`은 semver, pre-release < 정식(`4.1.0-beta < 4.1.0`).
- 이슈: `POLICY_VIOLATION` → 항상 true(guardrail); ok ≥ 50% → true(`supported` / `supportedEverywhere`); 아니면 noDevice ≥ noVersion → false(`unsupportedDevice`), 그 외 false(`unsupportedVersion`).
- 한계: region 차원 없음, 출시일 없음(R5 부재) → 출시 전 시장의 신기능 요청이 must_handle로 잡힌다. 표에 없는 intent는 "전 기기 지원"으로 간주되어 누락이 드러나지 않는다.

**TARGET.** R4(longest-prefix) + R5 규칙 엔진:
`supported(row) ⇔ ∃ entry: prefix 일치 ∧ (division ∈ divisions ∨ device ∈ devices) ∧ (regions IS NULL ∨ region ∈ regions) ∧ min_bixby ≤ bixby_version ≤ max_bixby ∧ (R5 launch_date ≤ eval_ts in region) ∧ status ∈ {GA, BETA}`.
`unknown_intent`(R3에 없음)는 별도 값으로 집계하고 registry 담당에게 알린다. 정책·safety guardrail은 항상 in scope.
데이터셋 측 요구: out_of_scope 요청의 **정답은 "지원하지 않음"을 안내하는 응답**이어야 한다. 그렇게 응답하면 PASS여야 하므로, 이 판정 결과를 평가셋 `expected_response` 관리 담당에게 피드백한다.

**주기.** 배치 후(행 단위, 결정적·저비용). **의존.** R4, R5(없으면 NOW 규칙). M4가 소비.

**품질 지표 / 수용 기준.** 관측 intent 중 R4 / R3 coverage ≥ 95%(`unknown_intent` < 5%), 감사 표본 100건에서 사람 판정과 일치 ≥ 95%, R5 갱신 후 다음 배치에 반영.

**노력** S (엔진) + 지속적인 데이터 운영. **티어** Enhancer.

---

### M6 pattern-novelty · 발화 패턴·신규성 탐지

**목적.** Baseline 창에 없던 **표현 방식**을 찾는다: 신규 발화 패턴(템플릿), 신규 용어, 신기능 이름, code-switching. 평가 실패의 원인이 "모델이 못 본 말투"인지 알려 준다.

**의존 UI.** Triage 신규 패턴 carousel, Analysis emerging patterns(stream · ladder · terms), Report emerging patterns, 상세 Patterns(신규 표시), 분해 보기 카드 `top_pattern`,
인사이트 `new_pattern`, M3 novelty factor(신규 패턴 share), M4 category new_feature / locale 신호.

**입력.** 버킷 A(`utterance_text`, `language`, `utterance_pattern`, `intent_expected`, `result`, `eval_ts`), `utterance_patterns(pattern_id, language, template, intent, agent_function, first_seen_ts)`(§14.1), R5.

**출력.** `utterance_patterns`(Preprocess upsert, §14.1), `utterance_term_daily(date, language, term, rows)`(§14.2),
`issue_analysis.pattern_novelty_daily(as_of, window_key, pattern_id, kind, count, baseline_count, fails, fail_rate, growth, novelty_score, nn_pattern_id, nn_cosine, terms ARRAY<STRING>, issue_ids ARRAY<STRING>)`,
`issue_analysis.novel_terms_daily(as_of, window_key, term, language, count, baseline_count, pattern_ids, matched_feature_id)`.

**NOW (mock 규칙).** `issues-engine.ts patternsOf()`, `issues-text.ts`

- 신규 패턴: compare 창에 행이 있고 baseline 창(PASS + FAIL 전체)에 0행, compare 행 ≥ 3. baseline 불충분이면 없음.
- 토큰: 소문자, 구두점 제거, ko / en / es는 공백 분리, ja는 문자 체계 run(카타카나 · 한자 · 히라가나 · 라틴), 1글자 · 숫자만 · stop word 제거. term = unigram + 인접 bigram + `PRODUCT_TERMS` 다어절.
- 신규 용어: baseline 0회, 패턴 term은 현재 ≥ 2회, `terms[]` 목록은 ≥ 3회(상위 40).
- kind (first match): `new_feature_name`(`PRODUCT_TERMS` 또는 `galaxy_ai.*`) > `code_switch`(ko / ja 문장 안의 라틴 단어 — `wi-fi, tv, pt, ai` 제외; es 문장 안의 `EN_IN_ES` 단어) > `new_term` > `new_phrasing`.
- `growth` = compare 창 후반 행 / 전반 행(전반 0이면 null). 정렬: `count × (0.3 + fail_rate/100)`. 같은 intent의 기존 표현(established) 상위 3개를 공유 토큰 수로 고른다.
- 이슈의 novel-pattern share = compare 창 FAIL 중 신규 패턴 행 비율(M3 novelty factor 입력).
- 한계: 패턴 ID 완전 일치 기준이라 **바꿔 말하기(paraphrase)도 "신규"**가 된다. 한국어 교착(조사 · 어미: "와이파이를", "와이파이는")을 공백 토큰이 처리하지 못한다. lexicon이 하드코딩이다.

**TARGET.**

1. **정규화 · 템플릿**: NLU slot 결과(`slot_expected`)로 slot 값을 placeholder로 치환. 형태소 분석(ko: Kiwi / MeCab-ko, ja: Sudachi / MeCab)으로 표제어화. 패턴 ID = 정규화 템플릿 해시(현재 `up-{lang}-{hash}` 유지).
2. **신규성 = n-gram + embedding**: (a) 어휘 신규성 — 표제어 n-gram(ko / ja는 문자 3-gram 병행)의 baseline 빈도 0 또는 log-likelihood ratio(G²) burst; (b) 의미 신규성 — 템플릿 embedding의 baseline 패턴 최근접 cosine < τ(0.80).
   "어휘는 새롭지만 의미는 기존과 같음" = `new_phrasing`(위험 낮음), "의미까지 새로움" = 신규 요구(위험 높음)로 나눈다.
3. **code-switching**: 토큰별 language ID(fastText lid 등) + 문자 체계 판정, slot 값 제외.
4. **신규 용어 → 신기능**: burst 용어를 R5 별칭과 매칭하면 `new_feature_name` + `matched_feature_id`. R5에 없는 burst 용어는 "미등록 신규 용어" 큐로 PM에게 보낸다.

**주기.** 일 1회(KST 02:00, `utterance_term_daily` 기반). **의존.** 버킷 A(`utterance_pattern`), R5; M1(issue_ids 연결)은 선택.

**품질 지표 / 수용 기준.** 사람 검토 200건에서 "신규 패턴" precision ≥ 0.8, paraphrase로 인한 거짓 신규 < 10%, R5 신기능 용어가 처음 등장한 날 + 1일 이내 탐지 ≥ 90%.

**노력** M. **티어** Enhancer.

---

### M7 insight-narrative · 인사이트·리포트 생성

**목적.** 다른 모듈의 결과를 "데이터 근거가 있는 문장"으로 바꾼다. 각 문장은 재현 가능한 evidence(필터 · `/results` drill-down · 수치 · 이슈 / 패턴 ID)를 가진다.

**의존 UI.** Triage insights ticker, Analysis signal readouts, Report 경영 요약 · masthead headline · evidence notes, `report.md` export, 상세 Markdown export 문구.

**입력.** M1–M6 출력(+ M9 TARGET), 행 집계(차원 Δ).

**출력.** `issue_analysis.insights(run_id, as_of, window_key, filter_hash, insight_id, kind, key, vars JSON, severity, score, evidence JSON, narrative STRING NULL, narrative_locale, grounding_passed BOOL, generator_version)`.
API `IssueInsight { id, kind, key, vars, severity, score, evidence }`는 그대로이며 narrative는 선택 필드로 추가한다(계약 변경 시 openapi 동시 수정).

**NOW (mock 규칙).** `issues.ts buildInsights()` — 템플릿(i18n key `issues.insights.*` + vars), score 내림차순.

| kind | 조건 (gate) | score |
| --- | --- | --- |
| `overall` | 항상 (baseline 있으면 Δ 포함) | 40 |
| `safety` | safety class 이슈 존재, 최상위 이슈 | 100 (P0 고정) |
| `critical` | safety가 아닌 P0 / P1 상위 3개 (`criticalSameIntent`: predicted = expected) | 이슈 score |
| `regression` | M2 regression이 있는 이슈 중 regression value 최대 | `55 + value × 30` |
| `spike` | recurring 이슈 중 z ≥ 3, z 최대 | `50 + min(30, 3z)` |
| `new_pattern` | M6 신규 패턴 존재(요약) + fail_rate ≥ 40% 상위 2개 | 요약 `45 + min(25, 4 × failing)` / 개별 `40 + min(30, 2 × count × fail_rate)` |
| `market` | market Δ ≥ 1.5 pp, ≥ 30행, 최대 Δ | `40 + min(30, 3Δ)` |
| `hotspot` | agent_function × language 셀 Δ ≥ 3 pp, ≥ 25행 | `40 + min(30, 2Δ)` |
| `concentration` | P0–P2 이슈 중 M3 집중 사유(≥ 80% share ∧ 전체의 < 50%) | `45 + score / 4` |
| `improvement` | 차원 값 Δ ≤ −1.5 pp, ≥ 60행, 최소 Δ | 30 (P3) |
| `division`, `region` | Δ ≥ 1.5 pp, ≥ 30행, 최대 Δ | `38 + min(30, 3Δ)` |
| `bixby_version` | M2 `bixbyCells` (≥ 15행씩, FAIL ≥ 5, z ≥ 2.33, Δ ≥ 3 pp) | `55 + min(30, Δ)` |
| `overall` (`baselineInsufficient`) | baseline 불충분 | 10 (P3) |

- 인사이트 severity는 이슈 영향도와 **같은 척도**다: `severityOfScore()`(`src/lib/severity.ts`, P0 ≥ 60 · P1 ≥ 45 · P2 ≥ 30). 위 표의 score 식은 예전 band 경계(40 / 60 / 80) 기준으로 작성되어 있어 `buildInsights()`가 **× 0.75**로 이슈 척도에 옮긴다(경계 40 / 60 / 80 → 30 / 45 / 60이 정확히 대응하므로 각 템플릿의 P 등급은 그대로). `critical`은 이슈 자신의 score · severity를 쓴다. 이전에는 80 / 60 / 40 별도 척도였다(integration-spec 부록 E, 해결됨).
- `report.md`(`issuesMarkdown`)는 KPI, 인사이트, 상위 이슈(사유 · 점수 분해), 신규 패턴, Triage 수를 요청 locale 템플릿으로 조립한다.

**TARGET.**

- **템플릿 계층 유지**: 위 gate 기반 "사실(fact)" 생성은 결정적으로 유지하고, 각 fact에 `fact_id`와 수치를 붙인다.
- **LLM narrative**: 입력 = fact JSON만(원문 발화 금지 또는 최소화). 출력 = 지정 locale의 요약 / 브리핑, 모든 문장에 `[fact_id]` 인용.
- **Grounding 검사 (hard gate)**: (1) 출력의 모든 수치를 추출해 인용된 fact 값과 반올림 허용 오차 안에서 일치, (2) 모든 문장이 ≥ 1개 fact 인용, (3) fact에 없는 intent · market · 버전 · 기능명 등장 금지,
  (4) 인과 표현("~때문에")은 M2 회귀 판정이 있는 fact에만 허용. 하나라도 실패하면 템플릿 문장으로 fallback하고 `grounding_passed = false` 기록.
- 주간 경영 리포트는 사람 검토 후 게시(초안 상태 표시).

**주기.** 일 1회 프리셋 snapshot + 요청 시(템플릿은 요청 시, LLM narrative는 snapshot만). **의존.** M1–M6, (M9).

**품질 지표 / 수용 기준.** 수치 grounding 실패 0건이 게시 조건(자동 gate); 사람 평가 유용성 ≥ 4/5; 인사이트 evidence 링크 재현율 100%(링크를 열면 같은 수치).

**노력** M. **티어** Enhancer.

---

### M8 issue-store · 이슈 저장소 & Triage 워크플로

**목적.** 이슈의 lifecycle 상태(status, owner, ticket, note, history)를 저장하고, 권한 · 감사 · 실시간 알림 · Jira 연동을 제공한다. 계산 결과가 아니라 **사람의 결정**을 보관한다.

**의존 UI.** Triage kanban · 카드 상태 · quick-look 작업, 상세 Triage panel + history, FilterBar status, Report Triage 수, SSE `issue`(PATCH마다 + `new_critical`), `export.csv` status 열.

**입력.** M1 `issue_id`(+ alias), 사용자 PATCH, M3 severity(신규 P0 / P1 알림).

**출력.** Firestore `issue_triage/{issue_id}` + `history/{auto}`(integration-spec §14.3), BigQuery `audit_log`(`ISSUE_UPDATE`), Pub/Sub → SSE `issue`. TARGET 추가: `issue_triage.ticket_links[]`, `issue_triage.aliases[]`.

**NOW (mock 규칙).** `issues-store.ts`

- 저장: `globalThis.__aipoIssueStore`(in-memory, 가상 날짜 re-seed에도 유지), 시드 Triage 4건.
- 전이 `TRANSITIONS`: NEW → TRIAGED | IGNORED · TRIAGED → TICKETED | RESOLVED | IGNORED | NEW · TICKETED → RESOLVED | IGNORED | TRIAGED · RESOLVED | IGNORED → NEW. 위반 409 `domain.issueTransition`.
  TICKETED는 `ticket_id` 필수(400 `domain.issueTicketRequired`), `TICKET_RE = /^[A-Za-z][A-Za-z0-9_]*-\d{1,7}$/`, owner는 알려진 operator만.
- PATCH: `issues:write` 필요, 바뀐 필드마다 history 항목, 감사 `ISSUE_UPDATE`(before / after / changed / reason), SSE `issue {kind: status | update}`, Idempotency-Key 지원.
- `announceCritical`: 기본 view(오늘, 필터 없음) 분석 후 처음 보는 P0 / P1을 `new_critical`로 한 번 발행. **첫 호출은 집합만 채우고(prime) 발행하지 않는다**(서버 재시작 시 폭주 방지).

**TARGET.**

- Firestore transaction으로 `updated_at` precondition(낙관적 잠금) — 동시 수정 시 409.
- **M1 merge / split 처리**: merge 시 남는 이슈의 상태 = 더 진행된 상태(우선순위 TICKETED > TRIAGED > NEW; RESOLVED / IGNORED는 남는 쪽이 열려 있으면 열린 쪽 유지), ticket은 합집합, history는 시간순 병합 + `field: merge` 항목.
  split 시 자식은 부모 상태를 복사하고 history에 `split_from` 기록.
- **Jira 연동**: (1) "티켓 만들기" — Operations API가 서비스 계정으로 Jira issue를 만들고(요약 = 이슈 제목, 본문 = M7 요약 + evidence 링크 + 상세 URL) `ticket_id`를 채워 TICKETED로 전이,
  (2) Jira webhook → Ops API: Jira 해결 시 콘솔은 RESOLVED **제안**(자동 전이는 설정), (3) 재발: RESOLVED 이후 같은 이슈의 FAIL이 M2 기준 유의하게 다시 나타나면 NEW로 reopen 제안 + 알림.
  Jira 호출은 outbox 패턴으로 재시도, `ticket_links`에 동기화 시각 기록.
- `new_critical`은 결과 Commit 후(또는 5분 주기) 배치가 발행하고, 중복 방지는 `first_detected_at`, `last_severity`(§14.3)로 한다.

**주기.** 실시간(사용자 작업), 알림은 배치 후. **의존.** M1(ID 안정성이 곧 상태 보존).

**품질 지표 / 수용 기준.** lost update 0건(동시성 테스트), 모든 변경 감사 100%, Jira 동기화 지연 ≤ 5분, merge / split 후 상태 유실 0건.

**노력** M. **티어** MVP.

---

### M9 traffic-weighting · 트래픽 가중·시장 영향 추정

**상태: 미구현 / not implemented.** mock에는 이 계산이 전혀 없다. 이 모듈이 없으면 **모든 순위는 평가 세트(eval-set) 순위이지 시장 영향 순위가 아니다.**
Triage · Report에서 "영향"이라는 말은 현재 "평가 세트 안에서의 FAIL 규모 × 심각도"를 뜻한다.

#### 9.1 왜 평가 세트 FAIL 수 ≠ 시장 영향인가

- 평가 세트의 구성은 **표본 설계**가 정한다. 언어별 batch 크기(`domain.ts` languages: en 200, ko 100, ja 50, es 50), capsule 가중치(weather 14, music 14, alarm 13 … settings 8),
  기기 가중치(Galaxy S26 50, Watch 15, Buds 12, TV 12, Family Hub 11)는 운영 트래픽 비율과 다르다. 희귀 intent · 신기능 · 스트레스 발화는 커버리지를 위해 **과대 표집**된다.
- 따라서 FAIL 30건짜리 이슈가 FAIL 5건짜리보다 시장 영향이 작을 수 있다. 예: 평가에서 5건뿐인 TV media 회귀가 실제로는 TV 사용자의 큰 비율이 매일 쓰는 기능일 수 있다.
- M3 reach(`markets/6`, `divisions/5`, `languages/4`)는 "몇 개 시장에서 관측되었나"이지 "몇 명이 겪나"가 아니다.
- 평가 FAIL은 Judge 판정이며 Judge에도 오류가 있다(false FAIL / 놓친 FAIL).

#### 9.2 필요한 운영 데이터

| 데이터 | 단위(셀) | 내용 | 원천 |
| --- | --- | --- | --- |
| `traffic_share_daily` | date × `intent` × `division`(또는 `device_type`) × `region`(market) × `bixby_version` × `language` | `requests`, `users_hll`(HLL++ sketch), `requests_per_user` | Bixby 운영 로그(서버 측 집계) |
| 표본 메타 | 평가 행 | `sample_stratum`, `inclusion_prob`(§1.2) | 평가셋 구성 파이프라인 |
| Intent 혼동 보정 | `intent_predicted` × `intent_expected` | 평가 세트의 혼동 행렬 | M1 / 버킷 A |
| Judge 정확도 | `failure_reason`별 | 사람 감사 표본의 Judge sensitivity / specificity | QA 감사 |

주의: 운영 로그는 **예측 intent**만 안다(정답 intent가 없음). 오라우팅이 많은 intent의 트래픽은 로그에서 다른 intent로 집계된다.
평가 세트의 `P(intent_expected | intent_predicted, 셀)`로 운영 트래픽을 "정답 intent 기준"으로 재배분한다: `T_true(e) = Σ_p T_log(p) · P(e | p)`.

#### 9.3 개인정보 제약

- 콘솔 · 분석 계층에는 **집계값만** 들어온다. 사용자 ID · 기기 ID · 원문은 운영 로그 도메인 밖으로 나오지 않는다.
- 고유 사용자 수는 로그 도메인에서 BigQuery `HLL_COUNT.INIT`로 sketch를 만들어 전달하고, 분석 계층은 `HLL_COUNT.MERGE`만 한다.
- k-익명성: 사용자 < k(초기 50)인 셀은 억제하거나 상위 셀(예: bixby_version 병합)로 합친다. 외부 공유 리포트는 Laplace 노이즈(differential privacy, ε 예산 관리)를 권장한다.
- 지역별 처리 · 보관(EU 데이터는 EU 리전), 목적 제한(품질 개선), 보존 기한(셀 집계 400일), 법무 · 개인정보 검토 승인이 착수 조건이다.
- M11(사용자 단위 중복 제거)은 회전 salt 해시가 필요하며 별도 승인 대상이다.

#### 9.4 추정식과 신뢰구간

이슈 i, 셀 c(intent × division × region × bixby_version × language)에 대해:

- 평가 FAIL 비율(이슈 i가 셀 c의 해당 intent 발화에서 차지하는 비율): `p̂_ic = f_ic / n_c` — `f_ic` = 셀 c의 이슈 i FAIL 수(M1 멤버십), `n_c` = 셀 c의 해당 intent 평가 행 수.
- **작은 표본 shrinkage** (Beta-Binomial 경험적 Bayes): 사전분포 `Beta(α, β)`를 같은 intent · division의 상위 셀에서 추정, `p̃_ic = (f_ic + α) / (n_c + α + β)`.
- **Judge 오류 보정** (Rogan–Gladen): `p*_ic = (p̃_ic − (1 − Sp)) / (Se − (1 − Sp))`, [0, 1]로 clip. Se / Sp는 `failure_reason`별 감사 값.
- **영향 요청 수 (post-stratification)**: `A_i = Σ_c T_c · p*_ic` (T_c = 셀 일평균 요청 수, §9.2의 정답 intent 기준).
  표본이 층화 추출이고 `inclusion_prob π_r`이 있으면 Horvitz–Thompson 형태 `A_i = Σ_{r ∈ FAIL_i} (1/π_r) · s` (s = 표본 → 일 트래픽 척도)로 같은 값을 행 단위로 계산할 수 있다. 셀 합계만 알면 raking으로 가중치를 맞춘다.
- **영향 사용자 수**: 셀 c 사용자 1명이 하루 평균 k_c번 요청할 때, `U_i = Σ_c U_c · (1 − (1 − p*_ic)^{k_c})`. 요청이 독립이 아니면 이 값은 상한이다(같은 사용자가 같은 발화를 반복).
- **시장 영향 비율**: `share_i = A_i / Σ_c T_c` (region · division별로도 제공).
- **신뢰구간**: 셀마다 `p_ic ~ Beta(f_ic + α, n_c − f_ic + β)`에서 Monte Carlo 10,000회 표본 → Rogan–Gladen 보정 → A_i, U_i 계산 → 2.5 / 97.5 백분위 = 95% CI.
  T_c 자체가 표집된 로그면 그 분산도 함께 표집한다. 해석적 근사: `Var(A_i) ≈ Σ_c T_c² · p̃_ic(1 − p̃_ic) / (n_c + α + β + 1)`.
- **커버리지 공백**: `T_c > 0`인데 `n_c = 0`인 셀(평가가 없는 트래픽)은 추정하지 않고 `uncovered_share = Σ_{c: n_c = 0} T_c / Σ_c T_c`로 따로 보고한다. 원하면 계층 모형(bixby_version을 division 안에서 partial pooling)으로 보간하되 "보간" 표시.

**출력.** `issue_analysis.traffic_share_daily`(§9.2), `issue_analysis.issue_impact_daily(as_of, issue_id, affected_requests, affected_requests_ci_low, affected_requests_ci_high, affected_users, affected_users_ci_low, affected_users_ci_high, traffic_share, uncovered_share, by_region JSON, by_division JSON, traffic_snapshot_date, method_version)`.

**의존 UI (도입 시).** Triage 카드 "추정 영향 사용자(95% CI)", Report market & device · division / region impact를 트래픽 가중으로, M3 reach factor → impact, 인사이트 문장의 영향 수치.

**주기.** 일 1회(운영 로그 일 집계 이후). **의존.** M1(멤버십), M2(선택, 회귀 이슈의 영향 추정), 운영 트래픽 데이터 + 개인정보 승인.

**품질 지표 / 수용 기준.** 시뮬레이션에서 95% CI 실제 포함률 93–97%; 과거 사고에서 VOC / CS 티켓 수와 Spearman ρ ≥ 0.5; 평가 커버리지(`1 − uncovered_share`) ≥ 90%; k-익명성 위반 0건.

**노력** L (데이터 접근 · 개인정보 검토 포함 시 리드타임이 가장 길다). **티어** Enhancer — 그러나 가장 중요한 공백.

---

## 4. 기능 × 모듈 의존성 매트릭스

● = 필수(없으면 기능이 성립하지 않음) · ○ = 선택(없으면 축소 · fallback 동작) · 빈 칸 / — = 모듈 없음(버킷 A + B만).
"배지" 열은 화면에 다는 모듈 배지(● 모듈만 표시, ○는 tooltip에 "선택"으로 표시).

### 4.1 심층 분석 / Deep Analysis (`/issues/*`, Phase 2)

| 화면 · 기능 | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | 배지 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| **Frame** Baseline 배지 | | ● | | | | | | | | M2 |
| Frame FilterBar 행 차원 facet (FAIL rate · Δ · 이슈 수) | ● | ● | | | | | | | | M1 M2 |
| Frame FilterBar 영향도(severity) · `min_score` | ● | | ● | | | | | | | M1 M3 |
| Frame FilterBar status | ● | | | | | | | ● | | M1 M8 |
| Frame FilterBar category · user_impact · dev_miss · risk | ● | | | ● | | | | | | M1 M4 |
| Frame FilterBar Must-handle | ● | | | ● | ● | | | | | M1 M4 M5 |
| Frame FilterBar novelty | ● | ● | | | | | | | | M1 M2 |
| Export `export.csv` | ● | ○ | ● | ● | ○ | | | ● | ○ | M1 M3 M4 M8 |
| Export `report.md` (다운로드 · 복사) | ● | ● | ● | ● | ○ | ● | ● | ● | ○ | M1 M2 M3 M4 M6 M7 M8 |
| **Triage** lens 전환 (사용자 영향 \| Bixby 미처리) | ● | | ● | ● | ○ | | | | | M1 M3 M4 |
| Triage lens KPI band | ● | ○ | ● | ● | ○ | | | ● | ○ | M1 M3 M4 M8 |
| Triage 영향도 · factor · mover ribbon | ● | ● | ● | | | | | | | M1 M2 M3 |
| Triage insights ticker | ● | ● | ● | | | ○ | ● | | | M1 M2 M3 M7 |
| Triage 신규 패턴 carousel | ○ | | | | | ● | | | | M6 |
| Triage 영향도 swimlane (group → subgroup → cards) | ● | | ● | ○ | ○ | | | | | M1 M3 |
| Triage subgroup = user_impact / dev_miss (lens 기본) | ● | | | ● | ○ | | | | | M1 M4 |
| Triage grouping (division · region · bixby_version · market · device · model_version · failure_reason · agent_function) | ● | | ○ | | | | | | | M1 |
| Triage grouping (category · status · novelty) | ● | ○ | | ○ | | | | ○ | | M1 (+ M4 / M8 / M2) |
| Triage 카드 (gauge · 타입 배지 · 상태 · spark) | ● | ○ | ● | ● | | | | ● | ○ | M1 M3 M4 M8 |
| Triage lifecycle kanban | ● | | ○ | | | | | ● | | M1 M8 |
| Triage quick-look sheet (`?issue=`) | ● | ● | ● | ● | ○ | ○ | | ● | ○ | M1 M2 M3 M4 M8 |
| Triage dev lens `must_handle=true` 기본 · out_of_scope 토글 | ● | | | ● | ● | | | | | M1 M4 M5 |
| **분해 보기** dim = category / user_impact / dev_miss | ● | ● | ○ | ● | ○ | | | | | M1 M2 M4 |
| 분해 보기 dim = agent_function / division / region / bixby_version (카드: by_severity · top_issues · top_pattern · Δ) | ● | ● | ● | | | ○ | | | | M1 M2 M3 |
| 분해 보기 ordered chart (bixby_version · severity) | ● | ● | ● | | | | | | | M1 M2 M3 |
| **Analysis** metric tiles | ● | ● | ● | | | | | | | M1 M2 M3 |
| Analysis signal readouts (자동 인사이트) | ● | ● | ● | | | ○ | ● | | | M1 M2 M3 M7 |
| Analysis heatmap — 행 차원 × 행 차원, metric fail_rate / fail_count | | | | | | | | | | — (= `/quality/matrix`) |
| Analysis heatmap — metric delta | | ● | | | | | | | | M2 |
| Analysis heatmap — metric issue_count, `top_issue_id` | ● | | ● | | | | | | | M1 M3 |
| Analysis heatmap — 이슈 단위 축 (category · user_impact · dev_miss) | ● | | | ● | | | | | | M1 M4 |
| Analysis bubble quadrant (volume × trend z, colour-by) | ● | ● | ● | ○ | | | | | ○ | M1 M2 M3 |
| Analysis treemap (3단 계층) | ● | | ● | ○ | | | | | ○ | M1 M3 |
| Analysis emerging patterns (stream · ladder · terms) | ○ | | | | | ● | | | | M6 |
| Analysis issue ledger + split detail pane | ● | ● | ● | ● | | | | ● | | M1 M2 M3 M4 M8 |
| **Report** masthead (headline · KPI ledger) | ● | ● | ● | | | | ● | | ○ | M1 M2 M3 M7 |
| Report 경영 요약 | ● | ● | ● | ● | | ● | ● | | ○ | M1 M2 M3 M4 M6 M7 |
| Report critical-issue dossiers | ● | ● | ● | ● | | | | ● | ○ | M1 M2 M3 M4 M8 |
| Report 사용자 영향 (lens 1) | ● | | ● | ● | | | | | ○ | M1 M3 M4 |
| Report Bixby must-handle misses (lens 2) | ● | | ● | ● | ● | | | | | M1 M3 M4 M5 |
| Report division impact · region impact | ● | ● | ● | | | | | | ○ | M1 M2 M3 |
| Report Bixby version regression | ● | ● | | | | | | | ○ | M1 M2 |
| Report model / pipeline regression | ● | ● | ● | | | | | | | M1 M2 M3 |
| Report emerging patterns | ○ | | | | | ● | | | | M6 |
| Report market & device | ● | ● | | | | | | | ○ | M1 M2 |
| Report 통계 부록 (factor 분해 · 교차표) | ● | ● | ● | ● | | | | | | M1 M2 M3 M4 |
| Report evidence notes · footnote | ● | ● | | | | | ● | | | M1 M2 M7 |
| **상세** Hero (영향도 · status · gauge · signature · taxonomy · reasons · KPI) | ● | ● | ● | ● | ○ | | | ● | ○ | M1 M2 M3 M4 M8 |
| 상세 Anatomy (6 factor waterfall + why flagged) | ● | ● | ● | | | ○ | | | | M1 M2 M3 |
| 상세 Trend (FAIL 수 · 비율 vs baseline, spike, Bixby / release 회귀) | ● | ● | | | | | | | | M1 M2 |
| 상세 Breakdowns (DETAIL_BREAKDOWN_DIMS + baseline) | ● | ● | | | | | | | | M1 M2 |
| 상세 Utterances (`results_query` drill-down) | ● | | | | | | | | | M1 |
| 상세 Patterns (신규 표시) | ● | | | | | ● | | | | M1 M6 |
| 상세 Similar · same_category | ● | | | ● | | | | | | M1 M4 |
| 상세 Workflows | ● | | | | | | | | | M1 |
| 상세 Triage panel + history | ● | | | | | | | ● | | M1 M8 |
| 상세 Markdown export | ● | ● | ● | ● | | ○ | ○ | ● | | M1 M2 M3 M4 M8 |
| SSE `issue` `new_critical` 알림 | ● | | ● | | | | | ● | | M1 M3 M8 |
| `/issues/modules` (레지스트리 · 매트릭스 · 상태) | | | | | | | | | | — (정적) |

### 4.2 품질 대시보드 / Quality (`/quality/*`, Phase 1) — 모듈 없음

| 화면 · 기능 | 데이터 | M1–M9 |
| --- | --- | :-: |
| `/quality` KPI (pass rate · FAIL 수 · 직전 같은 길이 구간 Δ · 평균 judge score · p50 / p95 latency) | `result`, `judge_score`, `latency_ms`, `eval_ts` | — |
| `/quality` pass-rate 추세 | `eval_ts` bucket | — |
| `/quality` division별 · region별 막대 | R1, R2 | — |
| `/quality` failure_reason 분포 | `failure_reason` | — |
| `/quality` top failing intents | `intent_expected` | — |
| `/quality/breakdown` 임의 행 차원 (agent_function · capsule · intent · language · market · region · device · division · bixby_version · one_ui_version · model_version · pipeline · failure_reason) — pass rate · FAIL 수 · Δ · share · 추세 | 버킷 A + R1–R3 | — |
| `/quality/matrix` 행 차원 × 행 차원 heatmap (pass_rate \| fail_count \| delta) | 버킷 A + R1–R3 | — |
| `/quality/versions` model_version / bixby_version / pipeline_version 단순 Δ 표 · division / region별 차트 (**유의성 검정 없음 — M2**) | 버킷 A | — |
| `/quality/distributions` judge_score histogram · latency histogram · failure_reason × 차원 | 버킷 A | — |
| drill-down → `/results` (같은 필터, 행 단위 `judge_reason` 표시) | 버킷 A | — |

---

## 5. 단계별 로드맵

| Phase | 범위 | 켜지는 화면 | 진입 조건 | 완료 조건 |
| --- | --- | --- | --- | --- |
| **Phase 1** 품질 대시보드 | 버킷 A + R1–R3, `quality_daily_agg`, quality service | `/quality/*` 5개 화면, `/results`의 division / region / bixby_version 필터 | 파이프라인이 §1.1 ➕ 컬럼(`agent_function`, `market`, `one_ui_version`, `division`, `region`, `bixby_version`)을 출력; R1–R3 테이블 적재 | 같은 날짜에서 BigQuery 직접 쿼리와 API 수치 차이 0(integration-spec §13.3 #3 방식); `unknown` division / bixby_version 비율 < 1%; 화면 p95 ≤ 300 ms |
| **Phase 2a** MVP 모듈 | M1, M2, M3, M8 (+ R6 seed) | `/issues` Triage(영향도 swimlane · 카드 · kanban · quick-look), 상세(Hero · Anatomy · Trend · Breakdowns · Utterances · Workflows · Triage), Analysis(tiles · bubble · treemap · ledger · heatmap delta / issue_count), Report(dossiers · regression · division / region · market & device · 부록), `export.csv`. lens · category 차원은 "M4 대기" 빈 상태 | Phase 1 완료; `utterance_results` ≥ 37일(30일 + baseline 7일) 적재; `issue_triage` Firestore 준비 | §6.5 golden test에서 mock과 이슈 ID · 멤버십 100%, score 차이 ≤ 0.1; M2 A/A false positive ≤ 5%; Triage 상태 PATCH · 감사 · SSE E2E 통과 |
| **Phase 2b** Enhancer | M4, M5 (R4 · R5), M6 (`utterance_pattern` 필수), M7 | Triage lens 2종 · 타입 배지 · dev lens · 신규 패턴 carousel · insights ticker, 분해 보기 전체, Analysis 이슈 단위 축 · emerging patterns · signal readouts, Report 경영 요약 · lens section · emerging patterns · evidence notes, `report.md` | Phase 2a 완료; R4 / R5 소유 팀 지정; M4 평가 세트 ≥ 300 이슈 라벨 완료 | M4 macro-F1 목표 달성(§3 M4), M5 coverage ≥ 95%, M6 precision ≥ 0.8, M7 grounding 실패 0 |
| **Phase 3** M9 | 트래픽 가중 · 시장 영향 | 카드 · Report의 "추정 영향 사용자 (95% CI)", M3 reach → impact, 인사이트 영향 수치 | 개인정보 · 법무 승인; `traffic_share_daily` 공급 합의; `sample_stratum` / `inclusion_prob` 컬럼 | CI 포함률 93–97%, 커버리지 ≥ 90%, VOC 상관 ρ ≥ 0.5, k-익명성 위반 0 |

Phase 2a 동안 Phase 2b 기능은 **현재 mock 규칙을 배치로 이식한 버전**(규칙 parity)으로 먼저 켜고, TARGET 방법은 shadow로 비교한 뒤 교체해도 된다(§6.5).
이 경우 화면 배지 tooltip의 상태는 "규칙 기반(rule)"으로 표시한다.

---

## 6. 인터페이스

### 6.1 원칙

1. **API 계약은 바뀌지 않는다.** Operations API는 `docs/openapi.yaml` `/issues*` 계약(`docs/data-contract.md` §8)을 그대로 구현한다. mock은 요청마다 계산하고, 운영은 모듈 출력 테이블을 읽는다.
   새 필드(예: M9 `Issue.impact`, M7 `IssueInsight.narrative`)는 선택 필드로만 추가하고 openapi · `types.ts`를 함께 바꾼다.
2. **범위 독립 계산과 범위 의존 계산을 나눈다.**
   - 범위 독립(배치가 저장): M1 멤버십 · registry, M4 taxonomy, M5 capability status, M6 패턴 registry · 용어 일 집계, M8 상태, M9 트래픽 일 집계.
   - 범위 의존(API가 요청 시 집계 테이블에서 계산, 프리셋은 snapshot): M2 baseline · z · 회귀, M3 score, M7 인사이트. 이 계산은 집계 테이블 위의 산술이라 p95 ≤ 300 ms(integration-spec §14.5)를 지킬 수 있다.
3. **읽는 쪽은 부분 결과를 보지 않는다.** 모든 배치는 `analysis_runs`에 기록하고 마지막 SUCCEEDED run만 노출한다.

### 6.2 출력 테이블 요약

데이터셋 `bixby-eval-prod.issue_analysis` (BigQuery, `asia-northeast3`), Triage는 Firestore.

| 테이블 | 쓰는 모듈 | Partition / Cluster | API가 쓰는 곳 |
| --- | --- | --- | --- |
| `issue_daily_agg` (§14.2) | M2 (집계) | `date` / `agent_function, intent_expected, failure_reason` | 모든 `/issues*` 범위 의존 계산 |
| `issue_registry` | M1 | — / `issue_id` | `Issue.id`, signature, alias |
| `issue_membership` | M1, M5 | `DATE(eval_ts)` / `issue_id` | 이슈 발화 목록, 차원 분해, `rowIssue` |
| `issue_alias` | M1 | — | 옛 ID 요청 → 새 ID |
| `issue_trend_daily`, `version_regression` | M2 | `as_of` / `issue_id` | factors trend · regression, `bixby_regression`, 인사이트 |
| `issue_snapshot` | M3 | `as_of` / `window_key, issue_id` | 프리셋 범위 `/issues`, `/issues/summary` |
| `issue_taxonomy`, `row_tags` | M4, M5 | `as_of` / `issue_id`; `DATE(eval_ts)` | category · lens · must_handle, 이슈 단위 차원 |
| `utterance_patterns`, `utterance_term_daily` (§14.1–14.2), `pattern_novelty_daily`, `novel_terms_daily` | M6 | `as_of` / `pattern_id` | `/issues/patterns`, novelty factor |
| `insights` | M7 | `as_of` / `window_key, filter_hash` | `/issues/insights`, `report.md` |
| Firestore `issue_triage/{issue_id}` + `history` (§14.3) | M8 | — | `Issue.state`, `PATCH /issues/{id}` |
| `traffic_share_daily`, `issue_impact_daily` | M9 | `date` / `intent, division, region` | (도입 시) 영향 추정 |
| `analysis_runs` | 전체 | `DATE(started_at)` | freshness 표시, `/issues/modules` 상태(권장) |

### 6.3 배치 job 계약

| Job | 트리거 | 모듈 | 입력 | 출력 · 쓰기 방식 |
| --- | --- | --- | --- | --- |
| `issue-analysis-incremental` (Cloud Run Job) | Pub/Sub `pipeline-batch-completed`(`WORKFLOW_COMPLETED`, integration-spec §4.4), 5분 debounce로 묶음 | M2(집계), M1(증분 할당), M5, M8(`new_critical` 재평가) | `{ run_id, trigger: "batch", pipeline_job_ids[], partitions[] (KST date), watermark (max loaded_at) }` | `issue_daily_agg` 해당 date partition 재계산(`MERGE` on 차원 키), `issue_membership` `MERGE ON (utterance_id, pipeline_job_id)` |
| `issue-analysis-daily` (Cloud Scheduler KST 02:00 → Cloud Run Job / Vertex pipeline) | 일 1회 + 수동 재실행 | M1(재군집 · merge / split), M2(검정), M3(snapshot), M4, M6, M7, M9 | `{ run_id, trigger: "daily", as_of (KST date), window_keys: [today, 24h, 7d, 30d], module_versions{}, ref_versions{} }` | 각 테이블의 `as_of` partition을 **통째로 교체**(`WRITE_TRUNCATE` partition decorator) |
| `issue-taxonomy-on-change` | M1이 이슈 생성 · 멤버십 20% 이상 변경을 기록할 때 | M4 | `{ issue_ids[], rubric_version }` | `issue_taxonomy` `MERGE ON (issue_id, as_of)` |

**멱등성.**

- `run_id = "ia_" + sha1(trigger + as_of_or_watermark + sorted(pipeline_job_ids) + module_versions)[0:20]` — integration-spec §4.4 step 5의 결정적 job id와 같은 방식. 같은 입력으로 재시도하면 같은 `run_id`가 되어 중복 쓰기가 없다.
- 행 단위 출력은 자연키 `MERGE`(`(utterance_id, pipeline_job_id)`, `(issue_id, as_of, window_key)`), 일 단위 출력은 partition 교체. append-only 쓰기는 금지.
- `analysis_runs(run_id, trigger, status (RUNNING | SUCCEEDED | FAILED), started_at, finished_at, watermark, module_versions, ref_versions, row_counts, error)`. 완료 후 Firestore `analysis_state/current`의
  `{ daily_run_id, incremental_watermark }`를 transaction으로 교체한다. API는 이 포인터의 run만 읽는다(readers never see partial results).
- 늦게 도착한 결과(재시도 · replay로 과거 date에 행이 추가됨): 증분 job이 `partitions[]`에 그 date를 넣어 재계산하고, daily job은 영향을 받은 `as_of`를 다시 돌린다.
- 모듈 버전이 바뀌면 같은 `as_of`도 새 `run_id`가 되므로 이전 결과와 나란히 남는다(shadow 비교 가능).

### 6.4 mock → 모듈 → 운영 테이블 매핑

| mock 위치 | 모듈 | 운영 출력 |
| --- | --- | --- |
| `issues-engine.ts` `groupKey`, `compute()` 군집 부분, `MIN_SUPPORT*`, `issues-store.ts issueIdOf`, `issues-text.ts hash36` | M1 | `issue_registry`, `issue_membership` |
| `issues-engine.ts baselineFor`, `RELEASE_COLUMNS` 완화, trend z, `isNew`, regression · `bixbyReg`, `issues.ts bixbyCells`, `issues-dims.ts` baseline 통계 | M2 | `issue_daily_agg`, `issue_trend_daily`, `version_regression` |
| `issues-engine.ts FACTOR_WEIGHTS`, `CLASS_VALUE`, factor 계산, severity · floor, `reasons[]` | M3 | `issue_snapshot` |
| `issues-engine.ts severityClassOf`, `issues-taxonomy.ts classify`, `rowTagsOf` | M4 (+ R6) | `issue_taxonomy`, `row_tags` |
| `issues-taxonomy.ts capabilityOf`, `supportOf`, `domain.ts capabilities` | M5 (+ R4) | `issue_membership.capability_status`, `issue_taxonomy.must_handle` |
| `issues-engine.ts patternsOf`, `novelPatterns`, `issues-text.ts tokens / terms / patternKind / PRODUCT_TERMS / EN_IN_ES` | M6 (+ R5) | `utterance_patterns`, `utterance_term_daily`, `pattern_novelty_daily`, `novel_terms_daily` |
| `issues.ts buildInsights`, `issuesMarkdown` | M7 | `insights` |
| `issues-store.ts` (store, `TRANSITIONS`, `patchIssueState`, `announceCritical`, seed) | M8 | Firestore `issue_triage` + `history`, `audit_log` |
| (없음) | M9 | `traffic_share_daily`, `issue_impact_daily` |
| `issues.ts` list · summary · facets · breakdown · matrix · group · export (조회 · 집계 계층) | — (API) | 위 테이블을 읽는 Operations API 핸들러 |
| `domain.ts deviceDivision / marketRegion` · `fnOfIntent` | R1 · R2 · R3 | `ref.dim_device`, `ref.dim_market`, `ref.dim_intent` |

### 6.5 전환 경로 (integration-spec §13.3 연계)

1. **Phase 1**: quality service는 `utterance_results` / `quality_daily_agg`만 읽는다. issues 엔진과 코드 · 테이블을 공유하지 않는다.
2. **규칙 이식 (rule parity)**: §6.4의 mock 함수를 배치 코드로 그대로 옮긴다(`module_version = "rule-1"`). mock이 쓰는 같은 행을 BigQuery에 적재해 **golden test**를 돌린다:
   이슈 ID · 멤버십 100% 일치, score · factor 값 차이 ≤ 0.1, taxonomy · must_handle 100% 일치, 패턴 · 인사이트 목록 일치. 모듈별 parity가 통과해야 다음 단계로 간다.
3. **API 전환 (모듈별 flag)**: Operations API가 모듈마다 `ISSUES_SOURCE_M<n> = compute | table`로 원천을 바꾼다. 콘솔은 `OPERATIONS_API_URL`로 proxy 모드가 되며 mock은 dev / demo 전용으로 남는다(integration-spec §13.3 #5).
   `/issues/modules`의 상태는 "Mock 시뮬레이션" → "규칙 기반 배치(rule)" → "운영(TARGET)"으로 바뀐다.
4. **방법 교체 (shadow)**: TARGET 방법(embedding 군집, 통계 검정, LLM 분류 · 서술, n-gram + embedding 신규성)을 새 `module_version`으로 같은 `as_of`에 나란히 돌린다.
   최소 2주 비교(§3 각 모듈의 수용 기준) 후 `analysis_state/current`가 새 버전을 가리키게 한다. M1 교체는 M1 TARGET 6번의 ID 호환 규칙과 M8 merge / split 규칙을 같이 배포한다.
5. **M9 도입**: 승인 후 `traffic_share_daily` 공급, `issue_impact_daily` 산출, API 선택 필드 추가, M3 reach factor 교체(`scoring_config` 새 버전).
