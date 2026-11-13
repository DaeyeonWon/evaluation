/**
 * errors — API error messages (route handlers via getT("errors") / tFor(req, "errors")) and
 * client-side failure toasts. Keyed by meaning, not by HTTP status.
 *
 * - `code.*`     fallback text per ApiError code (used when a handler throws without a specific key)
 * - `validation.*` templates for src/server/http.ts Query/V helpers ({name}, {min}, {max}, {values}…)
 * - `domain.*`   specific service errors (src/server/services/**)
 * - `client.*`   browser-side failures (fetch/network)
 * Tone: full sentences ending in 합니다/주세요. Interpolated identifiers come after a colon so
 * Korean particles never depend on the value ("값이 올바르지 않습니다: {value}").
 */
const errors = {
  code: {
    INVALID_ARGUMENT: "요청 값이 올바르지 않습니다.",
    UNAUTHENTICATED: "로그인이 필요합니다.",
    FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
    NOT_FOUND: "요청한 항목을 찾을 수 없습니다.",
    CONFLICT: "현재 상태에서는 이 작업을 수행할 수 없습니다.",
    RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    INTERNAL: "서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  },
  validation: {
    enumInvalid: "{name} 값이 올바르지 않습니다: {values}",
    integer: "{name} 값은 정수여야 합니다.",
    number: "{name} 값은 숫자여야 합니다.",
    boolean: "{name} 값은 true/false 여야 합니다.",
    string: "{name} 값은 문자열이어야 합니다.",
    object: "{name} 값은 객체여야 합니다.",
    timestamp: "{name} 값은 epoch ms 또는 ISO-8601 시각이어야 합니다.",
    min: "{name} 값은 {min} 이상이어야 합니다.",
    max: "{name} 값은 {max} 이하여야 합니다.",
    range: "{name} 값은 {min}~{max} 범위여야 합니다.",
    maxLength: "{name} 값은 {max}자 이하여야 합니다.",
    required: "{name} 값을 입력해 주세요.",
    missingParam: "{name} 파라미터가 필요합니다.",
    invalidJson: "요청 본문이 올바른 JSON 객체가 아닙니다.",
    invalidBody: "요청 본문이 올바르지 않습니다.",
    nothingToChange: "변경할 항목이 없습니다.",
    nothingToChangeFields: "변경할 항목이 없습니다. {fields} 중 하나 이상을 지정해 주세요.",
    oneOf: "{name} 값은 {values} 중 하나여야 합니다.",
    reasonLabel: "변경 사유(reason)",
    resolutionLabel: "종료 사유(resolution)",
    intArray: "{name} 값은 {min}~{max} 사이 정수 배열이어야 합니다.",
    rangeInvalid: "range 값이 올바르지 않습니다: {value} (today, yesterday, 1h, 6h, 24h, 7d, 30d 또는 from/to)",
    rangeSpan: "range 값은 1h~{max}d 사이여야 합니다: {value}",
    rangeOrder: "from 시각이 to 시각보다 늦을 수 없습니다.",
  },
  permission: {
    denied: "'{action}' 권한이 없습니다 ({operator} · {role}). 필요 권한: {permission}",
    operatorRequired: "'{action}' 권한이 없습니다 ({operator} · {role}). Operator 이상 필요합니다.",
    apiDenied: "권한이 없습니다 ({operator}). 필요 권한: {permission}",
    unverified: "인증 정보를 확인할 수 없습니다.",
    action: {
      alertAck: "알림 확인",
      alertResolve: "알림 해소",
    },
  },
  domain: {
    workflowNotFound: "Workflow를 찾을 수 없습니다: {id}",
    pipelineNotFound: "Pipeline을 찾을 수 없습니다: {id}",
    pipelineVersionNotFound: "Pipeline version을 찾을 수 없습니다: {id}@{version}",
    pipelineJobNotFound: "PipelineJob을 찾을 수 없습니다: {id}",
    unknownBucket: "알 수 없는 버킷입니다: {name}",
    workflowTerminal: "이미 종료된 Workflow는 취소할 수 없습니다 (현재 상태: {status})",
    workflowCancelFailed: "Workflow를 취소하지 못했습니다.",
    dlqNotFound: "DLQ 항목을 찾을 수 없습니다: {id}",
    dlqReplayInProgress: "이미 Replay가 진행 중입니다: {id}",
    dlqAlreadyReplayed: "이미 Replay가 완료된 항목입니다: {id}",
    dlqClosed: "종료 처리된 항목은 Replay할 수 없습니다: {id}",
    dlqAlreadyClosed: "이미 종료 처리된 항목입니다: {id}",
    dlqCloseWhileReplaying: "Replay 진행 중인 항목은 종료할 수 없습니다: {id}",
    replayFailed: "Replay를 시작하지 못했습니다.",
    closeFailed: "종료 처리하지 못했습니다.",
    replayBatchLimit: "일괄 Replay는 최대 {max}건까지 가능합니다.",
    idsRequired: "ids는 비어 있지 않은 문자열 배열이어야 합니다.",
    operatorIdRequired: "operator_id를 지정해 주세요 (담당 해제는 null).",
    unknownOperator: "알 수 없는 운영자 ID입니다: {id}",
    unknownVersion: "알 수 없는 Pipeline version입니다: {version}",
    deprecatedVersion: "지원 종료(DEPRECATED)된 Pipeline version은 사용할 수 없습니다: {version}",
    versionTrafficSum: "버전별 트래픽 합계는 100%여야 합니다 (현재 {total}%)",
    unknownLanguage: "지원하지 않는 언어 코드입니다: {lang} ({allowed} 중 하나)",
    unknownStage: "알 수 없는 단계입니다: {id}",
    resultNotFound: "발화 결과를 찾을 수 없습니다: {id}",
    alertNotFound: "알림을 찾을 수 없습니다: {id}",
    alertAlreadyAcked: "이미 확인 처리된 알림입니다: {id}",
    alertAlreadyResolved: "이미 해소된 알림입니다: {id}",
    unknownAlertPolicy: "알 수 없는 알림 정책입니다: {id}",
    unknownService: "알 수 없는 서비스입니다: {id}",
    bucketNotFound: "버킷을 찾을 수 없습니다: {name}",
    objectNotFound: "객체를 찾을 수 없습니다: {uri}",
    capacityExceedsGlobal: "max_concurrent({value})는 Global 최대 동시 실행({max})을 넘을 수 없습니다.",
    globalBelowLanguage: "Global 최대 동시 실행({value})은 언어별 최대값({min})보다 작을 수 없습니다.",
    timeoutOrder: "pipelineTimeoutMin({pipeline}) 값은 workflowTimeoutMin({workflow}) 값보다 클 수 없습니다.",
    mockLoginDisabled: "mock 로그인은 auth.mode=mock 에서만 사용할 수 있습니다.",
    unknownUser: "알 수 없는 사용자입니다: {id}",
    defaultCancelReason: "운영자 요청에 의한 취소",
  },
  client: {
    network: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.",
    timeout: "응답 시간이 초과되었습니다. 다시 시도해 주세요.",
    requestFailed: "요청을 처리하지 못했습니다 ({status}).",
    streamDisconnected: "실시간 스트림 연결이 끊어졌습니다. 다시 연결하는 중입니다.",
    unexpected: "예상하지 못한 오류가 발생했습니다.",
  },
};

export default errors;
