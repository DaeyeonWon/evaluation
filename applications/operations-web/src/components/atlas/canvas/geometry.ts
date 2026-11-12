/**
 * Pure geometry for the Atlas blueprint (world units). Port of the prototype's layout()/edgesDef()/
 * computePositions(), re-measured for the larger node typography (title 16 / text 13.5 / mono 12.5,
 * 19-unit rows) and a tighter vertical rhythm so the default fit lands at a legible scale.
 */
import { DAG_TEMPLATE, LANG_CODES } from "@/lib/catalog";
import type { ActiveWorkflowPos, ComponentId, LangCode, StageId, Tone } from "@/lib/types";

export interface NodeBox {
  stage: StageId;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: boolean;
  i: number;
}
export type NodeId =
  | "gcs_input"
  | "event_bus"
  | "ingress"
  | "registry_queue"
  | "scheduler"
  | "workflows"
  | "vertex"
  | "results"
  | "res_csv"
  | "res_bq"
  | "retry"
  | "dlq"
  | "dlq_mgr"
  | "replay";
export type Layout = Record<NodeId, NodeBox>;

export const ROW = 19;
export const LANE_Y0 = 72;
export const LANE_H = 36;

export function layout(expanded: boolean): Layout {
  const v = expanded ? { x: 690, y: 392, w: 660, h: 372 } : { x: 1000, y: 392, w: 350, h: 236 };
  return {
    gcs_input: { stage: "gcs_input", x: 20, y: 66, w: 220, h: 212, title: "Event Producers", i: 0 },
    event_bus: { stage: "event_bus", x: 340, y: 90, w: 250, h: 168, title: "Eventarc · Pub/Sub", i: 1 },
    ingress: { stage: "ingress", x: 690, y: 50, w: 240, h: 240, title: "Event Ingress", i: 2 },
    registry_queue: { stage: "registry_queue", x: 1030, y: 40, w: 310, h: 276, title: "Firestore", i: 3 },
    scheduler: { stage: "scheduler", x: 1440, y: 40, w: 300, h: 276, title: "Language Scheduler", i: 4 },
    workflows: { stage: "workflows", x: 1470, y: 392, w: 270, h: 220, title: "Cloud Workflows", i: 5 },
    vertex: { stage: "vertex", title: "Vertex AI Pipelines", i: 6, ...v },
    results: { stage: "results", x: 1100, y: 818, w: 270, h: 204, title: "Result Commit", i: 7 },
    res_csv: { stage: "results", x: 1450, y: 808, w: 200, h: 96, title: "GCS · results.csv", sub: true, i: 8 },
    res_bq: { stage: "results", x: 1450, y: 920, w: 200, h: 96, title: "BigQuery", sub: true, i: 8 },
    retry: { stage: "retry", x: 360, y: 408, w: 250, h: 214, title: "Retry Controller", i: 9 },
    dlq: { stage: "dlq", x: 360, y: 818, w: 250, h: 218, title: "Dead Letter", i: 10 },
    dlq_mgr: { stage: "dlq", x: 20, y: 828, w: 260, h: 170, title: "DLQ Manager", i: 11 },
    replay: { stage: "dlq", x: 20, y: 408, w: 260, h: 128, title: "Manual Replay", i: 12 },
  };
}

export const LOOP_Y = 352;

type Pt = [number, number];
type Side = "l" | "r" | "t" | "b";
const pt = (N: Layout, id: NodeId, side: Side, f = 0.5): Pt => {
  const n = N[id];
  return side === "l" ? [n.x, n.y + n.h * f] : side === "r" ? [n.x + n.w, n.y + n.h * f] : side === "t" ? [n.x + n.w * f, n.y] : [n.x + n.w * f, n.y + n.h];
};
const curve = (a: Pt, b: Pt, horiz = true) => {
  const dx = (b[0] - a[0]) * 0.5;
  const dy = (b[1] - a[1]) * 0.5;
  return horiz
    ? `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`
    : `M${a[0]},${a[1]} C${a[0]},${a[1] + dy} ${b[0]},${b[1] - dy} ${b[0]},${b[1]}`;
};

/** i18n key under `orchestration.edges.*` ("" = unlabeled edge). */
export type EdgeLabelKey =
  | ""
  | "objectFinalized"
  | "cloudEventPush"
  | "register"
  | "admission"
  | "slotReserved"
  | "pipelineJob"
  | "success"
  | "failure"
  | "retryLoop"
  | "toDlq"
  | "approval"
  | "manualReplay";

export interface EdgeDef {
  k: string;
  d: string;
  label: EdgeLabelKey;
  lx: number;
  ly: number;
  anchor?: "start" | "middle" | "end";
  tone?: Tone;
  dashed?: boolean;
  i: number;
}

interface EOpt {
  as?: Side;
  bs?: Side;
  af?: number;
  bf?: number;
  tone?: Tone;
  i: number;
}

export function edgesDef(N: Layout): EdgeDef[] {
  const vx = N.vertex;
  const H = (a: NodeId, b: NodeId, label: EdgeLabelKey, o: EOpt): EdgeDef => {
    const A1 = pt(N, a, o.as ?? "r", o.af ?? 0.5);
    const B1 = pt(N, b, o.bs ?? "l", o.bf ?? 0.5);
    return { k: `${a}>${b}`, d: curve(A1, B1), label, lx: (A1[0] + B1[0]) / 2, ly: Math.min(A1[1], B1[1]) - 8, tone: o.tone, i: o.i };
  };
  const V = (a: NodeId, b: NodeId, label: EdgeLabelKey, o: EOpt): EdgeDef => {
    const A1 = pt(N, a, o.as ?? "b", o.af ?? 0.5);
    const B1 = pt(N, b, o.bs ?? "t", o.bf ?? 0.5);
    return { k: `${a}>${b}`, d: curve(A1, B1, false), label, lx: (A1[0] + B1[0]) / 2 + 9, ly: (A1[1] + B1[1]) / 2 + 4, anchor: "start", tone: o.tone, i: o.i };
  };
  const sw = pt(N, "scheduler", "b", 0.5);
  const wt = pt(N, "workflows", "t", 0.5);
  const wl = pt(N, "workflows", "l", 0.45);
  const vr: Pt = [vx.x + vx.w, vx.y + Math.min(72, vx.h * 0.3)];
  const vb: Pt = [vx.x + vx.w - 120, vx.y + vx.h];
  const rt: Pt = [vx.x + vx.w - 120, N.results.y];
  const fA: Pt = [vx.x, vx.y + 72];
  const fB = pt(N, "retry", "r", 0.3);
  const rA = pt(N, "retry", "r", 0.72);
  const rB: Pt = [vx.x, Math.max(vx.y + vx.h - 84, vx.y + 150)];
  const rp = pt(N, "replay", "t", 0.5);
  const rgx = N.registry_queue.x + 100;
  const rgB = N.registry_queue.y + N.registry_queue.h;
  return [
    H("gcs_input", "event_bus", "objectFinalized", { i: 1 }),
    H("event_bus", "ingress", "cloudEventPush", { i: 2 }),
    H("ingress", "registry_queue", "register", { bf: 0.46, i: 3 }),
    H("registry_queue", "scheduler", "admission", { i: 4 }),
    { k: "scheduler>workflows", d: curve(sw, wt, false), label: "slotReserved", lx: sw[0] + 14, ly: (sw[1] + wt[1]) / 2 + 4, anchor: "start", i: 5 },
    { k: "workflows>vertex", d: curve(wl, vr), label: "pipelineJob", lx: (wl[0] + vr[0]) / 2, ly: Math.min(wl[1], vr[1]) - 8, i: 6 },
    { k: "vertex>results", d: curve(vb, rt, false), label: "success", tone: "success", lx: vb[0] + 10, ly: (vb[1] + rt[1]) / 2 + 4, anchor: "start", i: 7 },
    { ...H("results", "res_csv", "", { af: 0.2, i: 8 }), tone: "success" },
    { ...H("results", "res_bq", "", { af: 0.72, i: 8 }), tone: "success" },
    { k: "vertex>retry", d: curve(fA, fB), label: "failure", tone: "failed", lx: (fA[0] + fB[0]) / 2, ly: Math.min(fA[1], fB[1]) - 8, i: 9 },
    { k: "retry>vertex", d: curve(rA, rB), label: "retryLoop", tone: "retry", lx: (rA[0] + rB[0]) / 2, ly: Math.max(rA[1], rB[1]) + 16, i: 9 },
    V("retry", "dlq", "toDlq", { tone: "dlq", i: 10 }),
    { ...H("dlq", "dlq_mgr", "", { as: "l", bs: "r", af: 0.5, bf: 0.55, i: 11 }), tone: "dlq" },
    V("dlq_mgr", "replay", "approval", { as: "t", bs: "b", tone: "retry", i: 12 }),
    {
      k: "dlq>registry_queue",
      d: `M${rp[0]},${rp[1]} L${rp[0]},${LOOP_Y + 14} Q${rp[0]},${LOOP_Y} ${rp[0] + 14},${LOOP_Y} L${rgx - 14},${LOOP_Y} Q${rgx},${LOOP_Y} ${rgx},${LOOP_Y - 14} L${rgx},${rgB}`,
      label: "manualReplay",
      tone: "retry",
      dashed: true,
      lx: 470,
      ly: LOOP_Y - 8,
      i: 13,
    },
  ];
}

/** transition (fromStage>toStage) → edge keys a comet travels along */
export function edgeKeysFor(from: string, to: string): string[] | null {
  const map: Record<string, string[]> = {
    "ingress>registry_queue": ["ingress>registry_queue"],
    "registry_queue>scheduler": ["registry_queue>scheduler"],
    "scheduler>workflows": ["scheduler>workflows"],
    "workflows>vertex": ["workflows>vertex"],
    "vertex>results": ["vertex>results", "results>res_csv"],
    "vertex>retry": ["vertex>retry"],
    "retry>vertex": ["retry>vertex"],
    "retry>scheduler": ["retry>vertex"],
    "vertex>dlq": ["vertex>retry", "retry>dlq", "dlq>dlq_mgr"],
    "retry>dlq": ["retry>dlq"],
    "null>ingress": ["gcs_input>event_bus", "event_bus>ingress"],
    "dlq>registry_queue": ["dlq>registry_queue"],
    "null>registry_queue": ["dlq>registry_queue"],
  };
  return map[`${from}>${to}`] ?? null;
}

/* ───────────── DAG inside the Vertex node ───────────── */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function dagLayout(n: NodeBox): Record<ComponentId, Rect> {
  const x0 = 22;
  const y0 = 66;
  const w = n.w - 44;
  const h = n.h - 134;
  const colW = w / 4;
  const bw = colW - 24;
  const bh = 62;
  const rowH = h / 3;
  const pos: Record<ComponentId, [number, number]> = {
    preprocess: [0, 1],
    intent_eval: [1, 0],
    response_eval: [1, 1],
    latency_check: [1, 2],
    aggregate: [2, 1],
    persist: [3, 1],
  };
  const out = {} as Record<ComponentId, Rect>;
  for (const [id, [c, r]] of Object.entries(pos) as [ComponentId, [number, number]][]) {
    out[id] = { x: x0 + c * colW + 6, y: y0 + r * rowH + (rowH - bh) / 2, w: bw, h: bh };
  }
  return out;
}
export const DAG_IDS = DAG_TEMPLATE.map((d) => d.id);

/* ───────────── token placement ───────────── */
export function slotRects(N: Layout): Record<string, Rect> {
  const at = (id: NodeId, dx: number, dy: number, w: number, h: number): Rect => ({ x: N[id].x + dx, y: N[id].y + dy, w, h });
  return {
    ingress: at("ingress", 12, 130, N.ingress.w - 24, 32),
    workflows: at("workflows", 12, 102, N.workflows.w - 24, 32),
    retry: at("retry", 12, 74, N.retry.w - 24, 42),
    dlq: at("dlq", 12, 74, N.dlq.w - 24, 42),
    results: at("results", 92, 66, 110, 32),
    vertex: at("vertex", 12, 58, N.vertex.w - 24, 64),
  };
}

function gridPos(rect: Rect, i: number, total: number, gap = 16): Pt | null {
  const cols = Math.max(1, Math.floor((rect.w - 6) / gap));
  const rows = Math.max(1, Math.floor((rect.h - 4) / gap));
  if (i >= cols * rows) return null;
  const c = i % cols;
  const rr = Math.floor(i / cols);
  return [rect.x + 11 + c * gap, rect.y + rect.h / 2 - ((Math.min(rows, Math.ceil(total / cols)) - 1) * gap) / 2 + rr * gap];
}

export interface Placed {
  pos: Map<string, Pt>;
  overflow: Record<string, number>;
}

export function computePositions(N: Layout, expanded: boolean, live: ActiveWorkflowPos[], lingering: { wf: ActiveWorkflowPos; stage: StageId }[]): Placed {
  const pos = new Map<string, Pt>();
  const overflow: Record<string, number> = {};
  const sr = slotRects(N);
  const groups: Record<string, ActiveWorkflowPos[]> = {};
  for (const w of live) (groups[w.stage] ??= []).push(w);
  for (const l of lingering) (groups["_" + l.stage] ??= []).push(l.wf);
  const put = (key: string, list: ActiveWorkflowPos[] | undefined, rect: Rect) =>
    (list ?? []).forEach((w, i) => {
      const p = gridPos(rect, i, list!.length);
      if (p) pos.set(w.workflow_id, p);
      else overflow[key] = (overflow[key] ?? 0) + 1;
    });
  put("ingress", groups.ingress, sr.ingress);
  put("workflows", groups.workflows, sr.workflows);
  put("retry", groups.retry, sr.retry);
  put("dlq", groups._dlq, sr.dlq);
  put("results", groups._results, sr.results);
  // queue lanes — priority desc, then oldest first
  const q = (groups.registry_queue ?? []).slice().sort((a, b) => b.priority - a.priority || (a.queued_at ?? 0) - (b.queued_at ?? 0));
  const rq = N.registry_queue;
  const maxN = Math.floor((rq.w - 24 - 82) / 14);
  LANG_CODES.forEach((c, li) => {
    const y = rq.y + LANE_Y0 + li * LANE_H + 15;
    q.filter((w) => w.language === c).forEach((w, i) => {
      if (i < maxN) pos.set(w.workflow_id, [rq.x + 84 + i * 14, y]);
      else overflow["q-" + c] = (overflow["q-" + c] ?? 0) + 1;
    });
  });
  const sc = N.scheduler;
  const maxS = Math.floor((sc.w - 24 - 90) / 14);
  LANG_CODES.forEach((c, li) => {
    const y = sc.y + LANE_Y0 + li * LANE_H + 15;
    (groups.scheduler ?? [])
      .filter((w) => w.language === c)
      .forEach((w, i) => {
        if (i < maxS) pos.set(w.workflow_id, [sc.x + 92 + i * 14, y]);
      });
  });
  const run = groups.vertex ?? [];
  if (expanded) {
    const L = dagLayout(N.vertex);
    const byNode: Record<string, ActiveWorkflowPos[]> = {};
    for (const w of run) (byNode[w.current_node ?? "preprocess"] ??= []).push(w);
    for (const [k, list] of Object.entries(byNode)) {
      const b = L[k as ComponentId] ?? L.preprocess;
      const cols = Math.floor((b.w - 10) / 13);
      list.forEach((w, i) => {
        if (i < cols) pos.set(w.workflow_id, [N.vertex.x + b.x + 9 + i * 13, N.vertex.y + b.y + b.h - 13]);
        else overflow["v-" + k] = (overflow["v-" + k] ?? 0) + 1;
      });
    }
  } else put("vertex", run, sr.vertex);
  return { pos, overflow };
}

export function overflowPos(N: Layout, key: string): Pt {
  if (key.startsWith("q-")) {
    const li = LANG_CODES.indexOf(key.slice(2) as LangCode);
    return [N.registry_queue.x + N.registry_queue.w - 16, N.registry_queue.y + LANE_Y0 + li * LANE_H + 19];
  }
  if (key.startsWith("v-")) {
    const b = dagLayout(N.vertex)[key.slice(2) as ComponentId];
    return [N.vertex.x + b.x + b.w - 4, N.vertex.y + b.y + b.h - 9];
  }
  const r = slotRects(N)[key] ?? { x: N.ingress.x, y: N.ingress.y, w: 40, h: 20 };
  return [r.x + r.w - 4, r.y + r.h - 4];
}

export function startPointFor(N: Layout, w: ActiveWorkflowPos, fallback: Pt): Pt {
  if (w.status === "RECEIVED") return [N.gcs_input.x + N.gcs_input.w - 20, N.gcs_input.y + 64];
  if (w.status === "QUEUED" && w.replay_cycle > 0) return [N.replay.x + N.replay.w / 2, N.replay.y];
  return fallback;
}

export function bounds(N: Layout) {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const n of Object.values(N)) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { x0: x0 - 24, y0: y0 - 34, x1: x1 + 24, y1: y1 + 28 };
}

/** The main (non-sub) node box of a stage — where badges, focus and the selection ring go. */
export function primaryNode(N: Layout, stage: StageId): NodeBox | undefined {
  return Object.values(N).find((x) => x.stage === stage && !x.sub);
}

/** Every node box of a stage (results → Result Commit + CSV + BigQuery; dlq → DLQ, manager, replay). */
export function stageNodes(N: Layout, stage: StageId): NodeId[] {
  return (Object.keys(N) as NodeId[]).filter((id) => N[id].stage === stage);
}

/** Union box of a stage's nodes (world units), padded. */
export function stageBox(N: Layout, stage: StageId, pad = 28): Rect | null {
  const ids = stageNodes(N, stage);
  if (!ids.length) return null;
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const id of ids) {
    const n = N[id];
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  return { x: x0 - pad, y: y0 - pad - 20, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + 20 };
}
