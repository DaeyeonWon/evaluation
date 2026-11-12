/**
 * capacity — S-02 Capacity screen: language limits, Slots, Backlog, reservations, dry-run dialogs (src/components/atlas/capacity.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/capacity.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("capacity")` · server `const t = await getT("capacity")`.
 */
const capacity = {
  title: "언어별 Capacity",
  desc: "변경은 권한 확인, 사유 기록, 서버 영향 분석(Dry run)을 거쳐 PATCH로 저장됩니다. 카드는 LIVE, 추이 차트는 선택한 기간입니다.",
  acts: {
    config: "전체 설정",
  },
  card: {
    slotsAria: "Capacity Slot {active}/{max}",
    legend: "■ RUNNING {running} · ▨ RESERVED/DISPATCHING {reserved} · RETRY_WAIT {retry} (Slot 반납)",
    avgWait: "평균 대기",
    p95Title: "p95 대기 시간 · SLO {min}분",
    throughput: "처리량",
    uttPerHour: "발화/h",
    weightStarts: "가중치 · 시작/분",
    utilization: "사용률",
    edit: "설정 변경",
    pause: "일시정지",
    resume: "재개",
    oldest: "최장 대기 {ago}",
    none: "없음",
    pauseHint: "아래에서 Admission 스위치를 확인하고 사유를 입력한 뒤 \"변경 적용\"을 눌러야 반영됩니다.",
  },
  stepper: {
    dec: "{label} 감소",
    inc: "{label} 증가",
  },
  impact: {
    title: "기존 실행 영향 분석",
    none: "영향 없음",
    idle: "값을 바꾸면 서버에서 기존 실행에 미치는 영향을 계산합니다.",
  },
  edit: {
    title: "{lang} Capacity 설정 변경",
    max: "최대 동시 실행",
    starts: "분당 시작 수",
    weight: "Priority 가중치",
    pauseAria: "Admission 일시정지",
    paused: "일시정지",
    running: "실행 중",
    tfDefault: "Terraform 기본값 maxConcurrent = {value}",
    noChange: "변경 없음",
    reason: "변경 사유 (필수 · 감사 로그 기록)",
    reasonPh: "예: 오후 실발화 업로드 급증, ko p95 대기 SLO 초과 — INC-20261112-01",
    revert: "되돌리기",
    apply: "변경 적용",
    needPerm: "capacity:write 권한(Operator 이상)이 필요합니다",
    applied: "설정을 적용했습니다: {lang} · {fields} · 감사 로그 {audit}",
  },
  global: {
    applied: "Global 설정을 변경했습니다: 상한 {max} · 분당 시작 {starts}",
    summary: "사용률 {util} · 분당 시작 {starts} · Global Backlog {backlog} · 언어 상한 합 {sum}",
    max: "Global 상한",
    starts: "분당 시작",
    reason: "변경 사유 (필수)",
    reasonPh: "예: GPU quota 16 → 24 증설 반영",
    apply: "Global 적용",
    note: "Global 상한을 낮춰도 실행 중인 Pipeline은 종료되지 않습니다. Terraform 기본값은 {tf}이며, 런타임 값과 다르면 설정 화면의 Drift 목록에 표시됩니다.",
  },
  history: {
    heading: "Capacity 추이",
    peak: "최대 동시 실행 {active}/{limit} · 언어별 최대 대기",
    gran: {
      "5m": "5분 단위",
      "1h": "1시간 단위",
      "6h": "6시간 단위",
    },
    activeTitle: "동시 실행 Slot",
    activeRef: "언어별 active 누적 · 점선 = Global 상한",
    activeAxis: "Active Slot",
    globalLimit: "Global 상한",
    queueTitle: "Pending Queue 깊이",
    queueRef: "언어별 대기 건수 · Firestore pending_jobs",
    queueAxis: "대기 건수",
    emptyHint: "이 기간에는 집계 구간이 없습니다. 기간을 넓혀 보세요.",
  },
  compare: {
    title: "언어별 처리량 비교",
    ref: "시간당 Pipeline · 최근 1시간",
    label: "{value}/h · 발화 {utt}",
  },
};

export default capacity;
