/** capacity — English. Must have exactly the keys of ../ko/capacity.ts (enforced by `satisfies`). */
import type { Messages } from "../../core";
import type ko from "../ko/capacity";

const capacity = {
  title: "Capacity by language",
  desc: "Changes are permission-checked, need a reason and a server impact analysis (dry run), then save with PATCH. Cards are LIVE; the trend charts follow the selected period.",
  acts: {
    config: "All settings",
  },
  card: {
    slotsAria: "Capacity Slots {active}/{max}",
    legend: "■ RUNNING {running} · ▨ RESERVED/DISPATCHING {reserved} · RETRY_WAIT {retry} (Slot released)",
    avgWait: "Avg wait",
    p95Title: "p95 wait time · SLO {min} min",
    throughput: "Throughput",
    uttPerHour: "Utterances/h",
    weightStarts: "Weight · starts/min",
    utilization: "Utilization",
    edit: "Edit settings",
    pause: "Pause",
    resume: "Resume",
    oldest: "Oldest wait {ago}",
    none: "none",
    pauseHint: "Check the Admission switch below, enter a reason and click \"Apply changes\" to make it take effect.",
  },
  stepper: {
    dec: "Decrease {label}",
    inc: "Increase {label}",
  },
  impact: {
    title: "Impact on running work",
    none: "No impact",
    idle: "Change a value and the server calculates the impact on running work.",
  },
  edit: {
    title: "Edit {lang} capacity",
    max: "Max concurrency",
    starts: "Starts per minute",
    weight: "Priority weight",
    pauseAria: "Pause Admission",
    paused: "Paused",
    running: "Running",
    tfDefault: "Terraform default maxConcurrent = {value}",
    noChange: "No changes",
    reason: "Reason (required · recorded in the audit log)",
    reasonPh: "e.g. Afternoon upload spike, ko p95 wait over SLO — INC-20261112-01",
    revert: "Revert",
    apply: "Apply changes",
    needPerm: "Needs the capacity:write permission (Operator or higher)",
    applied: "Applied settings: {lang} · {fields} · audit {audit}",
  },
  global: {
    applied: "Updated global settings: limit {max} · starts/min {starts}",
    summary: "Utilization {util} · starts/min {starts} · global Backlog {backlog} · sum of language limits {sum}",
    max: "Global limit",
    starts: "Starts/min",
    reason: "Reason (required)",
    reasonPh: "e.g. GPU quota raised from 16 to 24",
    apply: "Apply global",
    note: "Lowering the global limit doesn't stop running pipelines. The Terraform default is {tf}; when the runtime value differs, it shows up in the Drift list on the Config screen.",
  },
  history: {
    heading: "Capacity trend",
    peak: "Peak concurrency {active}/{limit} · peak queue per language",
    gran: {
      "5m": "per 5 min",
      "1h": "per hour",
      "6h": "per 6 hours",
    },
    activeTitle: "Concurrent Slots",
    activeRef: "Active by language (stacked) · dashed = global limit",
    activeAxis: "Active Slots",
    globalLimit: "Global limit",
    queueTitle: "Pending Queue depth",
    queueRef: "Waiting by language · Firestore pending_jobs",
    queueAxis: "Waiting",
    emptyHint: "No buckets in this period. Try a wider period.",
  },
  compare: {
    title: "Throughput by language",
    ref: "pipelines per hour · last 1 hour",
    label: "{value}/h · {utt} utt",
  },
} satisfies Messages<typeof ko>;

export default capacity;
