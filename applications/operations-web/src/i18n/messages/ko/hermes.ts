/**
 * hermes — Hermes dashboard link placeholder (src/app/(console)/hermes/page.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/hermes.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("hermes")` · server `const t = await getT("hermes")`.
 */
const hermes = {
  status: "NOT CONFIGURED",
  title: "Hermes 대시보드가 아직 연결되지 않았습니다",
  lead: "Hermes는 별도 URL에서 운영됩니다. 주소가 설정되면 이 페이지는 권한을 확인한 뒤 Hermes로 바로 이동합니다.",
  step1: "서버 환경 변수를 설정합니다:",
  step2: "서버를 재시작합니다 (URL은 시작할 때 읽습니다).",
  step3: "접근에 필요한 권한:",
  access: "현재 계정 {name} ({roles})은 Hermes에 접근할 수 있습니다.",
  back: "콘솔로 돌아가기",
};

export default hermes;
