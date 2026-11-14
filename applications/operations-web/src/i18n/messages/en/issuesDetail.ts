import type { Messages } from "../../core";
import type ko from "../ko/issuesDetail";

const issuesDetail = {
  view: { tab: "Issue detail", desc: "Score anatomy, evidence, per-dimension breakdowns, utterances and triage history of one issue" },
  metaTitle: "Issue {id}",
  score: "Criticality",
  fails: { one: "# FAIL", other: "# FAILs" },
  failRate: "FAIL rate {rate}",
  notFound: "Issue {id} was not found. Try another range or filters.",
  placeholder: "The single-issue analysis page is being built.",
} satisfies Messages<typeof ko>;

export default issuesDetail;
