/**
 * issuesCategories — strings of the Issue Report 분해 보기 view (/issues/categories). Owned by the
 * Categories view engineer. Shared vocabulary (dims, severity, category labels) lives in `issues`.
 * Add keys here AND in en/issuesCategories.ts (en must `satisfies Messages<typeof ko>`); run npm run i18n:check.
 */
const issuesCategories = {
  view: { tab: "분해 보기", desc: "카테고리·Agent function·Division·Region·Bixby version별로 이슈를 분해해 어디에 FAIL이 몰리는지 비교합니다" },
  placeholder: "분해 보기를 준비 중입니다. 위 필터와 보기 전환은 이미 동작합니다.",
};

export default issuesCategories;
