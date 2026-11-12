/**
 * ECharts option helpers in the Flowline style (port of baseOpt/axX/axY from the prototype),
 * driven by the shared ChartTokens so charts re-theme with light/dark.
 */
import type { EChartsOption } from "echarts";
import type { ChartTokens } from "@/components/shared";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function baseOpt(t: ChartTokens, o: EChartsOption): EChartsOption {
  const bg2 = t.read("--bg-2", t.tooltipBg);
  const line2 = t.read("--line-2", t.grid);
  return {
    animation: !reducedMotion(),
    animationDuration: 600,
    animationDurationUpdate: 500,
    textStyle: { fontFamily: t.font, color: t.text, fontSize: 11 },
    grid: { left: 8, right: 14, top: 30, bottom: 6, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: bg2,
      borderColor: line2,
      textStyle: { color: t.read("--text", t.text), fontSize: 12, fontFamily: t.font },
      axisPointer: { lineStyle: { color: line2 } },
      confine: true,
    },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 4, textStyle: { color: t.text, fontSize: 11, fontFamily: t.font } },
    ...o,
  };
}

export function itemTooltip(t: ChartTokens) {
  return {
    trigger: "item" as const,
    backgroundColor: t.read("--bg-2", t.tooltipBg),
    borderColor: t.read("--line-2", t.grid),
    textStyle: { color: t.read("--text", t.text), fontSize: 12, fontFamily: t.font },
    confine: true,
  };
}

export function axX(t: ChartTokens, data: (string | number)[], extra: Record<string, unknown> = {}) {
  return {
    type: "category" as const,
    data,
    axisLine: { lineStyle: { color: t.read("--line-2", t.grid) } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono },
    ...extra,
  };
}

export function axY(t: ChartTokens, extra: Record<string, unknown> = {}) {
  return {
    type: "value" as const,
    splitLine: { lineStyle: { color: t.grid, opacity: 0.8 } },
    axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono },
    ...extra,
  };
}

export const accent = (t: ChartTokens) => t.read("--accent", t.tone.running);
