"use client";
/** Quality dashboard — ECharts helpers on top of ../chart (Atlas skin). */
import { kstParts } from "@/lib/format";
import type { ChartTokens } from "@/components/shared";

export function bucketLabel(ts: number, bucket: "hour" | "day"): string {
  const p = kstParts(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return bucket === "hour" ? `${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:00` : `${pad(p.mo)}-${pad(p.d)}`;
}
export function bucketTick(ts: number, bucket: "hour" | "day"): string {
  const p = kstParts(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return bucket === "hour" ? `${pad(p.h)}:00` : `${p.mo}/${p.d}`;
}

/** tooltip row: colored swatch (identity) + text-token label and value */
export function tipRow(t: ChartTokens, color: string | null, label: string, value: string): string {
  const sw = color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>` : "";
  return `<div style="display:flex;align-items:center;gap:10px;justify-content:space-between"><span style="color:${t.muted}">${sw}${esc(label)}</span><b style="font-family:${t.mono};color:${t.text};font-weight:600">${esc(value)}</b></div>`;
}
export function tipHead(t: ChartTokens, text: string): string {
  return `<div style="font-weight:700;color:${t.text};margin-bottom:4px">${esc(text)}</div>`;
}
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** y-axis floor for pass-rate charts: zoom in when every value is high, keep 0 otherwise */
export function rateFloor(values: (number | null)[]): number {
  const vs = values.filter((v): v is number => v != null);
  if (!vs.length) return 0;
  const lo = Math.min(...vs);
  return lo >= 60 ? Math.max(0, Math.floor((lo - 5) / 10) * 10) : 0;
}
