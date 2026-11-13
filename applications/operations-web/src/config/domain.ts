/**
 * Domain configuration — the ONE file another project edits to reconfigure the console's domain
 * (languages + capacity defaults, stages, buckets, capsules, devices, models, pipeline registry).
 *
 * Isomorphic plain data (no runtime imports). The mock engine (src/server/mock/engine.ts) reads it
 * through runtime.ts; src/lib/catalog.ts re-exports the static parts; console.config.ts imports
 * `domain` from here. Keep the export name `domain` and its type `DomainConfig`.
 *
 * Pipeline registry
 *  - A pipeline has versions; each version is a DAG of nodes. A node is either a `component`
 *    (leaf, see `components`) or a `subpipeline` (ref "pipeline@version" — runs as a child
 *    PipelineJob with id `{parentJobId}.{nodeId}`). Nesting is arbitrary (policy-guard is 2 levels deep).
 *  - Root pipelines share the release train `releases` (v1.0 / v1.1 / v1.2-rc); a workflow's
 *    `pipeline_version` is one of those. Sub-pipelines use their own semver.
 *  - `legacyPhase` maps a ROOT node onto the six legacy DAG phases still served by
 *    GET /workflows/[id]/dag (backward compatibility).
 *  - nodes must be listed in topological order.
 */
import type { DomainConfig } from "@/lib/types";

export type { DomainConfig } from "@/lib/types";

const PROJECT = "bixby-eval-prod";
const REGION = "asia-northeast3";
const BUCKET_IN = "bixby-utterance-input";
const BUCKET_ART = "bixby-pipeline-artifacts";
const BUCKET_RES = "bixby-eval-results";
/** raw utterance audio referenced by the input JSONL `audio_uri`; read by Preprocess only (not browsable in the console) */
const BUCKET_AUDIO = "bixby-utterance-audio";
const BQ_TABLE = `${PROJECT}.bixby_eval.utterance_results`;

export const domain: DomainConfig = {
  id: "bixby-real-utterance-eval",
  name: "빅스비 실발화 평가",
  project: { id: PROJECT, number: "418027761953", region: REGION, environment: "production", console: "AIPO Operations Console" },
  timezone: "Asia/Seoul",
  baseNow: "2026-11-12T14:30:00+09:00",
  historyDays: 30,
  buckets: { input: BUCKET_IN, artifacts: BUCKET_ART, results: BUCKET_RES, audio: BUCKET_AUDIO },
  bigquery: { dataset: `${PROJECT}.bixby_eval`, resultsTable: BQ_TABLE, eventsTable: `${PROJECT}.aipo_ops.workflow_events` },

  // ───────────────────────────── languages + capacity defaults ──
  languages: [
    { code: "ko", name: "한국어", nameEn: "Korean", locale: "ko-KR", flag: "KR", maxConcurrent: 10, batchSize: 100, priorityWeight: 3, maxStartsPerMinute: 4, enabled: true, paused: false, backlogAlertThreshold: 8, p95WaitSloSec: 900, basePass: 0.875, bytesPerUtterance: 455, baseMinutes: 11, peakPerHour: 7.2, costPerRunUsd: 1.42, mixWeight: 0.55 },
    { code: "en", name: "영어", nameEn: "English", locale: "en-US", flag: "US", maxConcurrent: 25, batchSize: 200, priorityWeight: 5, maxStartsPerMinute: 8, enabled: true, paused: false, backlogAlertThreshold: 20, p95WaitSloSec: 600, basePass: 0.9, bytesPerUtterance: 390, baseMinutes: 18, peakPerHour: 4.6, costPerRunUsd: 2.31, mixWeight: 0.22 },
    { code: "ja", name: "일본어", nameEn: "Japanese", locale: "ja-JP", flag: "JP", maxConcurrent: 5, batchSize: 50, priorityWeight: 2, maxStartsPerMinute: 2, enabled: true, paused: false, backlogAlertThreshold: 6, p95WaitSloSec: 900, basePass: 0.82, bytesPerUtterance: 470, baseMinutes: 7.5, peakPerHour: 1.6, costPerRunUsd: 0.86, mixWeight: 0.13 },
    { code: "es", name: "스페인어", nameEn: "Spanish", locale: "es-ES", flag: "ES", maxConcurrent: 4, batchSize: 50, priorityWeight: 1, maxStartsPerMinute: 2, enabled: true, paused: false, backlogAlertThreshold: 5, p95WaitSloSec: 1200, basePass: 0.8, bytesPerUtterance: 405, baseMinutes: 7.5, peakPerHour: 1.1, costPerRunUsd: 0.81, mixWeight: 0.1 },
  ],
  capacity: {
    global: { maxConcurrent: 36, maxStartsPerMinute: 12 },
    gpuQuota: 16,
    terraformDefaults: {
      "languages.ko.maxConcurrent": 8, "languages.en.maxConcurrent": 25, "languages.ja.maxConcurrent": 5, "languages.es.maxConcurrent": 4,
      "languages.ko.maxStartsPerMinute": 4, "languages.en.maxStartsPerMinute": 10, "languages.ja.maxStartsPerMinute": 2, "languages.es.maxStartsPerMinute": 2,
      "languages.ko.priorityWeight": 3, "languages.en.priorityWeight": 5, "languages.ja.priorityWeight": 2, "languages.es.priorityWeight": 1,
      "global.maxConcurrent": 32, "global.maxStartsPerMinute": 12,
      "retry.maxRetries": 2, "retry.backoffSeconds": [60, 300],
      workflowTimeoutMin: 60, pipelineTimeoutMin: 60,
      defaultPipelineVersion: "v1.1",
    },
  },

  // ───────────────────────────── stages (pipeline map) ──
  stages: [
    { id: "gcs_input", order: 1, kind: "main", label: { ko: "실발화 입력 업로드", en: "GCS Input" }, gcpService: "Cloud Storage", resource: `gs://${BUCKET_IN}`, trigger: "google.cloud.storage.object.v1.finalized", icon: "upload-cloud", states: [], services: ["cloud-storage"], description: `언어별로 배치된 실발화 JSONL이 gs://${BUCKET_IN}/{date}/{lang}/batch-NNNN.jsonl 로 업로드되면 Object Finalized 이벤트가 발생한다.` },
    { id: "event_bus", order: 2, kind: "main", label: { ko: "이벤트 전달", en: "Eventarc / Pub/Sub" }, gcpService: "Eventarc · Pub/Sub", resource: `projects/${PROJECT}/topics/pipeline-batch-requested`, icon: "radio", states: [], services: ["eventarc", "pubsub"], description: "Eventarc 트리거가 GCS 이벤트를 CloudEvent로 감싸 Pub/Sub를 통해 비동기로 Event Ingress에 전달한다 (at-least-once)." },
    { id: "ingress", order: 3, kind: "main", label: { ko: "이벤트 수신·검증", en: "Cloud Run Event Ingress" }, gcpService: "Cloud Run", resource: "event-ingress", icon: "shield-check", states: ["RECEIVED", "VALIDATED"], services: ["event-ingress"], description: "스키마 검증, 중복 제거, SHA256 Idempotency Key 계산 후 Firestore에 이벤트와 Workflow를 등록한다." },
    { id: "registry_queue", order: 4, kind: "main", label: { ko: "등록·언어별 대기열", en: "Firestore Registry & Pending Queue" }, gcpService: "Firestore", resource: "pending_jobs/{lang}", icon: "list-ordered", states: ["QUEUED"], services: ["firestore"], description: "Event Registry · Workflow State · 언어별 Pending Queue. Priority → 대기시간 → FIFO 순으로 정렬된다." },
    { id: "scheduler", order: 5, kind: "main", label: { ko: "언어별 스케줄러", en: "Language-aware Scheduler" }, gcpService: "Cloud Run + Firestore Transaction", resource: "scheduler", icon: "gauge", states: ["RESERVED"], services: ["scheduler"], description: "language_active < language_limit AND global_active < global_limit 일 때 Slot Reservation(fencing token)을 발급한다." },
    { id: "workflows", order: 6, kind: "main", label: { ko: "워크플로 오케스트레이션", en: "Cloud Workflows" }, gcpService: "Cloud Workflows", resource: "pipeline-orchestrator", icon: "workflow", states: ["DISPATCHING", "CANCELLED", "TIMED_OUT"], services: ["dispatcher", "pipeline-orchestrator"], description: "PipelineJob 생성({workflow_id}-cycle-{c}-attempt-{a}), 완료 모니터링, 오류 분류, 취소/Timeout 처리, 최종 실패 라우팅." },
    { id: "vertex", order: 7, kind: "main", label: { ko: "평가 파이프라인", en: "Vertex AI Pipeline" }, gcpService: "Vertex AI Pipelines", resource: "pipeline registry (bixby-eval-*)", icon: "cpu", states: ["RUNNING"], services: ["vertex-ai-pipelines"], components: ["preprocess", "intent_eval", "response_eval", "latency_check", "aggregate", "persist"], description: "Pipeline Registry의 루트 Pipeline(bixby-eval-full / quick / regression-nightly / tts-quality)이 하위 Pipeline(asr-eval · nlu-eval · response-judge → policy-guard)을 자식 PipelineJob으로 호출한다." },
    { id: "results", order: 8, kind: "main", label: { ko: "결과 저장", en: "Result CSV + BigQuery" }, gcpService: "Cloud Storage · BigQuery", resource: `gs://${BUCKET_RES} · ${BQ_TABLE}`, icon: "file-check", states: ["SUCCEEDED"], services: ["result-commit"], description: "발화별 PASS/FAIL 결과 CSV를 GCS에 업로드하고 BigQuery에 Commit한 뒤 완료 이벤트를 발행한다." },
    { id: "retry", order: 9, kind: "branch", branchFrom: "vertex", returnsTo: "vertex", label: { ko: "재시도 제어", en: "Retry Controller" }, gcpService: "Cloud Workflows", resource: "pipeline-orchestrator (retry policy)", icon: "rotate-ccw", states: ["RETRY_WAIT"], services: ["pipeline-orchestrator"], description: "Attempts < 3 이고 재시도 가능한 오류면 Backoff(60s → 300s) 후 Admission을 다시 거쳐 재실행한다." },
    { id: "dlq", order: 10, kind: "branch", branchFrom: "retry", returnsTo: "registry_queue", label: { ko: "DLQ·수동 Replay", en: "DLQ Manager / Replay" }, gcpService: "Pub/Sub · Cloud Run", resource: `projects/${PROJECT}/topics/pipeline-dead-letter`, icon: "archive-x", states: ["DEAD_LETTERED"], services: ["dlq-manager"], description: "최종 실패 및 비복구성 오류를 격리하고, 운영자 검토 후 새 Replay Cycle로 대기열에 재등록한다." },
  ],
  stageEdges: [
    { from: "gcs_input", to: "event_bus", label: "Object Finalized" },
    { from: "event_bus", to: "ingress", label: "CloudEvent push" },
    { from: "ingress", to: "registry_queue", label: "register + enqueue" },
    { from: "registry_queue", to: "scheduler", label: "admission" },
    { from: "scheduler", to: "workflows", label: "slot reserved" },
    { from: "workflows", to: "vertex", label: "create PipelineJob" },
    { from: "vertex", to: "results", label: "SUCCESS", tone: "success" },
    { from: "vertex", to: "retry", label: "FAILURE", tone: "failed" },
    { from: "retry", to: "vertex", label: "attempts < 3", tone: "retry" },
    { from: "retry", to: "dlq", label: "attempts = 3 / non-retryable", tone: "dlq" },
    { from: "dlq", to: "registry_queue", label: "Manual Replay", tone: "retry", dashed: true },
  ],

  // ───────────────────────────── utterance content ──
  capsules: [
    { id: "weather", label: "날씨", labelEn: "Weather", weight: 14, adj: 0.05, confuse: "calendar" },
    { id: "alarm_timer", label: "알람·타이머", labelEn: "Alarm & Timer", weight: 13, adj: 0.06, confuse: "calendar" },
    { id: "music", label: "음악", labelEn: "Music", weight: 14, adj: 0.0, confuse: "general_qa" },
    { id: "device_control", label: "기기제어(SmartThings)", labelEn: "Device Control (SmartThings)", weight: 12, adj: -0.04, confuse: "settings" },
    { id: "call_message", label: "전화·메시지", labelEn: "Call & Message", weight: 11, adj: -0.02, confuse: "calendar" },
    { id: "calendar", label: "캘린더", labelEn: "Calendar", weight: 9, adj: 0.0, confuse: "alarm_timer" },
    { id: "navigation", label: "길찾기", labelEn: "Navigation", weight: 9, adj: -0.03, confuse: "general_qa" },
    { id: "settings", label: "설정", labelEn: "Settings", weight: 8, adj: 0.02, confuse: "device_control" },
    { id: "general_qa", label: "일반 Q&A", labelEn: "General Q&A", weight: 10, adj: -0.07, confuse: "music" },
  ],
  devices: [
    { id: "Galaxy S26", weight: 50, adj: 0, lat: [850, 1750] },
    { id: "Galaxy Watch", weight: 15, adj: -0.02, lat: [1350, 2600] },
    { id: "Galaxy Buds", weight: 12, adj: -0.04, lat: [1200, 2400] },
    { id: "TV", weight: 12, adj: 0, lat: [1000, 2050] },
    { id: "Family Hub", weight: 11, adj: -0.01, lat: [1300, 2500] },
  ],

  // ───────────────────────────── models under test (≠ pipeline version) ──
  models: [
    { id: "bixby-nlu-2026.09", label: "Bixby NLU 2026.09", status: "RETIRED", releasedAt: "2026-09-08T10:00:00+09:00", passAdj: -0.02, weight: 0, notes: "10월 정기 배포로 대체" },
    { id: "bixby-nlu-2026.10", label: "Bixby NLU 2026.10", status: "PRODUCTION", releasedAt: "2026-10-14T10:00:00+09:00", passAdj: 0, weight: 7, notes: "현재 운영 모델" },
    { id: "bixby-nlu-2026.11-rc", label: "Bixby NLU 2026.11-rc", status: "CANDIDATE", releasedAt: "2026-11-09T09:00:00+09:00", passAdj: 0.015, weight: 3, notes: "11월 후보. 일반 Q&A 개선, 기기제어 slot 회귀 조사 중" },
  ],

  // ───────────────────────────── root pipeline release train ──
  releases: [
    { version: "v1.0", status: "DEPRECATED", trafficPct: 0, releasedAt: "2026-09-28T10:00:00+09:00", imageTag: "1.0.4", judgeModel: "gemini-2.0-flash", modelUnderTest: "bixby-agent-3.4.2", notes: "초기 버전. 11/08 이후 신규 배치에 사용하지 않음", passAdj: -0.03, costPerRunUsd: 1.38 },
    { version: "v1.1", status: "STABLE", trafficPct: 50, releasedAt: "2026-11-05T11:00:00+09:00", imageTag: "1.1.2", judgeModel: "gemini-2.5-flash", modelUnderTest: "bixby-agent-3.5.0", notes: "기본(default) 버전", passAdj: 0, costPerRunUsd: 1.52 },
    { version: "v1.2-rc", status: "CANARY", trafficPct: 50, releasedAt: "2026-11-11T09:30:00+09:00", imageTag: "1.2.0-rc2", judgeModel: "gemini-2.5-pro", modelUnderTest: "bixby-agent-3.6.0-rc2", notes: "응답 평가 프롬프트 개선, 기기제어(SmartThings) slot 파서 교체(회귀 조사 중)", passAdj: 0.04, costPerRunUsd: 1.71 },
  ],
  defaultRelease: "v1.1",

  // ───────────────────────────── leaf components ──
  components: {
    preprocess: { id: "preprocess", label: "Preprocess", labelKo: "전처리", ev: "PREPROCESS", weight: 0.11, machineType: "n2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/preprocess", metric: "none", description: "JSONL 파싱, 스키마 검증, 정규화, PII 마스킹, capsule 힌트 매핑", outputs: [{ name: "normalized_utterances", file: "normalized_utterances.jsonl", type: "system.Dataset", bytesPerUtterance: 510 }] },
    wer_calc: { id: "wer_calc", label: "WER", labelKo: "단어 오류율", ev: "WER_CALC", weight: 0.09, machineType: "n2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/asr-wer", metric: "asr", description: "ASR 전사와 원문 간 단어 오류율(WER) 계산", outputs: [{ name: "wer_report", file: "wer_report.json", type: "system.Metrics", bytesPerUtterance: 38, fixedBytes: 900 }] },
    cer_calc: { id: "cer_calc", label: "CER", labelKo: "문자 오류율", ev: "CER_CALC", weight: 0.08, machineType: "n2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/asr-cer", metric: "asr", description: "문자 단위 오류율(CER) — ko/ja 기준 지표", outputs: [{ name: "cer_report", file: "cer_report.json", type: "system.Metrics", bytesPerUtterance: 36, fixedBytes: 900 }] },
    noise_robustness: { id: "noise_robustness", label: "Noise Robustness", labelKo: "소음 강건성", ev: "NOISE_ROBUSTNESS", weight: 0.16, machineType: "g2-standard-4", cpu: 4, gpu: { type: "NVIDIA_L4", count: 1 }, memGb: 16, image: "components/asr-noise", metric: "asr", description: "SNR 0/5/10dB 잡음 합성 후 재인식 정확도 측정", outputs: [{ name: "noise_report", file: "noise_report.jsonl", type: "system.Dataset", bytesPerUtterance: 140 }] },
    intent_classify: { id: "intent_classify", label: "Intent Classify", labelKo: "의도 분류", ev: "INTENT_CLASSIFY", weight: 0.16, machineType: "n2-standard-8", cpu: 8, gpu: null, memGb: 32, image: "components/intent-classify", metric: "intent", description: "Bixby Agent에 발화를 재생하여 intent 예측과 기대값 비교", outputs: [{ name: "intent_predictions", file: "intent_predictions.jsonl", type: "system.Dataset", bytesPerUtterance: 310 }, { name: "intent_metrics", file: "intent_metrics.json", type: "system.Metrics", fixedBytes: 2400 }] },
    slot_fill: { id: "slot_fill", label: "Slot Fill", labelKo: "슬롯 추출", ev: "SLOT_FILL", weight: 0.1, machineType: "n2-standard-8", cpu: 8, gpu: null, memGb: 32, image: "components/slot-fill", metric: "slot", description: "슬롯 값 추출 정확도(정확 일치 / 정규화 일치)", outputs: [{ name: "slot_predictions", file: "slot_predictions.jsonl", type: "system.Dataset", bytesPerUtterance: 220 }] },
    capsule_route: { id: "capsule_route", label: "Capsule Route", labelKo: "캡슐 라우팅", ev: "CAPSULE_ROUTE", weight: 0.06, machineType: "e2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/capsule-route", metric: "intent", description: "예측 intent → capsule 라우팅 정합성 확인", outputs: [{ name: "routing_report", file: "routing_report.json", type: "system.Metrics", bytesPerUtterance: 24, fixedBytes: 1200 }] },
    llm_judge: { id: "llm_judge", label: "LLM Judge", labelKo: "LLM 응답 채점", ev: "LLM_JUDGE", weight: 0.44, machineType: "g2-standard-8", cpu: 8, gpu: { type: "NVIDIA_L4", count: 1 }, memGb: 32, image: "components/llm-judge", metric: "response", description: "LLM Judge가 기대 응답 대비 실제 응답의 정확성·유용성을 0~1로 채점", outputs: [{ name: "judge_scores", file: "judge_scores.jsonl", type: "system.Dataset", bytesPerUtterance: 520 }, { name: "judge_metrics", file: "judge_metrics.json", type: "system.Metrics", fixedBytes: 2100 }] },
    toxicity: { id: "toxicity", label: "Toxicity", labelKo: "유해성 검사", ev: "TOXICITY", weight: 0.08, machineType: "g2-standard-4", cpu: 4, gpu: { type: "NVIDIA_L4", count: 1 }, memGb: 16, image: "components/toxicity", metric: "safety", description: "응답 유해성/정책 위반 분류기", outputs: [{ name: "toxicity_flags", file: "toxicity_flags.jsonl", type: "system.Dataset", bytesPerUtterance: 64 }] },
    pii_scan: { id: "pii_scan", label: "PII Scan", labelKo: "개인정보 탐지", ev: "PII_SCAN", weight: 0.07, machineType: "n2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/pii-scan", metric: "safety", description: "응답 내 전화번호·주소 등 개인정보 노출 탐지", outputs: [{ name: "pii_findings", file: "pii_findings.jsonl", type: "system.Dataset", bytesPerUtterance: 48 }] },
    latency_check: { id: "latency_check", label: "Latency Check", labelKo: "지연 측정", ev: "LATENCY_CHECK", weight: 0.12, machineType: "e2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/latency-check", metric: "latency", description: "발화별 end-to-end 응답 지연 측정 및 8,000ms 초과 판정", outputs: [{ name: "latency_report", file: "latency_report.json", type: "system.Metrics", bytesPerUtterance: 42, fixedBytes: 900 }] },
    tts_synthesize: { id: "tts_synthesize", label: "TTS Synthesize", labelKo: "음성 합성", ev: "TTS_SYNTHESIZE", weight: 0.2, machineType: "g2-standard-8", cpu: 8, gpu: { type: "NVIDIA_L4", count: 1 }, memGb: 32, image: "components/tts-synthesize", metric: "none", description: "응답 텍스트를 Bixby TTS로 합성(opus)", outputs: [{ name: "tts_audio_manifest", file: "tts_audio_manifest.jsonl", type: "system.Dataset", bytesPerUtterance: 180 }] },
    mos_predict: { id: "mos_predict", label: "MOS Predict", labelKo: "음질(MOS) 예측", ev: "MOS_PREDICT", weight: 0.18, machineType: "g2-standard-4", cpu: 4, gpu: { type: "NVIDIA_L4", count: 1 }, memGb: 16, image: "components/mos-predict", metric: "response", description: "합성 음성의 MOS 점수 예측", outputs: [{ name: "mos_scores", file: "mos_scores.jsonl", type: "system.Dataset", bytesPerUtterance: 60 }] },
    aggregate: { id: "aggregate", label: "Aggregate", labelKo: "결과 집계", ev: "AGGREGATION", weight: 0.11, machineType: "n2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/aggregate", metric: "pass", description: "발화별 PASS/FAIL 판정, failure_reason 분류, capsule/디바이스별 요약", outputs: [{ name: "results_csv", file: "results.csv", type: "system.Dataset", bytesPerUtterance: 560 }, { name: "eval_summary", file: "eval_summary.json", type: "system.Metrics", fixedBytes: 3800 }] },
    compare_baseline: { id: "compare_baseline", label: "Compare Baseline", labelKo: "기준 모델 비교", ev: "COMPARE_BASELINE", weight: 0.1, machineType: "n2-standard-4", cpu: 4, gpu: null, memGb: 16, image: "components/compare-baseline", metric: "pass", description: "운영 모델(baseline) 결과와 발화별 PASS/FAIL 차이 비교, 회귀 목록 생성", outputs: [{ name: "results_csv", file: "results.csv", type: "system.Dataset", bytesPerUtterance: 560 }, { name: "regression_report", file: "regression_report.json", type: "system.Metrics", fixedBytes: 5200 }] },
    persist: { id: "persist", label: "Persist", labelKo: "결과 저장", ev: "PERSIST", weight: 0.07, machineType: "e2-standard-2", cpu: 2, gpu: null, memGb: 8, image: "components/persist", metric: "pass", description: "results.csv를 GCS에 업로드하고 BigQuery utterance_results에 적재", outputs: [], persists: true },
  },

  // ───────────────────────────── pipeline registry ──
  pipelines: [
    {
      id: "bixby-eval-full", label: "Bixby Eval · Full", labelKo: "빅스비 전체 평가", kind: "root", durationFactor: 1, mixWeight: 0.6,
      description: "전처리 → ASR · NLU · 응답 평가(하위 Pipeline 병렬) → 집계 → 저장. 정기 실발화 배치의 기본 Pipeline.",
      versions: [
        { version: "v1.0", status: "DEPRECATED", releasedAt: "2026-09-28T10:00:00+09:00", notes: "response-judge 1.0 (안전성 검사 없음)", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "asr_eval", kind: "subpipeline", ref: { pipeline: "asr-eval", version: "1.0.0" }, deps: ["preprocess"], legacyPhase: "latency_check" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.0.0" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "response_judge", kind: "subpipeline", ref: { pipeline: "response-judge", version: "1.0.0" }, deps: ["preprocess"], legacyPhase: "response_eval" },
          { id: "aggregate", kind: "component", component: "aggregate", deps: ["asr_eval", "nlu_eval", "response_judge"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["aggregate"], legacyPhase: "persist" },
        ] },
        { version: "v1.1", status: "STABLE", releasedAt: "2026-11-05T11:00:00+09:00", notes: "response-judge 1.1 (policy-guard 하위 Pipeline 추가)", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "asr_eval", kind: "subpipeline", ref: { pipeline: "asr-eval", version: "1.0.0" }, deps: ["preprocess"], legacyPhase: "latency_check" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.1.0" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "response_judge", kind: "subpipeline", ref: { pipeline: "response-judge", version: "1.1.0" }, deps: ["preprocess"], legacyPhase: "response_eval" },
          { id: "aggregate", kind: "component", component: "aggregate", deps: ["asr_eval", "nlu_eval", "response_judge"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["aggregate"], legacyPhase: "persist" },
        ] },
        { version: "v1.2-rc", status: "CANARY", releasedAt: "2026-11-11T09:30:00+09:00", notes: "nlu-eval 2.2.0-rc (slot 파서 교체), response-judge 1.1.0", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "asr_eval", kind: "subpipeline", ref: { pipeline: "asr-eval", version: "1.1.0" }, deps: ["preprocess"], legacyPhase: "latency_check" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.2.0-rc" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "response_judge", kind: "subpipeline", ref: { pipeline: "response-judge", version: "1.1.0" }, deps: ["preprocess"], legacyPhase: "response_eval" },
          { id: "aggregate", kind: "component", component: "aggregate", deps: ["asr_eval", "nlu_eval", "response_judge"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["aggregate"], legacyPhase: "persist" },
        ] },
      ],
    },
    {
      id: "bixby-eval-quick", label: "Bixby Eval · Quick", labelKo: "빅스비 빠른 평가", kind: "root", durationFactor: 0.45, mixWeight: 0.2,
      description: "NLU만 평가하는 경량 Pipeline (긴급 회귀 확인용). 결과 저장을 위해 persist를 포함한다.",
      versions: [
        { version: "v1.1", status: "STABLE", releasedAt: "2026-11-05T11:00:00+09:00", notes: "", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.1.0" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "aggregate", kind: "component", component: "aggregate", deps: ["nlu_eval"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["aggregate"], legacyPhase: "persist" },
        ] },
        { version: "v1.2-rc", status: "CANARY", releasedAt: "2026-11-11T09:30:00+09:00", notes: "", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.2.0-rc" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "aggregate", kind: "component", component: "aggregate", deps: ["nlu_eval"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["aggregate"], legacyPhase: "persist" },
        ] },
      ],
    },
    {
      id: "bixby-regression-nightly", label: "Bixby Regression · Nightly", labelKo: "빅스비 야간 회귀", kind: "root", durationFactor: 0.85, mixWeight: 0.12,
      description: "매일 02시 KST — NLU · 응답 평가 후 운영 모델(baseline)과 비교하여 회귀 목록을 만든다.",
      versions: [
        { version: "v1.0", status: "DEPRECATED", releasedAt: "2026-09-28T10:00:00+09:00", notes: "", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.0.0" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "response_judge", kind: "subpipeline", ref: { pipeline: "response-judge", version: "1.0.0" }, deps: ["preprocess"], legacyPhase: "response_eval" },
          { id: "compare_baseline", kind: "component", component: "compare_baseline", deps: ["nlu_eval", "response_judge"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["compare_baseline"], legacyPhase: "persist" },
        ] },
        { version: "v1.1", status: "STABLE", releasedAt: "2026-11-05T11:00:00+09:00", notes: "", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.1.0" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "response_judge", kind: "subpipeline", ref: { pipeline: "response-judge", version: "1.1.0" }, deps: ["preprocess"], legacyPhase: "response_eval" },
          { id: "compare_baseline", kind: "component", component: "compare_baseline", deps: ["nlu_eval", "response_judge"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["compare_baseline"], legacyPhase: "persist" },
        ] },
        { version: "v1.2-rc", status: "CANARY", releasedAt: "2026-11-11T09:30:00+09:00", notes: "", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "nlu_eval", kind: "subpipeline", ref: { pipeline: "nlu-eval", version: "2.2.0-rc" }, deps: ["preprocess"], legacyPhase: "intent_eval" },
          { id: "response_judge", kind: "subpipeline", ref: { pipeline: "response-judge", version: "1.1.0" }, deps: ["preprocess"], legacyPhase: "response_eval" },
          { id: "compare_baseline", kind: "component", component: "compare_baseline", deps: ["nlu_eval", "response_judge"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["compare_baseline"], legacyPhase: "persist" },
        ] },
      ],
    },
    {
      id: "tts-quality", label: "TTS Quality", labelKo: "TTS 음질 평가", kind: "root", durationFactor: 0.9, mixWeight: 0.08, languages: ["ko", "en"],
      description: "응답 음성 합성 → MOS 예측 + ASR 왕복(asr-eval) → 집계 → 저장. ko/en만 지원.",
      versions: [
        { version: "v1.2-rc", status: "CANARY", releasedAt: "2026-11-11T09:30:00+09:00", notes: "신규", nodes: [
          { id: "preprocess", kind: "component", component: "preprocess", deps: [], legacyPhase: "preprocess" },
          { id: "tts_synthesize", kind: "component", component: "tts_synthesize", deps: ["preprocess"], legacyPhase: "preprocess" },
          { id: "mos_predict", kind: "component", component: "mos_predict", deps: ["tts_synthesize"], legacyPhase: "response_eval" },
          { id: "asr_roundtrip", kind: "subpipeline", ref: { pipeline: "asr-eval", version: "1.1.0" }, deps: ["tts_synthesize"], legacyPhase: "latency_check" },
          { id: "aggregate", kind: "component", component: "aggregate", deps: ["mos_predict", "asr_roundtrip"], legacyPhase: "aggregate" },
          { id: "persist", kind: "component", component: "persist", deps: ["aggregate"], legacyPhase: "persist" },
        ] },
      ],
    },
    // ── sub-pipelines ──
    {
      id: "asr-eval", label: "ASR Eval", labelKo: "ASR 평가", kind: "sub", description: "ASR 인식 품질: WER · CER · 소음 강건성.",
      versions: [
        { version: "1.0.0", status: "STABLE", releasedAt: "2026-09-20T10:00:00+09:00", notes: "", nodes: [
          { id: "wer_calc", kind: "component", component: "wer_calc", deps: [] },
          { id: "cer_calc", kind: "component", component: "cer_calc", deps: [] },
        ] },
        { version: "1.1.0", status: "STABLE", releasedAt: "2026-11-10T10:00:00+09:00", notes: "noise_robustness 추가", nodes: [
          { id: "wer_calc", kind: "component", component: "wer_calc", deps: [] },
          { id: "cer_calc", kind: "component", component: "cer_calc", deps: [] },
          { id: "noise_robustness", kind: "component", component: "noise_robustness", deps: ["wer_calc"] },
        ] },
      ],
    },
    {
      id: "nlu-eval", label: "NLU Eval", labelKo: "NLU 평가", kind: "sub", description: "의도 분류 → 슬롯 추출 → 캡슐 라우팅.",
      versions: [
        { version: "2.0.0", status: "DEPRECATED", releasedAt: "2026-09-20T10:00:00+09:00", notes: "", nodes: [
          { id: "intent_classify", kind: "component", component: "intent_classify", deps: [] },
          { id: "slot_fill", kind: "component", component: "slot_fill", deps: ["intent_classify"] },
        ] },
        { version: "2.1.0", status: "STABLE", releasedAt: "2026-11-05T10:00:00+09:00", notes: "capsule_route 추가", nodes: [
          { id: "intent_classify", kind: "component", component: "intent_classify", deps: [] },
          { id: "slot_fill", kind: "component", component: "slot_fill", deps: ["intent_classify"] },
          { id: "capsule_route", kind: "component", component: "capsule_route", deps: ["intent_classify"] },
        ] },
        { version: "2.2.0-rc", status: "CANARY", releasedAt: "2026-11-11T09:00:00+09:00", notes: "SmartThings slot 파서 교체", nodes: [
          { id: "intent_classify", kind: "component", component: "intent_classify", deps: [] },
          { id: "slot_fill", kind: "component", component: "slot_fill", deps: ["intent_classify"] },
          { id: "capsule_route", kind: "component", component: "capsule_route", deps: ["intent_classify"] },
        ] },
      ],
    },
    {
      id: "response-judge", label: "Response Judge", labelKo: "응답 평가", kind: "sub", description: "LLM Judge 채점 → 안전성 검사(policy-guard 하위 Pipeline) + 지연 측정.",
      versions: [
        { version: "1.0.0", status: "DEPRECATED", releasedAt: "2026-09-20T10:00:00+09:00", notes: "", nodes: [
          { id: "llm_judge", kind: "component", component: "llm_judge", deps: [] },
          { id: "latency_check", kind: "component", component: "latency_check", deps: [] },
        ] },
        { version: "1.1.0", status: "STABLE", releasedAt: "2026-11-05T10:00:00+09:00", notes: "safety_check(policy-guard) 추가", nodes: [
          { id: "llm_judge", kind: "component", component: "llm_judge", deps: [] },
          { id: "latency_check", kind: "component", component: "latency_check", deps: [] },
          { id: "safety_check", kind: "subpipeline", ref: { pipeline: "policy-guard", version: "1.0.0" }, deps: ["llm_judge"] },
        ] },
      ],
    },
    {
      id: "policy-guard", label: "Policy Guard", labelKo: "정책 가드", kind: "sub", description: "유해성 분류 + 개인정보 탐지.",
      versions: [
        { version: "1.0.0", status: "STABLE", releasedAt: "2026-11-05T10:00:00+09:00", notes: "", nodes: [
          { id: "toxicity", kind: "component", component: "toxicity", deps: [] },
          { id: "pii_scan", kind: "component", component: "pii_scan", deps: [] },
        ] },
      ],
    },
  ],
};

export default domain;
