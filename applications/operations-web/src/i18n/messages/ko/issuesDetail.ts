/**
 * issuesDetail — strings of the single-issue page (/issues/[id]). Owned by the Detail view engineer.
 * Shared vocabulary (severity, status, factors, reasons) lives in `issues`.
 * Add keys here AND in en/issuesDetail.ts (en must `satisfies Messages<typeof ko>`); run npm run i18n:check.
 */
const issuesDetail = {
  view: { tab: "이슈 상세", desc: "단건 이슈의 점수 구성, 근거, 차원별 분해, 발화와 Triage 이력을 분석합니다" },
  metaTitle: "이슈 {id}",
  score: "Criticality",
  fails: "FAIL {count}건",
  failRate: "FAIL 비율 {rate}",
  notFound: "이슈 {id}를 찾을 수 없습니다. 기간이나 필터를 바꿔 보세요.",
  placeholder: "단건 이슈 분석 화면을 준비 중입니다.",
};

export default issuesDetail;
