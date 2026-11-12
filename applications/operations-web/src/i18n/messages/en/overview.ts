/** overview — English. Must have exactly the keys of ../ko/overview.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/overview";

const overview = {
  title: "Operations overview",
  desc: "bixby-eval-prod · asia-northeast3. LIVE figures show the current state; the rest are totals for the selected period. Click a number to open that screen.",
  acts: {
    canvas: "View on canvas",
    explorer: "Search workflows",
  },
  empty: {
    widen: "Try a wider period (for example, last 7 days).",
  },
  kpi: {
    range: "Period",
    rangeHint: "Total for the selected period",
    liveHint: "Current state (independent of the period)",
    runningSub: "Dispatching {dispatching} · Reserved {reserved}",
    pendingSub: "Queued {queued} · received/validated {received}",
    retrySub: "Backoff 60s → 300s",
    dlqSub: "{created} new in period",
    completed: "Completed",
    completedSub: "{count} utterances evaluated",
    failed: "Failed",
    failedSub: "DLQ {dlq} · Timeout {timeout} · {cancelled} cancelled not counted",
    success: "Success rate",
    successSub: "Retry rate {retry} · target 99.5%",
    duration: "Avg / p95 processing time",
    durationSub: "p95 {p95} · wait {wait}",
  },
  throughput: {
    title: "Pipeline throughput",
    per5m: "per 5 min",
    perHour: "per hour",
    axis: "Completed pipelines · {unit}",
  },
  status: {
    title: "Workflow status",
    ref: "Current status of workflows active in the period · click = Explorer",
    empty: "No workflows were active in this period",
  },
  lang: {
    title: "Results by language",
    ref: "Created / succeeded / failed in period · label = success rate",
    axis: "Workflows",
    succeeded: "Succeeded",
    failed: "Failed",
    created: "Created",
    cell: "created {created} · ok {ok} · failed {fail}",
  },
  errors: {
    title: "Errors by category",
    ref: "Failed attempts in period · orange = Retry, red = straight to DLQ / limited",
    empty: "No failed attempts in this period",
  },
  events: {
    title: "Recent events",
    ref: "{count} in period · LIVE",
    empty: "No events in this period",
    cols: {
      time: "Time",
      event: "Event",
      lang: "Language",
      stage: "Stage",
    },
  },
  alerts: {
    title: "System alerts and incidents",
    ref: "{count} OPEN",
    open: "Open alerts · {count}",
    none: "No open alerts in this period",
    outside: { one: "# alert outside this period is still open", other: "# alerts outside this period are still open" },
    recentResolved: "Recently resolved",
    ack: "Acknowledge",
    resolve: "Resolve",
    detail: "Details",
    ackBy: "acked by {name}",
    needPerm: "Needs Operator or higher",
    ackNote: "Acknowledged from Overview",
    resolveNote: "Resolved from Overview",
    acked: "Acknowledged alert: {id}",
    resolvedToast: "Resolved alert: {id}",
  },
  incidents: {
    title: "Incidents",
    none: "No incidents in this period",
    commander: "commander {name}",
    started: "started {at}",
    ended: "ended {at}",
  },
} satisfies Messages<typeof ko>;

export default overview;
