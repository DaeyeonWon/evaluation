/**
 * Time-bucket selection for the Analytics charts. The API slices `fiveMin`, `hourly` and `daily`
 * to the period; we pick the bucket per chart (5-min for ≤ 24h, hourly for ≤ 7d, daily beyond) and
 * fall back to the nearest bucket that actually carries the metric. Never synthesises percentiles.
 */
import { LANG_CODES } from "@/lib/catalog";
import type { AnalyticsSummary, FailureCategory, Incident, LangCode } from "@/lib/types";
import type { Bucket } from "./kit";

const KST = 9 * 3600e3;
const pad = (n: number) => String(n).padStart(2, "0");
function kst(ts: number) {
  const d = new Date(ts + KST);
  return { mo: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()), h: pad(d.getUTCHours()), m: pad(d.getUTCMinutes()) };
}
const dayTs = (date: string) => Date.parse(date + "T00:00:00+09:00");

export const BUCKET_MS: Record<Bucket, number> = { "5m": 5 * 60e3, hour: 3600e3, day: 86400e3 };

export interface Series {
  bucket: Bucket;
  ts: number[];
  labels: string[];
}

/** Category-axis label for a bucket start; multi-day hourly/5m ranges carry the date. */
export function bucketLabels(ts: number[], bucket: Bucket): string[] {
  const multiDay = ts.length > 1 && ts[ts.length - 1] - ts[0] >= 86400e3;
  return ts.map((t) => {
    const p = kst(t);
    if (bucket === "day") return `${p.mo}-${p.d}`;
    return multiDay ? `${p.mo}-${p.d} ${p.h}:${p.m}` : `${p.h}:${p.m}`;
  });
}

/** Show ~8 labels whatever the length. */
export const labelInterval = (n: number) => Math.max(0, Math.ceil(n / 8) - 1);

const has5m = (s: AnalyticsSummary) => s.fiveMin.ts.length > 0;

/** Throughput by language — available at 5m (completed), hour, day. */
export function throughput(s: AnalyticsSummary, want: Bucket): Series & { byLang: Record<LangCode, number[]> } {
  if (want === "5m" && has5m(s)) return { bucket: "5m", ts: s.fiveMin.ts, labels: bucketLabels(s.fiveMin.ts, "5m"), byLang: s.fiveMin.completed };
  if (want === "day" && s.daily.length) {
    const ts = s.daily.map((d) => dayTs(d.date));
    return { bucket: "day", ts, labels: s.daily.map((d) => d.date.slice(5) + (d.partial ? "*" : "")), byLang: Object.fromEntries(LANG_CODES.map((l) => [l, s.daily.map((d) => d.pipelines[l] ?? 0)])) as Record<LangCode, number[]> };
  }
  return { bucket: "hour", ts: s.hourly.ts, labels: bucketLabels(s.hourly.ts, "hour"), byLang: s.hourly.throughput };
}

/** Success + Retry rate share one % axis. Retry exists hourly and daily only → 5m falls back to hour. */
export function rates(s: AnalyticsSummary, want: Bucket): Series & { success: (number | null)[]; retry: (number | null)[] } {
  if (want === "day" && s.daily.length) {
    return {
      bucket: "day",
      ts: s.daily.map((d) => dayTs(d.date)),
      labels: s.daily.map((d) => d.date.slice(5) + (d.partial ? "*" : "")),
      success: s.daily.map((d) => d.successRate),
      retry: s.daily.map((d) => (d.pipelines.total ? Math.min(1, d.retries / d.pipelines.total) : null)),
    };
  }
  return { bucket: "hour", ts: s.hourly.ts, labels: bucketLabels(s.hourly.ts, "hour"), success: s.hourly.successRate, retry: s.hourly.retryRate };
}

/** Durations exist hourly only. */
export function durations(s: AnalyticsSummary): Series & { avg: number[]; p95: number[] } {
  return { bucket: "hour", ts: s.hourly.ts, labels: bucketLabels(s.hourly.ts, "hour"), avg: s.hourly.avgDurationSec, p95: s.hourly.p95DurationSec };
}

/** Error categories over time: hourly counts, summed per KST day for the daily bucket. */
export function errorTrend(s: AnalyticsSummary, want: Bucket, cats: FailureCategory[]): Series & { byCat: Record<string, number[]> } {
  const h = s.hourly;
  if (want === "day") {
    const days: number[] = [];
    const ix = new Map<number, number>();
    h.ts.forEach((t) => {
      const d = Math.floor((t + KST) / 86400e3) * 86400e3 - KST;
      if (!ix.has(d)) {
        ix.set(d, days.length);
        days.push(d);
      }
    });
    const byCat = Object.fromEntries(
      cats.map((c) => {
        const arr = days.map(() => 0);
        h.ts.forEach((t, i) => {
          const d = Math.floor((t + KST) / 86400e3) * 86400e3 - KST;
          arr[ix.get(d)!] += h.errors[c]?.[i] ?? 0;
        });
        return [c, arr];
      }),
    );
    return { bucket: "day", ts: days, labels: bucketLabels(days, "day"), byCat };
  }
  return { bucket: "hour", ts: h.ts, labels: bucketLabels(h.ts, "hour"), byCat: Object.fromEntries(cats.map((c) => [c, h.errors[c] ?? []])) };
}

/** markArea pairs for incidents that overlap the series. */
export function incidentAreas(series: Series, incidents: Incident[], now: number) {
  if (!series.ts.length) return [];
  const w = BUCKET_MS[series.bucket];
  const first = series.ts[0];
  const last = series.ts[series.ts.length - 1] + w;
  const idx = (t: number) => {
    let i = 0;
    while (i < series.ts.length - 1 && series.ts[i + 1] <= t) i++;
    return i;
  };
  return incidents
    .filter((x) => x.started_at < last && (x.resolved_at ?? now) > first)
    .map((x) => [
      { xAxis: series.labels[idx(Math.max(first, x.started_at))], name: x.incident_id },
      { xAxis: series.labels[idx(Math.min(last - 1, x.resolved_at ?? now))] },
    ]);
}
