/**
 * explorer — S-03 Workflow Explorer: filters, table columns, facets (src/components/atlas/explorer.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/explorer.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("explorer")` · server `const t = await getT("explorer")`.
 */
const explorer = {
  title: "Workflow Explorer",
  desc: "Workflow · PipelineJob · Batch ID · Trace · Idempotency Key로 검색합니다. 필터와 기간은 URL에 저장되어 상세 화면에서 돌아오거나 새로고침해도 유지됩니다.",
  f: {
    q: "통합 검색 (ID · Trace · 객체 · 오류 · DLQ)",
    status: "상태",
    statusAll: "전체 상태",
    model: "Model version",
    errorCode: "오류 코드",
    errorCategory: "오류 유형",
    rangeBy: "기간 기준",
    sort: "정렬",
    language: "언어",
    hasRetries: "Retry 발생",
    replay: "Replay 실행",
  },
  presets: {
    _active: "Slot 점유 (RESERVED·DISPATCHING·RUNNING)",
    _failed: "실패 관련 (RETRY·DLQ·TIMEOUT)",
  },
  rangeBy: {
    active: "기간 중 활성",
    created: "기간 중 생성",
    updated: "기간 중 갱신",
    activeHelp: "생성부터 종료까지의 수명이 기간과 겹치는 Workflow",
    createdHelp: "created_at이 기간 안에 있는 Workflow",
    updatedHelp: "updated_at이 기간 안에 있는 Workflow",
  },
  sorts: {
    created_desc: "최근 생성순",
    created_asc: "오래된 순",
    wait_desc: "대기 시간 긴 순",
    run_desc: "실행 시간 긴 순",
    updated_desc: "최근 갱신순",
    attempts_desc: "Attempt 많은 순",
  },
  total: "{count}건",
  cols: {
    status: "상태",
    language: "언어",
    pipeline: "Pipeline · Version · Model",
    wait: "대기 시간",
    run: "실행 시간",
    input: "입력 데이터",
    error: "오류",
    created: "생성",
  },
  replayOf: "Replay 원본: {id}",
  utt: "발화 {count}건",
  empty: {
    title: "조건에 맞는 Workflow가 없습니다",
    filters: "필터를 줄이거나 Workflow ID 일부로 검색해 보세요. 기간을 넓혀도 됩니다.",
    range: "기준: {by}. 기간을 넓혀 보세요.",
  },
};

export default explorer;
