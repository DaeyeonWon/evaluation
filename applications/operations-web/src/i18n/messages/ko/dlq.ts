/**
 * dlq — S-05 DLQ screen: review queue, Replay / close / assign dialogs (src/components/atlas/dlq.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/dlq.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("dlq")` · server `const t = await getT("dlq")`.
 */
const dlq = {
  desc: "최종 실패와 재시도 불가 오류가 격리됩니다. 로그를 검토한 뒤 종료하거나, 사유를 남기고 수동 Replay를 승인합니다.",
  viewBranch: "DLQ 분기 보기",
  kpi: { inRange: "기간 내 DLQ" },
  outside: {
    title: "선택한 기간 밖에 검토 대기 DLQ가 있습니다: {count}건",
    titleActive: "선택한 기간 밖에 아직 처리 중인 DLQ가 있습니다",
    detail: "승인 {approved}건 · Replay 중 {replaying}건 · 현재 기간: {range}",
    widen: "최근 30일로 넓히기",
  },
  filters: { category: "실패 유형", searchPh: "dlq id · workflow · error code · path" },
  groups: {
    title: "실패 유형별 그룹",
    checked: "{count}건 선택",
    batch: "선택 Batch Replay",
    selectAria: "선택: {id}",
    attempts: "Attempt {count}회",
  },
  batch: {
    step1: "1 대상 선택 {count}건",
    step3: "3 일괄 승인",
    warn: "선택 항목에 재시도 불가 유형(입력 스키마/권한)이 포함되어 있습니다. 원인을 고치지 않았다면 해당 항목은 같은 오류로 실패합니다.",
    keepVersion: "각 항목의 원본 Version 유지",
    reason: "일괄 재실행 사유 (필수 · 감사 기록)",
    reasonPh: "예: LLM Judge 엔드포인트 복구 확인 후 일괄 재처리",
    confirm: "{count}건 Batch Replay 승인",
  },
  empty: { title: "조건에 맞는 DLQ 항목이 없습니다", body: "기간을 넓히거나 언어·실패 유형 필터를 풀어 보세요." },
  detail: {
    title: "상세 · 복구",
    emptyTitle: "왼쪽에서 DLQ 항목을 선택하세요",
    emptyBody: "실패 로그, 이전 실행 이력, Replay 승인이 여기에 표시됩니다.",
    error: "오류",
    cause: "원인",
    input: "입력",
    utterances: "발화 {count}건",
    attempts: "{count}회",
    lastJob: "실패 PipelineJob",
    created: "발생",
    assignee: "담당자",
    assignAria: "담당자 지정",
    assignReason: "DLQ 화면에서 담당자 지정",
    unassigned: "미지정",
    lastLog: "최근 실패 로그",
    stackTrace: "Stack trace 펼치기",
    history: "이전 실행 이력",
    notes: "운영 메모",
    resolution: "종료 사유: {text}",
  },
  col: { status: "상태", error: "오류", started: "시작", duration: "소요" },
  warn: {
    inputSchema: "입력 스키마 오류는 원본 데이터를 수정하지 않는 한 같은 결과가 나옵니다. 새 입력 Artifact 버전을 만든 뒤 Replay하거나 종료 처리해 주세요.",
    auth: "권한 오류는 IAM 바인딩을 먼저 수정해야 합니다. 수정 전 Replay는 같은 오류로 실패합니다.",
    codeDefect: "코드 결함은 수정된 Pipeline Version으로 Replay해야 합니다. 아래에서 Version을 바꿀 수 있습니다.",
  },
  replay: {
    aria: "Replay 승인",
    step1: "1 로그·이력 검토",
    step2: "2 사유·Version",
    step3: "3 승인 확정",
    explain: "새 Replay Cycle cycle {cycle}을(를) 만들어 {language} Pending Queue에 Priority 8로 다시 등록합니다. 원본 입력은 수정하지 않습니다: {file}",
    version: "Pipeline Version",
    original: "원본",
    reason: "재실행 사유 (필수 · 감사 기록)",
    reasonPh: "예: GPU quota 증설 확인 (INC-20261110-01 해소) 후 재실행",
    confirm: "Replay 승인 확정",
  },
  close: {
    aria: "종료 처리",
    step1: "1 검토",
    step2: "2 종료 사유",
    reason: "종료 사유 (필수)",
    reasonPh: "예: 영구 실패 — 입력 배치 폐기",
    confirm: "종료 처리",
  },
  actions: {
    replay: "Replay 승인…",
    close: "종료 처리…",
    replayingBlocked: "Replay 진행 중이라 중복 승인이 차단됩니다.",
    alreadyHandled: "이미 처리된 항목입니다.",
  },
  perm: {
    line: "권한 {perm} · 현재 계정 {user} ({roles}).",
    ok: "실행할 수 있습니다. 모든 변경은 감사 로그에 기록됩니다.",
    denied: "이 계정은 Replay·종료·담당 지정 권한이 없습니다.",
    viewerHint: "조회 전용 계정입니다. Replay에는 {perm} 권한이 필요합니다.",
  },
  replays: {
    title: "Replay 결과",
    workflows: "원본 → Replay Workflow",
    requestedApproved: "요청 / 승인",
    time: "시각",
    empty: "이 기간에 생성된 Replay가 없습니다",
  },
  toast: {
    replayed: "Replay 승인 완료: {replay} → 새 Workflow {workflow} (cycle {cycle}) · {status}",
    closed: "종료 처리했습니다: {id}",
    assigned: "담당자를 지정했습니다: {id} → {name}",
    batch: "Batch Replay {count}건을 승인했습니다 · 새 Workflow {ids}",
    batchPartial: "Batch Replay {ok}건 승인 · 실패 {failed}건 · 새 Workflow {ids}",
    batchNone: "Batch Replay할 항목을 체크박스로 먼저 선택해 주세요. (검토 대기·승인 상태만 선택할 수 있습니다)",
  },
};

export default dlq;
