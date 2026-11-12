/**
 * auth — sign-in page, 403 page, session, role/permission UI (src/app/login, src/app/forbidden.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/auth.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("auth")` · server `const t = await getT("auth")`.
 */
const auth = {
  login: {
    title: "운영자 계정 선택",
    lead: "데모용 로그인입니다. 선택한 계정은 서버가 서명한 HttpOnly 쿠키로 유지되며, 모든 권한 검사와 감사 로그는 이 계정을 기준으로 합니다.",
    current: "현재 로그인: {name} ({roles}).",
    noRole: "역할 없음",
    next: "로그인 후 이동할 화면: {path}",
    hermesTitle: "Hermes 대시보드 접근 권한",
    logout: "로그아웃",
    logoutHint: "세션 쿠키를 삭제합니다.",
  },
  roles: {
    admin: "전체 권한 · 런타임 설정, Version 변경, 시뮬레이터 제어 포함",
    operator: "Capacity 조정, DLQ Replay, Workflow 취소, Hermes 접근",
    viewer: "대시보드·로그 조회와 CSV 내보내기만 가능",
  },
  proxy: {
    title: "인증 정보가 없습니다",
    leadIap: "이 콘솔은 Google Cloud IAP 뒤에서만 동작합니다. IAP를 거쳐 다시 접속해 주세요.",
    leadOidc: "이 콘솔은 조직 OIDC 인증 프록시 뒤에서만 동작합니다. 프록시를 거쳐 다시 접속해 주세요.",
  },
  forbidden: {
    metaTitle: "접근 권한 없음",
    title: "이 페이지에 접근할 권한이 없습니다",
    lead: "권한이 필요하면 콘솔 관리자에게 역할 추가를 요청해 주세요. 요청할 때 아래 계정 정보를 함께 전달하면 됩니다.",
    account: "계정",
    roles: "역할",
    perms: "권한",
    back: "콘솔로 돌아가기",
    switch: "다른 계정으로 로그인",
  },
};

export default auth;
