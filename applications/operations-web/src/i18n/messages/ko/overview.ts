/**
 * overview — S-01 Overview screen: KPIs, alerts, throughput, recent events (src/components/atlas/overview.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/overview.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("overview")` · server `const t = await getT("overview")`.
 */
const overview = {
  title: "전체 운영 현황",
  desc: "bixby-eval-prod · asia-northeast3. LIVE 수치는 현재 상태, 나머지는 선택한 기간의 집계입니다. 숫자를 누르면 해당 화면으로 이동합니다.",
  acts: {
    canvas: "캔버스에서 보기",
    explorer: "Workflow 검색",
  },
  empty: {
    widen: "기간을 넓혀 보세요 (예: 최근 7일).",
  },
  kpi: {
    range: "기간",
    rangeHint: "선택한 기간의 집계",
    liveHint: "현재 상태 (기간과 무관)",
    runningSub: "Dispatching {dispatching} · Reserved {reserved}",
    pendingSub: "Queued {queued} · 수신·검증 {received}",
    retrySub: "Backoff 60s → 300s",
    dlqSub: "기간 내 신규 {created}",
    completed: "완료",
    completedSub: "발화 {count}건 평가",
    failed: "실패",
    failedSub: "DLQ {dlq} · Timeout {timeout} · 취소 {cancelled} 별도",
    success: "성공률",
    successSub: "Retry 비율 {retry} · 목표 99.5%",
    duration: "평균 / p95 처리 시간",
    durationSub: "p95 {p95} · 대기 {wait}",
  },
  throughput: {
    title: "Pipeline 처리량",
    per5m: "5분 단위",
    perHour: "1시간 단위",
    axis: "완료 Pipeline · {unit}",
  },
  status: {
    title: "Workflow 상태 분포",
    ref: "기간 중 활성 Workflow의 현재 상태 · 클릭 = Explorer",
    empty: "이 기간에 활성 Workflow가 없습니다",
  },
  lang: {
    title: "언어별 처리 결과",
    ref: "기간 내 생성·성공·실패 · 막대 위 = 성공률",
    axis: "Workflow",
    succeeded: "성공",
    failed: "실패",
    created: "생성",
    cell: "생성 {created} · 성공 {ok} · 실패 {fail}",
  },
  errors: {
    title: "오류 유형별 분포",
    ref: "기간 내 Attempt 실패 · 주황 Retry 대상 / 빨강 즉시 DLQ·제한",
    empty: "이 기간에는 실패한 Attempt가 없습니다",
  },
  events: {
    title: "최근 Event",
    ref: "기간 내 {count}건 · LIVE",
    empty: "이 기간에는 Event가 없습니다",
    cols: {
      time: "시각",
      event: "Event",
      lang: "언어",
      stage: "단계",
    },
  },
  alerts: {
    title: "시스템 알림 및 Incident",
    ref: "OPEN {count}",
    open: "진행 중인 알림 · {count}",
    none: "이 기간에 열린 알림이 없습니다",
    outside: "기간 밖에 아직 열린 알림이 있습니다: {count}건",
    recentResolved: "최근 해소",
    ack: "확인",
    resolve: "해소",
    detail: "상세",
    ackBy: "확인 {name}",
    needPerm: "Operator 이상 권한이 필요합니다",
    ackNote: "Overview에서 확인",
    resolveNote: "Overview에서 해소 처리",
    acked: "알림을 확인 처리했습니다: {id}",
    resolvedToast: "알림을 해소 처리했습니다: {id}",
  },
  incidents: {
    title: "Incident",
    none: "이 기간에 Incident가 없습니다",
    commander: "지휘 {name}",
    started: "시작 {at}",
    ended: "종료 {at}",
  },
};

export default overview;
