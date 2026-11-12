/**
 * shell — Atlas shell chrome: top bar, period selector, simulator controls, clock, user menu,
 * command palette, toasts, permission notes (src/components/atlas/shell.tsx, time-range.tsx, ui.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/shell.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("shell")` · server `const t = await getT("shell")`.
 */
const shell = {
  brand: {
    name: "AIPO Atlas",
    env: "PROD",
  },
  nav: {
    more: "더 보기",
    moreLabel: "나머지 화면",
  },
  range: {
    aria: "조회 기간 선택: {label}",
    dialog: "조회 기간",
    sheet: "PERIOD · 조회 기간",
    presetsLabel: "기간 프리셋",
    presets: {
      today: "오늘",
      yesterday: "어제",
      "1h": "최근 1시간",
      "6h": "최근 6시간",
      "24h": "최근 24시간",
      "7d": "최근 7일",
      "30d": "최근 30일",
    },
    label: {
      today: "오늘 · {date}",
      yesterday: "어제 · {date}",
      lastHours: "최근 {count}시간",
      lastDays: "최근 {count}일",
      now: "현재",
    },
    customShort: "직접",
    custom: "직접 지정",
    kst: "KST",
    from: "시작",
    to: "종료",
    fromDate: "시작 날짜 (KST)",
    fromTime: "시작 시각 (KST)",
    toDate: "종료 날짜 (KST)",
    toTime: "종료 시각 (KST)",
    toNow: "현재 시각",
    apply: "기간 적용",
    reset: "오늘로 초기화",
    window: "데이터 보존 범위 {from} – {to} · {days}일",
    errors: {
      invalid: "날짜와 시각을 모두 입력해 주세요.",
      order: "시작 시각은 종료 시각보다 빨라야 합니다.",
      before: "데이터 보존 범위 이전입니다. {date} 이후를 선택해 주세요.",
      after: "가상시계 현재 시각 이후는 선택할 수 없습니다.",
    },
    empty: {
      title: "이 기간에는 항목이 없습니다",
      in: "조회 기간: {range}",
      widen: "기간을 넓혀 보세요 (예: 최근 7일).",
    },
    outside: "기간 밖에도 처리가 필요한 항목이 있습니다: {count}건",
  },
  sim: {
    pause: "시뮬레이터 일시정지",
    resume: "시뮬레이터 재개",
    paused: "실시간 시뮬레이션을 일시정지했습니다.",
    resumed: "실시간 시뮬레이션을 재개했습니다.",
    speed: "시뮬레이터 속도",
    speedSet: "시뮬레이터 속도를 {speed}x로 바꿨습니다.",
    denied: "시뮬레이터 제어는 Admin 권한(sim:control)이 필요합니다",
  },
  stream: {
    title: "실시간 스트림 연결 상태",
    connecting: "연결 중",
    reconnecting: "재연결 중",
  },
  user: {
    menu: "계정 메뉴: {name} ({role})",
    menuLabel: "계정",
    roles: "역할",
    noRole: "역할 없음",
    auth: "인증",
    perms: "권한",
    prefs: "표시",
    switch: "다른 계정으로 로그인",
    logout: "로그아웃",
    loggingOut: "로그아웃 중…",
    signIn: "로그인",
  },
  auth: {
    expired: "세션이 만료되었습니다. 로그인 화면으로 이동합니다.",
    forbidden: "이 작업을 수행할 권한이 없습니다.",
  },
  perm: {
    need: "필요 권한 {perm}.",
    roles: "허용 역할 {roles}.",
    current: "현재 계정 {name} ({role}):",
    ok: "실행 가능.",
    denied: "실행 불가 · 권한이 있는 계정으로 로그인하세요.",
    audit: "모든 변경은 감사 로그에 기록됩니다.",
    actor: "실행 계정",
  },
  palette: {
    label: "명령 팔레트",
    open: "검색 및 명령 팔레트 열기 (⌘K)",
    button: "Workflow·파일·DLQ 검색",
    input: "검색어",
    results: "검색 결과",
    placeholder: "Workflow ID, 파일 이름, Pipeline, DLQ ID, 오류 코드, 화면 이름…",
    emptyTitle: "일치하는 항목이 없습니다",
    emptyHint: "Workflow ID 일부(예: ko-0022), 파일 이름(예: batch-0001.jsonl)이나 오류 코드(예: QUOTA)로 검색해 보세요.",
    groups: {
      screens: "화면",
      stages: "오케스트레이션 단계",
      pipelines: "Pipeline",
      files: "파일",
    },
    root: "root",
    sub: "sub-pipeline",
    pipelineSub: "{label} · {kind} · {version} · 기간 내 실행 {runs}건",
    noWorkflow: "Workflow 없음",
    openWorkflow: "Workflow",
    keys: {
      move: "이동",
      open: "열기",
      alt: "Workflow 열기",
    },
  },
};

export default shell;
