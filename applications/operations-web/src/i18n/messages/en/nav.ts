/** nav — English. Must have exactly the keys of ../ko/nav.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/nav";

const nav = {
  label: "Screens",
  home: "AIPO home (Orchestration)",
  orchestration: { label: "Orchestration", title: "Orchestration" },
  board: { label: "Board", title: "Workflow board" },
  overview: { label: "Overview", title: "Overview" },
  capacity: { label: "Capacity", title: "Capacity" },
  explorer: { label: "Explorer", title: "Workflow Explorer" },
  workflows: { label: "Pipeline detail", title: "Pipeline detail" },
  workflow: { label: "Workflow detail", title: "Workflow {id}" },
  pipelines: { label: "Pipelines", title: "Pipelines" },
  dlq: { label: "DLQ", title: "DLQ" },
  results: { label: "Results", title: "Evaluation results" },
  analytics: { label: "Analytics", title: "Analytics" },
  config: { label: "Config", title: "Operations config" },
  files: { label: "Files", title: "File search" },
  hermes: { label: "Hermes", title: "Hermes" },
  login: { label: "Sign in", title: "Sign in" },
  dlqPendingBadge: "{count} pending review",
} satisfies Messages<typeof ko>;

export default nav;
