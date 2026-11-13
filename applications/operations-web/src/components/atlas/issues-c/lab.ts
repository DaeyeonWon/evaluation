/**
 * Signal Lab (candidate C) — pure helpers: linked-view brush model, quadrant classification, colour
 * scales and a small word diff. No React here.
 *
 * Linked views: every mark writes the SHARED URL filters (useIssueFilters) so all views + the table
 * refetch together. Two lab-only brushes live in their own URL params because the API has no such
 * filter: `quad` (bubble quadrant) and `pat` (one new utterance pattern → its issue_ids).
 */
import type { Issue, IssueFactorKey, IssueSeverity, NewPattern, PatternKind } from "@/lib/types";

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

/* ───────── lab brushes ───────── */
export interface LabBrush {
  quad: Quadrant | null;
  pattern: NewPattern | null;
}

export function matchesBrush(i: Issue, b: LabBrush, vCut: number): boolean {
  if (b.quad && quadrantOf(i, vCut) !== b.quad) return false;
  if (b.pattern && !b.pattern.issue_ids.includes(i.id) && !i.patterns.some((p) => p.id === b.pattern!.id)) return false;
  return true;
}

/* ───────── colour scales (CSS colour strings; tokens are defined in atlas-issues-c.css) ───────── */
/** sequential heat: one hue (--issc-seq) mixed into the sheet, light → dark, by fail rate 0..max */
export function heatFill(rate: number | null, max: number): string {
  if (rate == null) return "transparent";
  const p = Math.max(0, Math.min(1, rate / Math.max(1, max)));
  return `color-mix(in srgb, var(--issc-seq) ${Math.round(6 + p * 84)}%, var(--sheet))`;
}
/** ink on a heat cell: switch to inverse ink on the dark end */
export const heatInk = (rate: number | null, max: number) => (rate != null && rate / Math.max(1, max) > 0.55 ? "var(--issc-seq-ink)" : "var(--ink)");

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
