/**
 * nav — screen names. Used by the shell tabs, the command palette "화면" group, breadcrumbs and
 * page <title> (generateMetadata → getT("nav") → `${key}.title`).
 * `label` = tab text (short), `title` = document title.
 */
const nav = {
  label: "화면",
  home: "AIPO 홈 (오케스트레이션)",
  orchestration: { label: "오케스트레이션", title: "오케스트레이션" },
  board: { label: "Board", title: "Workflow Board" },
  overview: { label: "개요", title: "개요" },
  capacity: { label: "Capacity", title: "Capacity" },
  explorer: { label: "Explorer", title: "Workflow Explorer" },
  workflows: { label: "Pipeline 상세", title: "Pipeline 상세" },
  workflow: { label: "Workflow 상세", title: "Workflow {id}" },
  pipelines: { label: "Pipelines", title: "Pipelines" },
  dlq: { label: "DLQ", title: "DLQ" },
  results: { label: "평가 결과", title: "평가 결과" },
  analytics: { label: "분석", title: "분석" },
  config: { label: "설정", title: "운영 설정" },
  files: { label: "Files", title: "파일 검색" },
  hermes: { label: "Hermes", title: "Hermes" },
  login: { label: "로그인", title: "로그인" },
  dlqPendingBadge: "검토 대기 {count}건",
};

export default nav;
