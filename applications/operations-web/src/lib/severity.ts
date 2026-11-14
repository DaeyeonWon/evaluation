/**
 * Severity scale — the ONE place that maps a 0–100 criticality score to P0–P3.
 * Shared by the issue engine (M3 criticality scoring), the insight generator (M7) and every client screen
 * that draws P-level bands or offers a "min score" filter.
 *
 *   P0 ≥ 60 · P1 ≥ 45 · P2 ≥ 30 · P3 below
 *
 * Usage: severityOfScore(52) // "P1"
 */
import type { IssueSeverity } from "./types";

export const SEVERITY_THRESHOLDS = { P0: 60, P1: 45, P2: 30 } as const satisfies Record<Exclude<IssueSeverity, "P3">, number>;

/** ascending band edges (P2 → P0), for gauges, waterfalls and band markers */
export const SEVERITY_BANDS = [
  { at: SEVERITY_THRESHOLDS.P2, sev: "P2" },
  { at: SEVERITY_THRESHOLDS.P1, sev: "P1" },
  { at: SEVERITY_THRESHOLDS.P0, sev: "P0" },
] as const;

export function severityOfScore(score: number): IssueSeverity {
  return score >= SEVERITY_THRESHOLDS.P0 ? "P0" : score >= SEVERITY_THRESHOLDS.P1 ? "P1" : score >= SEVERITY_THRESHOLDS.P2 ? "P2" : "P3";
}
