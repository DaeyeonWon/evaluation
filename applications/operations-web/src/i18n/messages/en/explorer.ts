/** explorer — English. Must have exactly the keys of ../ko/explorer.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/explorer";

const explorer = {
  title: "Workflow Explorer",
  desc: "Search by Workflow, PipelineJob, Batch ID, Trace or Idempotency Key. Filters and the period live in the URL, so they survive coming back from a detail page or reloading.",
  f: {
    q: "Search (ID · Trace · object · error · DLQ)",
    status: "Status",
    statusAll: "All statuses",
    model: "Model version",
    errorCode: "Error code",
    errorCategory: "Error category",
    rangeBy: "Period applies to",
    sort: "Sort",
    language: "Language",
    hasRetries: "Has retries",
    replay: "Replays",
  },
  presets: {
    _active: "Holding a Slot (RESERVED·DISPATCHING·RUNNING)",
    _failed: "Failure-related (RETRY·DLQ·TIMEOUT)",
  },
  rangeBy: {
    active: "Active during period",
    created: "Created in period",
    updated: "Updated in period",
    activeHelp: "Workflows whose lifetime (created to finished) overlaps the period",
    createdHelp: "Workflows with created_at in the period",
    updatedHelp: "Workflows with updated_at in the period",
  },
  sorts: {
    created_desc: "Newest first",
    created_asc: "Oldest first",
    wait_desc: "Longest wait",
    run_desc: "Longest run",
    updated_desc: "Recently updated",
    attempts_desc: "Most attempts",
  },
  total: "{count} total",
  cols: {
    status: "Status",
    language: "Language",
    pipeline: "Pipeline · version · model",
    wait: "Wait",
    run: "Run time",
    input: "Input",
    error: "Error",
    created: "Created",
  },
  replayOf: "Replay of {id}",
  utt: { one: "# utterance", other: "# utterances" },
  empty: {
    title: "No workflows match",
    filters: "Remove some filters, search for part of a Workflow ID, or widen the period.",
    range: "Period applies to: {by}. Try a wider period.",
  },
} satisfies Messages<typeof ko>;

export default explorer;
