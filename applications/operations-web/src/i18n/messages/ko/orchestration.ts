/**
 * orchestration — orchestration canvas (route "/"): stage nodes, edges, legend, canvas toolbar (src/components/atlas/canvas/canvas.tsx, nodes.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/orchestration.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("orchestration")` · server `const t = await getT("orchestration")`.
 */
const orchestration = {
  title: "오케스트레이션",
  drawing: {
    aria: "AIPO 논리 구성 토폴로지: Event Producer부터 결과 저장, Retry, DLQ, Manual Replay까지. 단계를 선택하면 Inspector가 열립니다.",
    titleBlock: "도면 정보",
    heading: "논리 구성 · 빅스비 실발화 평가",
    dwg: "DWG",
    ref: "REF",
    scale: "SCALE",
    live: "LIVE",
    range: "RANGE",
    liveHint: "실시간 Batch 수 · 가상시계",
  },
  annotations: {
    adr001: "ADR-001 · 상위 Orchestrator = Cloud Workflows",
    adr002: "ADR-002 · Cloud Tasks 미사용",
    adr003: "ADR-003 · Firestore = Operational State",
    adr004: "ADR-004 · 상태 Firestore / 이력 BigQuery / 로그 Logging",
    idempotency: "§4.1 Idempotency = SHA256(project+bucket+object+generation+version)",
    jobId: "PipelineJob ID = {{workflow_id}}-cycle-{{n}}-attempt-{{n}}",
    slo: "INTAKE → ADMISSION · Event 등록 p95 SLO 10s · Capacity 확보 후 시작 지연 p95 SLO 30s",
    recovery: "RECOVERY LAYER · Pub/Sub · Cloud Run",
    execution: "EXECUTION LAYER · Vertex AI",
    retryPolicy: "§4.3 Retry 최대 2회 · 60s→300s",
  },
  edges: {
    objectFinalized: "Object Finalized",
    cloudEventPush: "CloudEvent push",
    register: "등록",
    admission: "Admission",
    slotReserved: "Slot 확보",
    pipelineJob: "PipelineJob",
    success: "SUCCESS",
    failure: "FAILURE",
    retryLoop: "attempts < 3",
    toDlq: "attempts = 3 · non-retryable",
    approval: "운영자 승인",
    manualReplay: "MANUAL REPLAY → 새 replay_cycle로 Language Queue 재등록",
  },
  legend: {
    aria: "범례",
    title: "BATCH TOKEN · 링 = 상태 · 선 굵기·속도 = 처리량",
  },
  ticker: {
    aria: "실시간 상태 전이",
    title: "STATE TRANSITIONS",
    live: "LIVE",
    paused: "PAUSED",
  },
  minimap: {
    aria: "미니맵 (클릭하여 이동)",
  },
  zoom: {
    group: "확대·축소",
    in: "확대",
    out: "축소",
    fit: "전체 도면 맞추기",
    level: "현재 배율",
  },
  hint: {
    title: "드래그해 이동 · ⤢ 버튼으로 전체 도면 보기",
    drag: "드래그",
    all: "전체",
  },
  token: {
    title: "{id} · {status} · {lang} · attempt {attempt}",
    open: "클릭하면 Workflow 상세로 이동",
    searchHit: "검색 일치",
  },
  range: {
    aria: "조회 기간",
    hint: "카운터와 검색은 선택한 기간 기준이고, Batch token과 Slot은 실시간입니다.",
    liveTag: "실시간",
  },
  search: {
    label: "파일 이름 검색",
    placeholder: "파일 이름 검색 · batch-0042, results.csv",
    shortcut: "⌘/",
    shortcutHint: "⌘/ 또는 Ctrl+/ 로 검색창으로 이동",
    clear: "검색어 지우기",
    searching: "검색 중…",
    resultsAria: "단계별 검색 결과",
    summary: "{count}건 · {stages}개 단계",
    summaryCapped: "{total}건 중 {shown}건 표시 · {stages}개 단계",
    none: "일치하는 파일이 없습니다: {q}",
    noneHint: "기간을 넓히거나 파일 이름 일부(예: batch-0042, results.csv, 2026-11-12/ko)로 검색해 보세요.",
    moreInStage: "이 단계 {count}건 더 보기",
    openAll: "GCS 파일 화면에서 전체 보기",
    showStage: "도면에서 보기",
    hitCount: "{count}건",
    stageBadge: "{count}건 일치",
    keyboard: "↑↓ 이동 · Enter 열기 · Esc 닫기",
    error: "검색하지 못했습니다.",
  },
  nodes: {
    uploadedObjects: "{range} 업로드 객체",
    uploaded: "{range} 업로드",
    delivered: "{range} 전달",
    executions: "{range} Execution",
    executionsRun: "{range} 실행",
    succeeded: "{range} 성공",
    retries: "{range} 재시도",
    passRate: "{range} Pass rate",
  },
};

export default orchestration;
