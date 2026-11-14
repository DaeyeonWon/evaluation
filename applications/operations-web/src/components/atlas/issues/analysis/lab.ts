/**
 * Signal Lab (candidate C) — pure helpers: linked-view brush model, quadrant classification, colour
 * scales and a small word diff. No React here.
 *
 * Linked views: every mark writes the SHARED URL filters (useIssueFilters) so all views + the table
 * refetch together. Two lab-only brushes live in their own URL params because the API has no such
 * filter: `quad` (bubble quadrant) and `pat` (one new utterance pattern → its issue_ids).
 */
import type { Issue, IssueFactorKey, IssueSeverity, NewPattern, PatternKind } from "@/lib/types";
import { MATRIX_DIMS, MATRIX_METRICS, type MatrixDim, type MatrixMetric } from "../../issues-shared";

export const FACTOR_KEYS: IssueFactorKey[] = ["severity", "volume", "trend", "regression", "novelty", "reach"];
export const SEVERITIES: IssueSeverity[] = ["P0", "P1", "P2", "P3"];
export const KINDS: PatternKind[] = ["new_feature_name", "code_switch", "new_term", "new_phrasing"];

/* ───────── quadrants (bubble: x = FAIL volume, y = trend z) ───────── */
export type Quadrant = "act" | "watch" | "emerging" | "noise";
export const QUADRANTS: Quadrant[] = ["act", "emerging", "watch", "noise"];
/** z ≥ 2 ≈ significant spike vs baseline (Poisson) */
export const Z_CUT = 2;

export const trendZ = (i: Pick<Issue, "factors">): number => {
  const z = i.factors.find((f) => f.key === "trend")?.detail.z;
  return typeof z === "number" && Number.isFinite(z) ? z : 0;
};
export const reachValue = (i: Pick<Issue, "factors">): number => i.factors.find((f) => f.key === "reach")?.value ?? 0;
export const factor = (i: Pick<Issue, "factors">, k: IssueFactorKey) => i.factors.find((f) => f.key === k);

/** volume threshold: the 75th percentile of FAIL counts, at least 5 */
export function volumeCut(items: Pick<Issue, "count">[]): number {
  if (!items.length) return 5;
  const s = items.map((i) => i.count).sort((a, b) => a - b);
  return Math.max(5, s[Math.floor(s.length * 0.75)] ?? 5);
}

export function quadrantOf(i: Pick<Issue, "count" | "factors">, vCut: number): Quadrant {
  const hiV = i.count >= vCut;
  const hiZ = trendZ(i) >= Z_CUT;
  return hiV && hiZ ? "act" : hiZ ? "emerging" : hiV ? "watch" : "noise";
}

/* ───────── dims on an issue ───────── */
/** heatmap axes + treemap levels: MATRIX_DIMS, plus intent for the treemap */
export type LabDim = MatrixDim | "intent";
export const TREE_DIMS: LabDim[] = [...MATRIX_DIMS, "intent"];
export const OTHER = "__other__";

/**
 * Every value of `dim` an issue has FAIL rows in (multi-valued row dims use the issue's spread lists;
 * single-valued ones its signature / dominant value). Used for cross-filter membership.
 */
export function issueValues(i: Issue, dim: LabDim): string[] {
  switch (dim) {
    case "agent_function":
      return [i.signature.agent_function];
    case "failure_reason":
      return [i.signature.failure_reason];
    case "intent":
      return [i.signature.intent_expected];
    case "category":
      return [i.category];
    case "user_impact":
      return [i.user_impact_type];
    case "dev_miss":
      return [i.dev_miss_type];
    case "division":
      return i.divisions?.length ? i.divisions : [i.dominant.division];
    case "region":
      return i.regions?.length ? i.regions : [i.dominant.region];
    case "bixby_version":
      return i.bixby_versions?.length ? i.bixby_versions : [i.dominant.bixby_version];
    case "market":
      return i.markets;
    case "language":
      return i.languages;
    case "device":
      return i.devices;
    case "model_version":
      return i.model_versions;
    default:
      return [String(i.dominant[dim as keyof Issue["dominant"]] ?? "")];
  }
}
/** the ONE value an issue is filed under (treemap partition: each issue lands in exactly one leaf) */
export function issueValue(i: Issue, dim: LabDim): string {
  switch (dim) {
    case "agent_function":
    case "failure_reason":
    case "intent":
    case "category":
    case "user_impact":
    case "dev_miss":
      return issueValues(i, dim)[0];
    default:
      return String(i.dominant[dim as keyof Issue["dominant"]] ?? issueValues(i, dim)[0] ?? "");
  }
}

/* ───────── heatmap + treemap view state (URL: x, y, metric, hm, tree) ───────── */
export interface HeatPreset {
  id: "fnDivision" | "fnRegion" | "catVersion" | "impactDivision" | "missVersion";
  x: MatrixDim;
  y: MatrixDim;
}
/** rows (y) × columns (x) */
export const HEAT_PRESETS: HeatPreset[] = [
  { id: "fnDivision", x: "division", y: "agent_function" },
  { id: "fnRegion", x: "region", y: "agent_function" },
  { id: "catVersion", x: "bixby_version", y: "category" },
  { id: "impactDivision", x: "division", y: "user_impact" },
  { id: "missVersion", x: "bixby_version", y: "dev_miss" },
];
export const DEFAULT_X: MatrixDim = "division";
export const DEFAULT_Y: MatrixDim = "agent_function";
export const isMatrixDim = (v: string | null | undefined): v is MatrixDim => !!v && (MATRIX_DIMS as readonly string[]).includes(v);
export const isMetric = (v: string | null | undefined): v is MatrixMetric => !!v && (MATRIX_METRICS as readonly string[]).includes(v);

/** heatmap cell selection (`hm=<x value>|<y value>`); "__other__" = the folded values `xs` / `ys` */
export interface CellSel {
  x: MatrixDim;
  y: MatrixDim;
  xv: string;
  yv: string;
  /** concrete values behind the selection ("__other__" expands to its folded values) */
  xs: string[];
  ys: string[];
}
export const encodeCell = (xv: string, yv: string) => `${xv}|${yv}`;
export function decodeCell(raw: string | null): { xv: string; yv: string } | null {
  if (!raw) return null;
  const k = raw.indexOf("|");
  if (k <= 0 || k >= raw.length - 1) return null;
  return { xv: raw.slice(0, k), yv: raw.slice(k + 1) };
}

export interface TreeHier {
  id: "divisionFn" | "categoryFn" | "regionMarket" | "impactMiss" | "versionDivision";
  levels: [LabDim, LabDim, LabDim];
}
export const TREE_PRESETS: TreeHier[] = [
  { id: "divisionFn", levels: ["division", "agent_function", "failure_reason"] },
  { id: "categoryFn", levels: ["category", "agent_function", "intent"] },
  { id: "regionMarket", levels: ["region", "market", "agent_function"] },
  { id: "impactMiss", levels: ["user_impact", "dev_miss", "agent_function"] },
  { id: "versionDivision", levels: ["bixby_version", "division", "agent_function"] },
];
export function parseTree(raw: string | null): [LabDim, LabDim, LabDim] {
  const parts = (raw ?? "").split(",").filter(Boolean);
  const ok = parts.length === 3 && new Set(parts).size === 3 && parts.every((p) => (TREE_DIMS as string[]).includes(p));
  return ok ? (parts as [LabDim, LabDim, LabDim]) : TREE_PRESETS[0].levels;
}

/** treemap node brush: the path of (dim, value) pairs from the root */
export type TreeNode = { dim: LabDim; value: string }[];

/* ───────── lab brushes ───────── */
export interface LabBrush {
  quad: Quadrant | null;
  pattern: NewPattern | null;
  cell: CellSel | null;
  node: TreeNode | null;
}
export const brushActive = (b: LabBrush) => !!(b.quad || b.pattern || b.cell || b.node);

export function matchesCell(i: Issue, c: CellSel): boolean {
  const xs = issueValues(i, c.x);
  const ys = issueValues(i, c.y);
  return xs.some((v) => c.xs.includes(v)) && ys.some((v) => c.ys.includes(v));
}
export const matchesNode = (i: Issue, n: TreeNode) => n.every((p) => issueValue(i, p.dim) === p.value);

/** `skip` leaves out the brush a view owns (the bubble ignores its own quadrant brush, …) */
export function matchesBrush(i: Issue, b: LabBrush, vCut: number, skip?: "quad" | "node"): boolean {
  if (b.quad && skip !== "quad" && quadrantOf(i, vCut) !== b.quad) return false;
  if (b.pattern && !b.pattern.issue_ids.includes(i.id) && !i.patterns.some((p) => p.id === b.pattern!.id)) return false;
  if (b.cell && !matchesCell(i, b.cell)) return false;
  if (b.node && skip !== "node" && !matchesNode(i, b.node)) return false;
  return true;
}

/* ───────── colour scales (CSS colour strings; tokens are defined in atlas-issues-analysis.css) ───────── */
/** 0..1 position of `v` on a sequential scale 0..max */
const unit = (v: number, max: number) => Math.max(0, Math.min(1, v / (max > 0 ? max : 1)));
/** sequential heat: one hue (--issc-seq) mixed into the sheet, light → dark, 0..max */
export function seqFill(v: number | null, max: number): string {
  if (v == null) return "transparent";
  return `color-mix(in srgb, var(--issc-seq) ${Math.round(6 + unit(v, max) * 84)}%, var(--sheet))`;
}
/** diverging heat: --issc-down (better) ← neutral --issc-mid → --issc-up (worse), symmetric ±absMax */
export function divFill(v: number | null, absMax: number): string {
  if (v == null) return "transparent";
  const p = unit(Math.abs(v), absMax);
  if (p < 0.04) return "var(--issc-mid)";
  return `color-mix(in srgb, var(${v > 0 ? "--issc-up" : "--issc-down"}) ${Math.round(10 + p * 80)}%, var(--issc-mid))`;
}
/** ink on a heat cell: switch to inverse ink on the dark end */
export const seqInk = (v: number | null, max: number) => (v != null && unit(v, max) > 0.55 ? "var(--issc-seq-ink)" : "var(--ink)");
export const divInk = (v: number | null, absMax: number) => (v != null && unit(Math.abs(v), absMax) > 0.6 ? "var(--issc-seq-ink)" : "var(--ink)");

/* ───────── bubble colour-by ───────── */
export const COLOR_BY = ["impact", "category", "user_impact", "dev_miss", "division"] as const;
export type ColorBy = (typeof COLOR_BY)[number];
/** all-pairs-validated categorical slots (light + dark): the top values get these, the rest fold into Other */
export const CAT_SLOTS = 3;

export const sevVar = (s: IssueSeverity) => `var(--sev-${s.toLowerCase()})`;
export const kindVar = (k: PatternKind) => `var(--issc-k-${k})`;
export const deltaDir = (d: number | null | undefined) => (d == null || Math.abs(d) < 0.5 ? "flat" : d > 0 ? "up" : "down");

/* ───────── word diff (LCS) for utterance vs ASR / expected vs predicted ───────── */
export interface DiffTok {
  t: string;
  op: "same" | "add" | "del";
}
export function wordDiff(a: string, b: string, sep: RegExp = /(\s+)/): DiffTok[] {
  const A = a.split(sep).filter((x) => x !== "");
  const B = b.split(sep).filter((x) => x !== "");
  const n = A.length;
  const m = B.length;
  if (n * m > 4000) return [{ t: b, op: "same" }];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffTok[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ t: A[i], op: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: A[i++], op: "del" });
    else out.push({ t: B[j++], op: "add" });
  }
  while (i < n) out.push({ t: A[i++], op: "del" });
  while (j < m) out.push({ t: B[j++], op: "add" });
  return out;
}

/** dotted intent ids: common prefix + differing tail, e.g. galaxy_ai.now_brief vs qa.factoid */
export function intentDiff(expected: string, predicted: string): { common: string; exp: string; pred: string } {
  if (expected === predicted) return { common: expected, exp: "", pred: "" };
  const a = expected.split(".");
  const b = predicted.split(".");
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const common = a.slice(0, k).join(".");
  return { common: common ? common + "." : "", exp: a.slice(k).join("."), pred: b.slice(k).join(".") };
}

/** SVG polyline points for a sparkline in a w×h box */
export function sparkPath(vals: number[], w: number, h: number, pad = 1.5): string {
  if (!vals.length) return "";
  const max = Math.max(1, ...vals);
  const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
  return vals.map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`).join(" ");
}
