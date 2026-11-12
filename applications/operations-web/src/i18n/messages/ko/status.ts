/**
 * status — every enum shown as a status/badge (ko is the schema for all locales).
 *
 * POLICY (docs/i18n.md §3): machine states are system terms → `label` is the English display name
 * in BOTH locales ("Running", "Dead-lettered"); `help` is the localized explanation (tooltip / legend).
 * Descriptive phrases (failure category / reason) are translated, keeping technical nouns in English.
 *
 * Consumers: statusInfo()/StatusPill (src/components/shared/status.tsx), legends, filters, CSV headers.
 * Keys are the raw enum values so `t(\`workflow.${status}.label\`)` type-checks for a WorkflowStatus.
 */
const status = {
  workflow: {
    RECEIVED: { label: "Received", help: "수신됨 · Event Ingress가 Event를 수신했습니다" },
    VALIDATED: { label: "Validated", help: "검증 완료 · 스키마 검증과 중복 제거를 통과했습니다" },
    QUEUED: { label: "Queued", help: "대기 중 · 언어별 Pending Queue에서 Slot을 기다리고 있습니다" },
    RESERVED: { label: "Reserved", help: "Slot 확보 · Scheduler가 Capacity Slot을 예약했습니다" },
    DISPATCHING: { label: "Dispatching", help: "실행 요청 중 · Cloud Workflows가 PipelineJob을 생성하고 있습니다" },
    RUNNING: { label: "Running", help: "실행 중 · Vertex AI Pipeline이 실행되고 있습니다" },
    RETRY_WAIT: { label: "Retry wait", help: "Retry 대기 · Backoff 후 Admission을 다시 거칩니다" },
    SUCCEEDED: { label: "Succeeded", help: "성공 · 결과 CSV 업로드와 BigQuery Commit이 완료되었습니다" },
    DEAD_LETTERED: { label: "Dead-lettered", help: "DLQ 격리 · 최종 실패로 DLQ에 격리되어 검토가 필요합니다" },
    CANCELLED: { label: "Cancelled", help: "취소됨 · 운영자 요청으로 취소되었습니다" },
    TIMED_OUT: { label: "Timed out", help: "시간 초과 · Workflow 제한 시간을 넘었습니다" },
  },
  node: {
    PENDING: { label: "Pending", help: "대기 · 선행 Task 완료를 기다리고 있습니다" },
    RUNNING: { label: "Running", help: "실행 중" },
    SUCCEEDED: { label: "Succeeded", help: "성공" },
    FAILED: { label: "Failed", help: "실패" },
    SKIPPED: { label: "Skipped", help: "건너뜀 · 선행 Task 실패 또는 취소로 실행하지 않았습니다" },
    CANCELLED: { label: "Cancelled", help: "취소" },
  },
  attempt: {
    DISPATCHING: { label: "Dispatching", help: "PipelineJob 생성 중" },
    RUNNING: { label: "Running", help: "실행 중" },
    SUCCEEDED: { label: "Succeeded", help: "성공" },
    FAILED: { label: "Failed", help: "실패" },
    TIMED_OUT: { label: "Timed out", help: "시간 초과" },
    CANCELLED: { label: "Cancelled", help: "취소" },
  },
  dlq: {
    PENDING_REVIEW: { label: "Pending review", help: "검토 대기 · 운영자 검토가 필요합니다" },
    APPROVED: { label: "Approved", help: "Replay 승인 · 대기열 재등록을 기다리고 있습니다" },
    REPLAYING: { label: "Replaying", help: "Replay 중 · 새 Replay Cycle이 실행되고 있습니다" },
    REPLAYED: { label: "Replayed", help: "Replay 완료" },
    CLOSED: { label: "Closed", help: "종료 처리 · Replay 없이 종료했습니다" },
  },
  replay: {
    APPROVED: { label: "Approved", help: "승인됨" },
    QUEUED: { label: "Queued", help: "대기 중" },
    RUNNING: { label: "Running", help: "실행 중" },
    SUCCEEDED: { label: "Succeeded", help: "성공" },
    FAILED: { label: "Failed", help: "실패" },
    CANCELLED: { label: "Cancelled", help: "취소" },
    SUPERSEDED: { label: "Superseded", help: "대체됨 · 더 최신 Replay로 대체되었습니다" },
  },
  reservation: {
    ACTIVE: { label: "Active", help: "사용 중인 Slot" },
    RELEASED: { label: "Released", help: "반환된 Slot" },
    ORPHANED: { label: "Orphaned", help: "고아 Slot · Reconciler가 회수합니다" },
  },
  alert: {
    OPEN: { label: "Open", help: "미확인" },
    ACKNOWLEDGED: { label: "Acknowledged", help: "확인됨 · 담당자가 확인했습니다" },
    RESOLVED: { label: "Resolved", help: "해소됨" },
  },
  severity: {
    DEBUG: { label: "DEBUG", help: "디버그" },
    INFO: { label: "INFO", help: "정보" },
    NOTICE: { label: "NOTICE", help: "알림" },
    WARNING: { label: "WARNING", help: "경고" },
    ERROR: { label: "ERROR", help: "오류" },
    CRITICAL: { label: "CRITICAL", help: "심각" },
  },
  capacity: {
    OK: { label: "OK", help: "정상" },
    SATURATED: { label: "Saturated", help: "포화 · 동시 실행 한도에 도달했습니다" },
    BACKLOGGED: { label: "Backlogged", help: "적체 · Backlog가 경보 임계치를 넘었습니다" },
    PAUSED: { label: "Paused", help: "일시정지 · 새 Workflow를 시작하지 않습니다" },
    DISABLED: { label: "Disabled", help: "비활성" },
  },
  service: {
    HEALTHY: { label: "Healthy", help: "정상" },
    DEGRADED: { label: "Degraded", help: "성능 저하" },
    DOWN: { label: "Down", help: "중단" },
    DISABLED: { label: "Disabled", help: "비활성" },
  },
  version: {
    DEPRECATED: { label: "Deprecated", help: "지원 종료 · 새 실행에 사용할 수 없습니다" },
    STABLE: { label: "Stable", help: "안정 버전" },
    CANARY: { label: "Canary", help: "Canary · 일부 트래픽에만 배포된 버전입니다" },
  },
  result: {
    PASS: { label: "PASS", help: "통과" },
    FAIL: { label: "FAIL", help: "실패" },
  },
  role: {
    Admin: { label: "Admin", help: "전체 권한 (설정 변경, 버전 승격 포함)" },
    Operator: { label: "Operator", help: "취소, Replay 요청, 언어 일시정지, 알림 처리" },
    Viewer: { label: "Viewer", help: "조회와 내보내기" },
  },
  failureCategory: {
    PIPELINE_EXECUTION: { label: "Pipeline 실행 오류", policy: "Retry" },
    MODEL_TRANSIENT: { label: "모델 일시적 오류", policy: "정책에 따라 Retry" },
    QUOTA: { label: "Vertex AI 할당량", policy: "Backoff 후 Retry" },
    TIMEOUT: { label: "실행 시간 초과", policy: "취소 확인 후 Retry 여부 판정" },
    INPUT_SCHEMA: { label: "입력 스키마 오류", policy: "즉시 DLQ" },
    AUTH_PERMISSION: { label: "인증·권한 오류", policy: "Retry 중단, 운영자 알림" },
    CODE_DEFECT: { label: "Pipeline 코드 결함", policy: "제한적 Retry (1회)" },
  },
  failureReason: {
    INTENT_MISMATCH: { label: "Intent 불일치" },
    SLOT_ERROR: { label: "Slot 오류" },
    RESPONSE_QUALITY: { label: "응답 품질" },
    TIMEOUT: { label: "응답 시간 초과" },
    ASR_ERROR: { label: "ASR 인식 오류" },
    POLICY_VIOLATION: { label: "정책 위반" },
  },
  /** standardized tone names (legends) */
  tone: {
    success: "성공",
    running: "실행",
    queued: "대기",
    retry: "Retry",
    failed: "실패",
    dlq: "DLQ",
    cancelled: "취소",
  },
  /** fallback when an enum value is unknown */
  unknown: "알 수 없음 ({value})",
};

export default status;
