/**
 * Static catalog — isomorphic (safe to import from client AND server components; no fetch needed).
 * Generated from the mock engine's initial state (same values as designs/mock-data.js).
 * Live/mutable values (capacity limits, paused flags, config) must come from the API instead.
 */
import type {
  AttemptStatus, Capsule, DagTemplateNode, DlqStatus, EventCatalogEntry, FailureCategory,
  FailureCategoryMetaEntry, FailureReason, FailureReasonMetaEntry, LangCode, LanguageConfig, MetaEntry,
  NodeStatus, Operator, ResultColumn, RolePermission, Severity, SeverityMetaEntry, Stage, StageEdge, StageId,
  StatusMetaEntry, Tone, WorkflowStatus,
} from "./types";

/** 2026-11-12T14:30:00+09:00 — simulator virtual clock starts here. */
export const BASE_NOW = 1794461400000;
export const TIMEZONE = "Asia/Seoul";
export const PROJECT_ID = "bixby-eval-prod";
export const PROJECT_NUMBER = "418027761953";
export const REGION = "asia-northeast3";
export const BUCKETS = {
  "input": "bixby-utterance-input",
  "artifacts": "bixby-pipeline-artifacts",
  "results": "bixby-eval-results"
} as const;
export const BIGQUERY = {
  "dataset": "bixby-eval-prod.bixby_eval",
  "resultsTable": "bixby-eval-prod.bixby_eval.utterance_results",
  "eventsTable": "bixby-eval-prod.aipo_ops.workflow_events"
} as const;
export const PIPELINE_VERSIONS = [
  "v1.0",
  "v1.1",
  "v1.2-rc"
];
export const DEFAULT_PIPELINE_VERSION = "v1.1";

export const LANG_CODES: LangCode[] = [
  "ko",
  "en",
  "ja",
  "es"
];
/** Initial language config (static defaults). Live values: GET /api/v1/languages/capacity. */
export const LANGUAGES: LanguageConfig[] = [
  {
    "code": "ko",
    "name": "한국어",
    "nameEn": "Korean",
    "locale": "ko-KR",
    "flag": "KR",
    "maxConcurrent": 10,
    "batchSize": 100,
    "priorityWeight": 3,
    "maxStartsPerMinute": 4,
    "enabled": true,
    "paused": false,
    "backlogAlertThreshold": 8,
    "p95WaitSloSec": 900
  },
  {
    "code": "en",
    "name": "영어",
    "nameEn": "English",
    "locale": "en-US",
    "flag": "US",
    "maxConcurrent": 25,
    "batchSize": 200,
    "priorityWeight": 5,
    "maxStartsPerMinute": 8,
    "enabled": true,
    "paused": false,
    "backlogAlertThreshold": 20,
    "p95WaitSloSec": 600
  },
  {
    "code": "ja",
    "name": "일본어",
    "nameEn": "Japanese",
    "locale": "ja-JP",
    "flag": "JP",
    "maxConcurrent": 5,
    "batchSize": 50,
    "priorityWeight": 2,
    "maxStartsPerMinute": 2,
    "enabled": true,
    "paused": false,
    "backlogAlertThreshold": 6,
    "p95WaitSloSec": 900
  },
  {
    "code": "es",
    "name": "스페인어",
    "nameEn": "Spanish",
    "locale": "es-ES",
    "flag": "ES",
    "maxConcurrent": 4,
    "batchSize": 50,
    "priorityWeight": 1,
    "maxStartsPerMinute": 2,
    "enabled": true,
    "paused": false,
    "backlogAlertThreshold": 5,
    "p95WaitSloSec": 1200
  }
];
export const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l])) as Record<LangCode, LanguageConfig>;

export const OPERATORS: Operator[] = [
  {
    "id": "op-kim-sy",
    "name": "김서연",
    "email": "seoyeon.kim@bixby-eval.example",
    "role": "Admin",
    "team": "Platform Eng",
    "lastActiveAt": 1794461040000
  },
  {
    "id": "op-han-dy",
    "name": "한도윤",
    "email": "doyoon.han@bixby-eval.example",
    "role": "Admin",
    "team": "Platform Eng",
    "lastActiveAt": 1794454200000
  },
  {
    "id": "op-park-jh",
    "name": "박지훈",
    "email": "jihoon.park@bixby-eval.example",
    "role": "Operator",
    "team": "Eval Ops",
    "lastActiveAt": 1794461220000
  },
  {
    "id": "op-lee-he",
    "name": "이하은",
    "email": "haeun.lee@bixby-eval.example",
    "role": "Operator",
    "team": "Eval Ops",
    "lastActiveAt": 1794458940000
  },
  {
    "id": "op-jung-yn",
    "name": "정유나",
    "email": "yuna.jung@bixby-eval.example",
    "role": "Operator",
    "team": "NLU Quality",
    "lastActiveAt": 1794375000000
  },
  {
    "id": "op-choi-mj",
    "name": "최민준",
    "email": "minjun.choi@bixby-eval.example",
    "role": "Viewer",
    "team": "NLU Quality",
    "lastActiveAt": 1794443400000
  },
  {
    "id": "op-sato-k",
    "name": "Kenji Sato",
    "email": "kenji.sato@bixby-eval.example",
    "role": "Viewer",
    "team": "JA Locale",
    "lastActiveAt": 1794202200000
  }
];
export const DEFAULT_OPERATOR_ID = "op-kim-sy";
export const ROLE_PERMISSIONS: RolePermission[] = [
  {
    "permission": "대시보드·로그 조회",
    "key": "read",
    "Viewer": true,
    "Operator": true,
    "Admin": true
  },
  {
    "permission": "결과 CSV 다운로드",
    "key": "export",
    "Viewer": true,
    "Operator": true,
    "Admin": true
  },
  {
    "permission": "Workflow 취소",
    "key": "cancel",
    "Viewer": false,
    "Operator": true,
    "Admin": true
  },
  {
    "permission": "DLQ Replay 요청",
    "key": "replay.request",
    "Viewer": false,
    "Operator": true,
    "Admin": true
  },
  {
    "permission": "DLQ Replay 승인",
    "key": "replay.approve",
    "Viewer": false,
    "Operator": false,
    "Admin": true
  },
  {
    "permission": "언어 일시 중지/재개",
    "key": "language.pause",
    "Viewer": false,
    "Operator": true,
    "Admin": true
  },
  {
    "permission": "Capacity·Retry·Timeout 변경",
    "key": "config.write",
    "Viewer": false,
    "Operator": false,
    "Admin": true
  },
  {
    "permission": "Pipeline 버전 승격",
    "key": "version.promote",
    "Viewer": false,
    "Operator": false,
    "Admin": true
  },
  {
    "permission": "운영자 권한 관리",
    "key": "iam",
    "Viewer": false,
    "Operator": false,
    "Admin": true
  }
];

export const STAGES: Stage[] = [
  {
    "id": "gcs_input",
    "order": 1,
    "kind": "main",
    "label": {
      "ko": "실발화 입력 업로드",
      "en": "GCS Input"
    },
    "gcpService": "Cloud Storage",
    "resource": "gs://bixby-utterance-input",
    "trigger": "google.cloud.storage.object.v1.finalized",
    "icon": "upload-cloud",
    "states": [],
    "services": [
      "cloud-storage"
    ],
    "description": "언어별로 배치된 실발화 JSONL이 gs://bixby-utterance-input/{date}/{lang}/batch-NNNN.jsonl 로 업로드되면 Object Finalized 이벤트가 발생한다."
  },
  {
    "id": "event_bus",
    "order": 2,
    "kind": "main",
    "label": {
      "ko": "이벤트 전달",
      "en": "Eventarc / Pub/Sub"
    },
    "gcpService": "Eventarc · Pub/Sub",
    "resource": "projects/bixby-eval-prod/topics/pipeline-batch-requested",
    "icon": "radio",
    "states": [],
    "services": [
      "eventarc",
      "pubsub"
    ],
    "description": "Eventarc 트리거가 GCS 이벤트를 CloudEvent로 감싸 Pub/Sub를 통해 비동기로 Event Ingress에 전달한다 (at-least-once)."
  },
  {
    "id": "ingress",
    "order": 3,
    "kind": "main",
    "label": {
      "ko": "이벤트 수신·검증",
      "en": "Cloud Run Event Ingress"
    },
    "gcpService": "Cloud Run",
    "resource": "event-ingress",
    "icon": "shield-check",
    "states": [
      "RECEIVED",
      "VALIDATED"
    ],
    "services": [
      "event-ingress"
    ],
    "description": "스키마 검증, 중복 제거, SHA256 Idempotency Key 계산 후 Firestore에 이벤트와 Workflow를 등록한다."
  },
  {
    "id": "registry_queue",
    "order": 4,
    "kind": "main",
    "label": {
      "ko": "등록·언어별 대기열",
      "en": "Firestore Registry & Pending Queue"
    },
    "gcpService": "Firestore",
    "resource": "pending_jobs/{lang}",
    "icon": "list-ordered",
    "states": [
      "QUEUED"
    ],
    "services": [
      "firestore"
    ],
    "description": "Event Registry · Workflow State · 언어별 Pending Queue. Priority → 대기시간 → FIFO 순으로 정렬된다."
  },
  {
    "id": "scheduler",
    "order": 5,
    "kind": "main",
    "label": {
      "ko": "언어별 스케줄러",
      "en": "Language-aware Scheduler"
    },
    "gcpService": "Cloud Run + Firestore Transaction",
    "resource": "scheduler",
    "icon": "gauge",
    "states": [
      "RESERVED"
    ],
    "services": [
      "scheduler"
    ],
    "description": "language_active < language_limit AND global_active < global_limit 일 때 Slot Reservation(fencing token)을 발급한다."
  },
  {
    "id": "workflows",
    "order": 6,
    "kind": "main",
    "label": {
      "ko": "워크플로 오케스트레이션",
      "en": "Cloud Workflows"
    },
    "gcpService": "Cloud Workflows",
    "resource": "pipeline-orchestrator",
    "icon": "workflow",
    "states": [
      "DISPATCHING",
      "CANCELLED",
      "TIMED_OUT"
    ],
    "services": [
      "dispatcher",
      "pipeline-orchestrator"
    ],
    "description": "PipelineJob 생성({workflow_id}-cycle-{c}-attempt-{a}), 완료 모니터링, 오류 분류, 취소/Timeout 처리, 최종 실패 라우팅."
  },
  {
    "id": "vertex",
    "order": 7,
    "kind": "main",
    "label": {
      "ko": "평가 파이프라인",
      "en": "Vertex AI Pipeline"
    },
    "gcpService": "Vertex AI Pipelines",
    "resource": "bixby-eval pipeline",
    "icon": "cpu",
    "states": [
      "RUNNING"
    ],
    "services": [
      "vertex-ai-pipelines"
    ],
    "components": [
      "preprocess",
      "intent_eval",
      "response_eval",
      "latency_check",
      "aggregate",
      "persist"
    ],
    "description": "Preprocessing → Agent Evaluation(의도·응답(LLM Judge)·지연) → Result Aggregation → Output Persistence."
  },
  {
    "id": "results",
    "order": 8,
    "kind": "main",
    "label": {
      "ko": "결과 저장",
      "en": "Result CSV + BigQuery"
    },
    "gcpService": "Cloud Storage · BigQuery",
    "resource": "gs://bixby-eval-results · bixby-eval-prod.bixby_eval.utterance_results",
    "icon": "file-check",
    "states": [
      "SUCCEEDED"
    ],
    "services": [
      "result-commit"
    ],
    "description": "발화별 PASS/FAIL 결과 CSV를 GCS에 업로드하고 BigQuery에 Commit한 뒤 완료 이벤트를 발행한다."
  },
  {
    "id": "retry",
    "order": 9,
    "kind": "branch",
    "branchFrom": "vertex",
    "returnsTo": "vertex",
    "label": {
      "ko": "재시도 제어",
      "en": "Retry Controller"
    },
    "gcpService": "Cloud Workflows",
    "resource": "pipeline-orchestrator (retry policy)",
    "icon": "rotate-ccw",
    "states": [
      "RETRY_WAIT"
    ],
    "services": [
      "pipeline-orchestrator"
    ],
    "description": "Attempts < 3 이고 재시도 가능한 오류면 Backoff(60s → 300s) 후 Admission을 다시 거쳐 재실행한다."
  },
  {
    "id": "dlq",
    "order": 10,
    "kind": "branch",
    "branchFrom": "retry",
    "returnsTo": "registry_queue",
    "label": {
      "ko": "DLQ·수동 Replay",
      "en": "DLQ Manager / Replay"
    },
    "gcpService": "Pub/Sub · Cloud Run",
    "resource": "projects/bixby-eval-prod/topics/pipeline-dead-letter",
    "icon": "archive-x",
    "states": [
      "DEAD_LETTERED"
    ],
    "services": [
      "dlq-manager"
    ],
    "description": "최종 실패 및 비복구성 오류를 격리하고, 운영자 검토 후 새 Replay Cycle로 대기열에 재등록한다."
  }
];
export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, Stage>;
export const STAGE_EDGES: StageEdge[] = [
  {
    "from": "gcs_input",
    "to": "event_bus",
    "label": "Object Finalized"
  },
  {
    "from": "event_bus",
    "to": "ingress",
    "label": "CloudEvent push"
  },
  {
    "from": "ingress",
    "to": "registry_queue",
    "label": "register + enqueue"
  },
  {
    "from": "registry_queue",
    "to": "scheduler",
    "label": "admission"
  },
  {
    "from": "scheduler",
    "to": "workflows",
    "label": "slot reserved"
  },
  {
    "from": "workflows",
    "to": "vertex",
    "label": "create PipelineJob"
  },
  {
    "from": "vertex",
    "to": "results",
    "label": "SUCCESS",
    "tone": "success"
  },
  {
    "from": "vertex",
    "to": "retry",
    "label": "FAILURE",
    "tone": "failed"
  },
  {
    "from": "retry",
    "to": "vertex",
    "label": "attempts < 3",
    "tone": "retry"
  },
  {
    "from": "retry",
    "to": "dlq",
    "label": "attempts = 3 / non-retryable",
    "tone": "dlq"
  },
  {
    "from": "dlq",
    "to": "registry_queue",
    "label": "Manual Replay",
    "tone": "retry",
    "dashed": true
  }
];
export const STATE_TO_STAGE: Record<WorkflowStatus, StageId> = {
  "RECEIVED": "ingress",
  "VALIDATED": "ingress",
  "QUEUED": "registry_queue",
  "RESERVED": "scheduler",
  "DISPATCHING": "workflows",
  "RUNNING": "vertex",
  "RETRY_WAIT": "retry",
  "SUCCEEDED": "results",
  "DEAD_LETTERED": "dlq",
  "CANCELLED": "workflows",
  "TIMED_OUT": "workflows"
};
export const STATES: WorkflowStatus[] = [
  "RECEIVED",
  "VALIDATED",
  "QUEUED",
  "RESERVED",
  "DISPATCHING",
  "RUNNING",
  "RETRY_WAIT",
  "SUCCEEDED",
  "DEAD_LETTERED",
  "CANCELLED",
  "TIMED_OUT"
];
export const ACTIVE_STATES: WorkflowStatus[] = [
  "RESERVED",
  "DISPATCHING",
  "RUNNING"
];
export const TERMINAL_STATES: WorkflowStatus[] = [
  "SUCCEEDED",
  "DEAD_LETTERED",
  "CANCELLED",
  "TIMED_OUT"
];

export const DAG_TEMPLATE: DagTemplateNode[] = [
  {
    "id": "preprocess",
    "label": "Preprocess",
    "labelKo": "전처리",
    "ev": "PREPROCESS",
    "deps": [],
    "f": [
      0.06,
      0.17
    ],
    "machineType": "n2-standard-4",
    "cpu": 4,
    "gpu": null,
    "memGb": 16,
    "image": "components/preprocess",
    "description": "JSONL 파싱, 스키마 검증, 정규화, PII 마스킹, capsule 힌트 매핑"
  },
  {
    "id": "intent_eval",
    "label": "Intent Eval",
    "labelKo": "의도 평가",
    "ev": "INTENT_EVAL",
    "deps": [
      "preprocess"
    ],
    "f": [
      0.17,
      0.5
    ],
    "machineType": "n2-standard-8",
    "cpu": 8,
    "gpu": null,
    "memGb": 32,
    "image": "components/intent-eval",
    "description": "Bixby Agent에 발화를 재생하여 intent/slot 예측과 기대값 비교"
  },
  {
    "id": "response_eval",
    "label": "Response Eval (LLM Judge)",
    "labelKo": "응답 평가 (LLM Judge)",
    "ev": "RESPONSE_EVAL",
    "deps": [
      "preprocess"
    ],
    "f": [
      0.17,
      0.8
    ],
    "machineType": "g2-standard-8",
    "cpu": 8,
    "gpu": {
      "type": "NVIDIA_L4",
      "count": 1
    },
    "memGb": 32,
    "image": "components/response-eval",
    "description": "LLM Judge가 기대 응답 대비 실제 응답의 정확성·유용성·정책 준수를 0~1로 채점"
  },
  {
    "id": "latency_check",
    "label": "Latency Check",
    "labelKo": "지연 측정",
    "ev": "LATENCY_CHECK",
    "deps": [
      "preprocess"
    ],
    "f": [
      0.17,
      0.34
    ],
    "machineType": "e2-standard-4",
    "cpu": 4,
    "gpu": null,
    "memGb": 16,
    "image": "components/latency-check",
    "description": "발화별 end-to-end 응답 지연 측정 및 8,000ms 초과 판정"
  },
  {
    "id": "aggregate",
    "label": "Aggregate",
    "labelKo": "결과 집계",
    "ev": "AGGREGATION",
    "deps": [
      "intent_eval",
      "response_eval",
      "latency_check"
    ],
    "f": [
      0.8,
      0.91
    ],
    "machineType": "n2-standard-4",
    "cpu": 4,
    "gpu": null,
    "memGb": 16,
    "image": "components/aggregate",
    "description": "발화별 PASS/FAIL 판정, failure_reason 분류, capsule/디바이스별 요약"
  },
  {
    "id": "persist",
    "label": "Persist",
    "labelKo": "결과 저장",
    "ev": "PERSIST",
    "deps": [
      "aggregate"
    ],
    "f": [
      0.91,
      0.98
    ],
    "machineType": "e2-standard-2",
    "cpu": 2,
    "gpu": null,
    "memGb": 8,
    "image": "components/persist",
    "description": "results.csv를 GCS에 업로드하고 BigQuery utterance_results에 적재"
  }
];

export const STATUS_META: Record<WorkflowStatus, StatusMetaEntry> = {
  "RECEIVED": {
    "label": "수신됨",
    "labelEn": "Received",
    "tone": "queued",
    "icon": "inbox",
    "terminal": false,
    "order": 1
  },
  "VALIDATED": {
    "label": "검증 완료",
    "labelEn": "Validated",
    "tone": "queued",
    "icon": "shield-check",
    "terminal": false,
    "order": 2
  },
  "QUEUED": {
    "label": "대기 중",
    "labelEn": "Queued",
    "tone": "queued",
    "icon": "clock",
    "terminal": false,
    "order": 3
  },
  "RESERVED": {
    "label": "슬롯 확보",
    "labelEn": "Reserved",
    "tone": "queued",
    "icon": "lock",
    "terminal": false,
    "order": 4
  },
  "DISPATCHING": {
    "label": "실행 요청 중",
    "labelEn": "Dispatching",
    "tone": "running",
    "icon": "send",
    "terminal": false,
    "order": 5
  },
  "RUNNING": {
    "label": "실행 중",
    "labelEn": "Running",
    "tone": "running",
    "icon": "loader",
    "terminal": false,
    "order": 6
  },
  "RETRY_WAIT": {
    "label": "재시도 대기",
    "labelEn": "Retry wait",
    "tone": "retry",
    "icon": "rotate-ccw",
    "terminal": false,
    "order": 7
  },
  "SUCCEEDED": {
    "label": "성공",
    "labelEn": "Succeeded",
    "tone": "success",
    "icon": "check-circle",
    "terminal": true,
    "order": 8
  },
  "DEAD_LETTERED": {
    "label": "DLQ 격리",
    "labelEn": "Dead-lettered",
    "tone": "dlq",
    "icon": "archive-x",
    "terminal": true,
    "order": 9
  },
  "CANCELLED": {
    "label": "취소됨",
    "labelEn": "Cancelled",
    "tone": "cancelled",
    "icon": "x-circle",
    "terminal": true,
    "order": 10
  },
  "TIMED_OUT": {
    "label": "시간 초과",
    "labelEn": "Timed out",
    "tone": "failed",
    "icon": "timer-off",
    "terminal": true,
    "order": 11
  }
};
export const NODE_STATUS_META: Record<NodeStatus, MetaEntry> = {
  "PENDING": {
    "label": "대기",
    "tone": "queued",
    "icon": "circle-dashed"
  },
  "RUNNING": {
    "label": "실행 중",
    "tone": "running",
    "icon": "loader"
  },
  "SUCCEEDED": {
    "label": "성공",
    "tone": "success",
    "icon": "check-circle"
  },
  "FAILED": {
    "label": "실패",
    "tone": "failed",
    "icon": "x-octagon"
  },
  "SKIPPED": {
    "label": "스킵",
    "tone": "cancelled",
    "icon": "skip-forward"
  },
  "CANCELLED": {
    "label": "취소",
    "tone": "cancelled",
    "icon": "ban"
  }
};
export const ATTEMPT_STATUS_META: Record<AttemptStatus, MetaEntry> = {
  "DISPATCHING": {
    "label": "생성 중",
    "tone": "running",
    "icon": "send"
  },
  "RUNNING": {
    "label": "실행 중",
    "tone": "running",
    "icon": "loader"
  },
  "SUCCEEDED": {
    "label": "성공",
    "tone": "success",
    "icon": "check-circle"
  },
  "FAILED": {
    "label": "실패",
    "tone": "failed",
    "icon": "x-octagon"
  },
  "TIMED_OUT": {
    "label": "시간 초과",
    "tone": "failed",
    "icon": "timer-off"
  },
  "CANCELLED": {
    "label": "취소",
    "tone": "cancelled",
    "icon": "ban"
  }
};
export const DLQ_STATUS_META: Record<DlqStatus, MetaEntry> = {
  "PENDING_REVIEW": {
    "label": "검토 대기",
    "tone": "dlq",
    "icon": "eye"
  },
  "APPROVED": {
    "label": "Replay 승인",
    "tone": "queued",
    "icon": "check"
  },
  "REPLAYING": {
    "label": "Replay 중",
    "tone": "running",
    "icon": "refresh-cw"
  },
  "REPLAYED": {
    "label": "Replay 완료",
    "tone": "success",
    "icon": "check-circle"
  },
  "CLOSED": {
    "label": "종료 처리",
    "tone": "cancelled",
    "icon": "archive"
  }
};
export const SEVERITY_META: Record<Severity, SeverityMetaEntry> = {
  "DEBUG": {
    "label": "DEBUG",
    "tone": "cancelled"
  },
  "INFO": {
    "label": "INFO",
    "tone": "queued"
  },
  "NOTICE": {
    "label": "NOTICE",
    "tone": "queued"
  },
  "WARNING": {
    "label": "WARNING",
    "tone": "retry"
  },
  "ERROR": {
    "label": "ERROR",
    "tone": "failed"
  },
  "CRITICAL": {
    "label": "CRITICAL",
    "tone": "dlq"
  }
};
export const FAILURE_CATEGORY_META: Record<FailureCategory, FailureCategoryMetaEntry> = {
  "PIPELINE_EXECUTION": {
    "label": "Pipeline 실행 오류",
    "policy": "Retry",
    "retryable": true,
    "icon": "alert-triangle"
  },
  "MODEL_TRANSIENT": {
    "label": "모델 일시적 오류",
    "policy": "정책에 따라 Retry",
    "retryable": true,
    "icon": "cloud-lightning"
  },
  "QUOTA": {
    "label": "Vertex AI 할당량",
    "policy": "Backoff 후 Retry",
    "retryable": true,
    "icon": "battery-warning"
  },
  "TIMEOUT": {
    "label": "실행 시간 초과",
    "policy": "취소 확인 후 Retry 여부 판정",
    "retryable": true,
    "icon": "timer-off"
  },
  "INPUT_SCHEMA": {
    "label": "입력 스키마 오류",
    "policy": "즉시 DLQ",
    "retryable": false,
    "icon": "file-warning"
  },
  "AUTH_PERMISSION": {
    "label": "인증·권한 오류",
    "policy": "재시도 중단, 운영자 알림",
    "retryable": false,
    "icon": "key-round"
  },
  "CODE_DEFECT": {
    "label": "Pipeline 코드 결함",
    "policy": "제한적 Retry (1회)",
    "retryable": true,
    "maxRetries": 1,
    "icon": "bug"
  }
};
export const FAILURE_REASON_META: Record<FailureReason, FailureReasonMetaEntry> = {
  "INTENT_MISMATCH": {
    "label": "의도 불일치",
    "tone": "failed"
  },
  "SLOT_ERROR": {
    "label": "Slot 오류",
    "tone": "failed"
  },
  "RESPONSE_QUALITY": {
    "label": "응답 품질",
    "tone": "retry"
  },
  "TIMEOUT": {
    "label": "응답 시간 초과",
    "tone": "retry"
  },
  "ASR_ERROR": {
    "label": "ASR 인식 오류",
    "tone": "queued"
  },
  "POLICY_VIOLATION": {
    "label": "정책 위반",
    "tone": "dlq"
  }
};
export const EVENT_CATALOG: Record<string, EventCatalogEntry> = {
  "GCS_OBJECT_FINALIZED": {
    "stage": "gcs_input",
    "source": "cloud-storage",
    "label": "GCS 객체 업로드 완료"
  },
  "EVENT_PUBLISHED": {
    "stage": "event_bus",
    "source": "eventarc",
    "label": "CloudEvent 전달"
  },
  "EVENT_RECEIVED": {
    "stage": "ingress",
    "source": "event-ingress",
    "label": "이벤트 수신"
  },
  "DUPLICATE_EVENT_IGNORED": {
    "stage": "ingress",
    "source": "event-ingress",
    "label": "중복 이벤트 무시"
  },
  "VALIDATION_COMPLETED": {
    "stage": "ingress",
    "source": "event-ingress",
    "label": "검증 완료"
  },
  "QUEUED": {
    "stage": "registry_queue",
    "source": "scheduler",
    "label": "대기열 등록"
  },
  "CAPACITY_RESERVED": {
    "stage": "scheduler",
    "source": "scheduler",
    "label": "Capacity Slot 확보"
  },
  "CAPACITY_RELEASED": {
    "stage": "scheduler",
    "source": "scheduler",
    "label": "Capacity Slot 반환"
  },
  "WORKFLOW_STARTED": {
    "stage": "workflows",
    "source": "cloud-workflows",
    "label": "Workflow 실행 시작"
  },
  "PIPELINE_SUBMITTED": {
    "stage": "workflows",
    "source": "dispatcher",
    "label": "PipelineJob 생성 요청"
  },
  "PIPELINE_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "Pipeline 시작"
  },
  "TASK_PREPROCESS_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "전처리 시작"
  },
  "TASK_PREPROCESS_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "전처리 완료"
  },
  "TASK_PREPROCESS_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "전처리 실패"
  },
  "TASK_INTENT_EVAL_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "의도 평가 시작"
  },
  "TASK_INTENT_EVAL_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "의도 평가 완료"
  },
  "TASK_INTENT_EVAL_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "의도 평가 실패"
  },
  "TASK_RESPONSE_EVAL_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "응답 평가 시작"
  },
  "TASK_RESPONSE_EVAL_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "응답 평가 완료"
  },
  "TASK_RESPONSE_EVAL_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "응답 평가 실패"
  },
  "TASK_LATENCY_CHECK_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "지연 측정 시작"
  },
  "TASK_LATENCY_CHECK_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "지연 측정 완료"
  },
  "TASK_LATENCY_CHECK_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "지연 측정 실패"
  },
  "TASK_EVALUATION_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "Agent 평가 단계 완료"
  },
  "TASK_AGGREGATION_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "집계 시작"
  },
  "TASK_AGGREGATION_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "집계 완료"
  },
  "TASK_AGGREGATION_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "집계 실패"
  },
  "TASK_PERSIST_STARTED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "결과 저장 시작"
  },
  "TASK_PERSIST_COMPLETED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "결과 저장 완료"
  },
  "TASK_PERSIST_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "결과 저장 실패"
  },
  "PIPELINE_SUCCEEDED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "Pipeline 성공"
  },
  "PIPELINE_FAILED": {
    "stage": "vertex",
    "source": "vertex-ai",
    "label": "Pipeline 실패"
  },
  "PIPELINE_TIMEOUT": {
    "stage": "workflows",
    "source": "cloud-workflows",
    "label": "Pipeline 실행 시간 초과"
  },
  "PIPELINE_CANCEL_CONFIRMED": {
    "stage": "workflows",
    "source": "cloud-workflows",
    "label": "Pipeline 종료 확인"
  },
  "RESULT_COMMITTED": {
    "stage": "results",
    "source": "result-commit",
    "label": "결과 CSV 업로드"
  },
  "BIGQUERY_COMMITTED": {
    "stage": "results",
    "source": "result-commit",
    "label": "BigQuery Commit"
  },
  "WORKFLOW_COMPLETED": {
    "stage": "results",
    "source": "cloud-workflows",
    "label": "완료 이벤트 발행"
  },
  "RETRY_SCHEDULED": {
    "stage": "retry",
    "source": "cloud-workflows",
    "label": "재시도 예약"
  },
  "RETRY_STARTED": {
    "stage": "retry",
    "source": "cloud-workflows",
    "label": "재시도 시작"
  },
  "DEAD_LETTER_PUBLISHED": {
    "stage": "dlq",
    "source": "dlq-manager",
    "label": "DLQ 발행"
  },
  "REPLAY_REQUESTED": {
    "stage": "dlq",
    "source": "operations-api",
    "label": "Replay 요청"
  },
  "REPLAY_APPROVED": {
    "stage": "dlq",
    "source": "operations-api",
    "label": "Replay 승인"
  },
  "DEAD_LETTER_CLOSED": {
    "stage": "dlq",
    "source": "operations-api",
    "label": "DLQ 종료 처리"
  },
  "CANCEL_REQUESTED": {
    "stage": "workflows",
    "source": "operations-api",
    "label": "취소 요청"
  },
  "WORKFLOW_CANCELLED": {
    "stage": "workflows",
    "source": "cloud-workflows",
    "label": "Workflow 취소"
  },
  "WORKFLOW_TIMED_OUT": {
    "stage": "workflows",
    "source": "cloud-workflows",
    "label": "Workflow 시간 초과"
  },
  "CONFIG_UPDATED": {
    "stage": "scheduler",
    "source": "operations-api",
    "label": "운영 설정 변경"
  },
  "SLOT_RECONCILED": {
    "stage": "scheduler",
    "source": "reconciler",
    "label": "Slot 정합성 복구"
  }
};

export const CAPSULES: Capsule[] = [
  {
    "id": "weather",
    "label": "날씨",
    "labelEn": "Weather",
    "weight": 14,
    "adj": 0.05,
    "confuse": "calendar"
  },
  {
    "id": "alarm_timer",
    "label": "알람·타이머",
    "labelEn": "Alarm & Timer",
    "weight": 13,
    "adj": 0.06,
    "confuse": "calendar"
  },
  {
    "id": "music",
    "label": "음악",
    "labelEn": "Music",
    "weight": 14,
    "adj": 0,
    "confuse": "general_qa"
  },
  {
    "id": "device_control",
    "label": "기기제어(SmartThings)",
    "labelEn": "Device Control (SmartThings)",
    "weight": 12,
    "adj": -0.04,
    "confuse": "settings"
  },
  {
    "id": "call_message",
    "label": "전화·메시지",
    "labelEn": "Call & Message",
    "weight": 11,
    "adj": -0.02,
    "confuse": "calendar"
  },
  {
    "id": "calendar",
    "label": "캘린더",
    "labelEn": "Calendar",
    "weight": 9,
    "adj": 0,
    "confuse": "alarm_timer"
  },
  {
    "id": "navigation",
    "label": "길찾기",
    "labelEn": "Navigation",
    "weight": 9,
    "adj": -0.03,
    "confuse": "general_qa"
  },
  {
    "id": "settings",
    "label": "설정",
    "labelEn": "Settings",
    "weight": 8,
    "adj": 0.02,
    "confuse": "device_control"
  },
  {
    "id": "general_qa",
    "label": "일반 Q&A",
    "labelEn": "General Q&A",
    "weight": 10,
    "adj": -0.07,
    "confuse": "music"
  }
];
export const CAPSULE_BY_ID = Object.fromEntries(CAPSULES.map((c) => [c.id, c])) as Record<string, Capsule>;
export const DEVICES: string[] = [
  "Galaxy S26",
  "Galaxy Watch",
  "Galaxy Buds",
  "TV",
  "Family Hub"
];
export const RESULT_COLUMNS: ResultColumn[] = [
  {
    "key": "utterance_id",
    "label": "utterance_id",
    "type": "string"
  },
  {
    "key": "workflow_id",
    "label": "workflow_id",
    "type": "string"
  },
  {
    "key": "batch_id",
    "label": "batch_id",
    "type": "string"
  },
  {
    "key": "pipeline_job_id",
    "label": "pipeline_job_id",
    "type": "string"
  },
  {
    "key": "language",
    "label": "language",
    "type": "enum"
  },
  {
    "key": "capsule",
    "label": "capsule",
    "type": "enum"
  },
  {
    "key": "capsule_id",
    "label": "capsule_id",
    "type": "enum"
  },
  {
    "key": "intent_expected",
    "label": "intent_expected",
    "type": "string"
  },
  {
    "key": "intent_predicted",
    "label": "intent_predicted",
    "type": "string"
  },
  {
    "key": "utterance_text",
    "label": "utterance_text",
    "type": "text"
  },
  {
    "key": "asr_text",
    "label": "asr_text",
    "type": "text"
  },
  {
    "key": "expected_response",
    "label": "expected_response",
    "type": "text"
  },
  {
    "key": "actual_response",
    "label": "actual_response",
    "type": "text"
  },
  {
    "key": "judge_score",
    "label": "judge_score",
    "type": "number"
  },
  {
    "key": "judge_reason",
    "label": "judge_reason",
    "type": "text"
  },
  {
    "key": "result",
    "label": "result",
    "type": "enum"
  },
  {
    "key": "failure_reason",
    "label": "failure_reason",
    "type": "enum"
  },
  {
    "key": "latency_ms",
    "label": "latency_ms",
    "type": "number"
  },
  {
    "key": "device_type",
    "label": "device_type",
    "type": "enum"
  },
  {
    "key": "model_version",
    "label": "model_version",
    "type": "string"
  },
  {
    "key": "pipeline_version",
    "label": "pipeline_version",
    "type": "enum"
  },
  {
    "key": "eval_timestamp",
    "label": "eval_timestamp",
    "type": "datetime"
  }
];

/** Standardized status tones (CSS tokens --st-<tone>). */
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
