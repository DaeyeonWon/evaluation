/**
 * catalog — reference data labels from src/lib/catalog.ts (stages, DAG components, Event types,
 * Capsules, devices, languages). Keys are the catalog ids, so `t(\`stages.${stage.id}.label\`)` type-checks.
 *
 * - stages.*.label    localized stage title (ko keeps system nouns in English)
 * - stages.*.service  the system name — identical in every locale (= STAGES[].label.en)
 * - capsules / devices: proper nouns. Devices stay English in both locales.
 */
const catalog = {
  stages: {
    gcs_input: {
      label: "실발화 입력 업로드",
      service: "GCS Input",
      description: "언어별로 배치된 실발화 JSONL이 gs://bixby-utterance-input/{date}/{lang}/batch-NNNN.jsonl 로 업로드되면 Object Finalized Event가 발생합니다.",
    },
    event_bus: {
      label: "Event 전달",
      service: "Eventarc / Pub/Sub",
      description: "Eventarc 트리거가 GCS Event를 CloudEvent로 감싸 Pub/Sub를 통해 비동기로 Event Ingress에 전달합니다 (at-least-once).",
    },
    ingress: {
      label: "Event 수신·검증",
      service: "Cloud Run Event Ingress",
      description: "스키마 검증, 중복 제거, SHA256 Idempotency Key 계산 후 Firestore에 Event와 Workflow를 등록합니다.",
    },
    registry_queue: {
      label: "등록·언어별 Pending Queue",
      service: "Firestore Registry & Pending Queue",
      description: "Event Registry · Workflow State · 언어별 Pending Queue. Priority → 대기 시간 → FIFO 순으로 정렬합니다.",
    },
    scheduler: {
      label: "언어별 Scheduler",
      service: "Language-aware Scheduler",
      description: "language_active < language_limit AND global_active < global_limit 일 때 Slot Reservation(fencing token)을 발급합니다.",
    },
    workflows: {
      label: "Workflow 오케스트레이션",
      service: "Cloud Workflows",
      description: "PipelineJob 생성({workflow_id}-cycle-{c}-attempt-{a}), 완료 모니터링, 오류 분류, 취소/Timeout 처리, 최종 실패 라우팅을 담당합니다.",
    },
    vertex: {
      label: "평가 Pipeline",
      service: "Vertex AI Pipeline",
      description: "Preprocessing → Agent Evaluation(Intent·응답(LLM Judge)·지연) → Result Aggregation → Output Persistence.",
    },
    results: {
      label: "결과 저장",
      service: "Result CSV + BigQuery",
      description: "발화별 PASS/FAIL 결과 CSV를 GCS에 업로드하고 BigQuery에 Commit한 뒤 완료 Event를 발행합니다.",
    },
    retry: {
      label: "Retry 제어",
      service: "Retry Controller",
      description: "Attempt < 3 이고 재시도 가능한 오류면 Backoff(60s → 300s) 후 Admission을 다시 거쳐 재실행합니다.",
    },
    dlq: {
      label: "DLQ·수동 Replay",
      service: "DLQ Manager / Replay",
      description: "최종 실패 및 비복구성 오류를 격리하고, 운영자 검토 후 새 Replay Cycle로 대기열에 재등록합니다.",
    },
  },
  /** Vertex AI Pipeline DAG components (DAG_TEMPLATE) */
  components: {
    preprocess: { label: "Preprocess", description: "JSONL 파싱, 스키마 검증, 정규화, PII 마스킹, Capsule 힌트 매핑" },
    intent_eval: { label: "Intent Eval", description: "Bixby Agent에 발화를 재생하여 Intent/Slot 예측을 기대값과 비교" },
    response_eval: { label: "Response Eval (LLM Judge)", description: "LLM Judge가 기대 응답 대비 실제 응답의 정확성·유용성·정책 준수를 0~1로 채점" },
    latency_check: { label: "Latency Check", description: "발화별 end-to-end 응답 지연 측정 및 8,000ms 초과 판정" },
    aggregate: { label: "Aggregate", description: "발화별 PASS/FAIL 판정, failure_reason 분류, Capsule/디바이스별 요약" },
    persist: { label: "Persist", description: "results.csv를 GCS에 업로드하고 BigQuery utterance_results에 적재" },
  },
  /** EVENT_CATALOG labels (event type → human label). The raw type stays visible in mono next to it. */
  events: {
    GCS_OBJECT_FINALIZED: "GCS 객체 업로드 완료",
    EVENT_PUBLISHED: "CloudEvent 전달",
    EVENT_RECEIVED: "Event 수신",
    DUPLICATE_EVENT_IGNORED: "중복 Event 무시",
    VALIDATION_COMPLETED: "검증 완료",
    QUEUED: "Queue 등록",
    CAPACITY_RESERVED: "Capacity Slot 확보",
    CAPACITY_RELEASED: "Capacity Slot 반환",
    WORKFLOW_STARTED: "Workflow 실행 시작",
    PIPELINE_SUBMITTED: "PipelineJob 생성 요청",
    PIPELINE_STARTED: "Pipeline 시작",
    TASK_PREPROCESS_STARTED: "Preprocess 시작",
    TASK_PREPROCESS_COMPLETED: "Preprocess 완료",
    TASK_PREPROCESS_FAILED: "Preprocess 실패",
    TASK_INTENT_EVAL_STARTED: "Intent Eval 시작",
    TASK_INTENT_EVAL_COMPLETED: "Intent Eval 완료",
    TASK_INTENT_EVAL_FAILED: "Intent Eval 실패",
    TASK_RESPONSE_EVAL_STARTED: "Response Eval 시작",
    TASK_RESPONSE_EVAL_COMPLETED: "Response Eval 완료",
    TASK_RESPONSE_EVAL_FAILED: "Response Eval 실패",
    TASK_LATENCY_CHECK_STARTED: "Latency Check 시작",
    TASK_LATENCY_CHECK_COMPLETED: "Latency Check 완료",
    TASK_LATENCY_CHECK_FAILED: "Latency Check 실패",
    TASK_EVALUATION_COMPLETED: "Agent 평가 단계 완료",
    TASK_AGGREGATION_STARTED: "Aggregate 시작",
    TASK_AGGREGATION_COMPLETED: "Aggregate 완료",
    TASK_AGGREGATION_FAILED: "Aggregate 실패",
    TASK_PERSIST_STARTED: "Persist 시작",
    TASK_PERSIST_COMPLETED: "Persist 완료",
    TASK_PERSIST_FAILED: "Persist 실패",
    PIPELINE_SUCCEEDED: "Pipeline 성공",
    PIPELINE_FAILED: "Pipeline 실패",
    PIPELINE_TIMEOUT: "Pipeline 실행 시간 초과",
    PIPELINE_CANCEL_CONFIRMED: "Pipeline 종료 확인",
    RESULT_COMMITTED: "결과 CSV 업로드",
    BIGQUERY_COMMITTED: "BigQuery Commit",
    WORKFLOW_COMPLETED: "완료 Event 발행",
    RETRY_SCHEDULED: "Retry 예약",
    RETRY_STARTED: "Retry 시작",
    DEAD_LETTER_PUBLISHED: "DLQ 발행",
    REPLAY_REQUESTED: "Replay 요청",
    REPLAY_APPROVED: "Replay 승인",
    DEAD_LETTER_CLOSED: "DLQ 종료 처리",
    CANCEL_REQUESTED: "취소 요청",
    WORKFLOW_CANCELLED: "Workflow 취소",
    WORKFLOW_TIMED_OUT: "Workflow 시간 초과",
    CONFIG_UPDATED: "운영 설정 변경",
    SLOT_RECONCILED: "Slot 정합성 복구",
  },
  /** Bixby Capsules (CAPSULES[].id) */
  capsules: {
    weather: "날씨",
    alarm_timer: "알람·타이머",
    music: "음악",
    device_control: "기기 제어 (SmartThings)",
    call_message: "전화·메시지",
    calendar: "캘린더",
    navigation: "길찾기",
    settings: "설정",
    general_qa: "일반 Q&A",
  },
  /** DEVICES — product names, English in every locale */
  devices: {
    "Galaxy S26": "Galaxy S26",
    "Galaxy Watch": "Galaxy Watch",
    "Galaxy Buds": "Galaxy Buds",
    TV: "TV",
    "Family Hub": "Family Hub",
  },
  /** evaluation languages (LangCode) — the language name in the UI locale */
  languages: {
    ko: "한국어",
    en: "영어",
    ja: "일본어",
    es: "스페인어",
  },
};

export default catalog;
