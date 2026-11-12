/**
 * Board model: state-machine columns, card shape, small helpers. Pure data (no React).
 */
import { STATUS_META } from "@/lib/catalog";
import type { ActiveWorkflowPos, LangCode, StageId, Tone, WorkflowStatus, WorkflowSummary } from "@/lib/types";

export type ColId = "intake" | "queue" | "reserve" | "run" | "retry" | "done" | "dlq";
export interface BoardCol {
  id: ColId;
  k: string;
  states: WorkflowStatus[];
  /** stages shown in the inspector for this column (first = default) */
  stages: StageId[];
  tone: Tone;
  icon: string;
  /** max cards rendered per cell (rest → "+n") */
  cap: number;
  mini?: boolean;
  /** terminal column: ranged, newest first */
  ranged?: boolean;
}

export const COLS: BoardCol[] = [
  { id: "intake", k: "01", states: ["RECEIVED", "VALIDATED"], stages: ["ingress", "event_bus", "gcs_input"], tone: "queued", icon: "shield-check", cap: 6 },
  { id: "queue", k: "02", states: ["QUEUED"], stages: ["registry_queue"], tone: "queued", icon: "list-ordered", cap: 8, mini: true },
  { id: "reserve", k: "03", states: ["RESERVED"], stages: ["scheduler"], tone: "queued", icon: "lock", cap: 6 },
  { id: "run", k: "04", states: ["DISPATCHING", "RUNNING"], stages: ["vertex", "workflows"], tone: "running", icon: "cpu", cap: 12 },
  { id: "retry", k: "05", states: ["RETRY_WAIT"], stages: ["retry"], tone: "retry", icon: "rotate-ccw", cap: 6 },
  { id: "done", k: "06", states: ["SUCCEEDED"], stages: ["results"], tone: "success", icon: "file-check", cap: 3, ranged: true },
  { id: "dlq", k: "07", states: ["DEAD_LETTERED", "CANCELLED", "TIMED_OUT"], stages: ["dlq", "workflows"], tone: "dlq", icon: "archive-x", cap: 3, ranged: true },
];
export const COL_OF: Partial<Record<WorkflowStatus, number>> = {};
COLS.forEach((c, i) => c.states.forEach((s) => (COL_OF[s] = i)));

export const toneOf = (s: WorkflowStatus): Tone => STATUS_META[s]?.tone ?? "queued";
export const iconOf = (s: WorkflowStatus): string => STATUS_META[s]?.icon ?? "circle";

export interface Card {
  id: string;
  language: LangCode;
  status: WorkflowStatus;
  pct: number;
  current_node: string | null;
  node_path: string | null;
  attempt: number;
  priority: number;
  replay: boolean;
  queued_at: number | null;
  retry_at: number | null;
  updated_at: number;
  completed_at: number | null;
  errorCode: string | null;
  passRate: number | null;
  processed: number | null;
  total: number | null;
  pipeline_id: string | null;
  batch_id: string | null;
  object: string | null;
}

export function toCard(s: WorkflowSummary | undefined, a: ActiveWorkflowPos | undefined): Card {
  const b = (a ?? s)!;
  return {
    id: b.workflow_id,
    language: b.language,
    status: b.status,
    pct: a ? a.pct : s ? s.progress.pct : 0,
    current_node: b.current_node,
    node_path: s?.current_node_path ?? null,
    attempt: b.attempt,
    priority: b.priority,
    replay: (a ? a.replay_cycle : (s?.replay_cycle ?? 0)) > 0 || !!s?.replay_of,
    queued_at: b.queued_at,
    retry_at: b.retry_at,
    updated_at: b.updated_at,
    completed_at: s?.completed_at ?? null,
    errorCode: s?.error?.code ?? s?.lastErrorCode ?? null,
    passRate: s?.result?.passRate ?? null,
    processed: s?.progress.processed ?? null,
    total: s?.progress.total ?? null,
    pipeline_id: s?.pipeline_id ?? null,
    batch_id: s?.batch_id ?? null,
    object: s?.input.object ?? null,
  };
}

/** "bixby-eval-full" → "full", "bixby-regression-nightly" → "regression-nightly", "tts-quality" → "tts-quality" */
export const shortPipe = (id: string | null) => (id ? id.replace(/^bixby-eval-/, "").replace(/^bixby-/, "") : "—");
/** "wf-20261112-ko-0033" → "ko-0033" */
export const shortWf = (id: string) => id.replace(/^wf-\d{8}-/, "");
