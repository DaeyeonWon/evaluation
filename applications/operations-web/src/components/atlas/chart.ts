/** ECharts option helpers for the Atlas skin (reads tokens from <EChart>'s ChartTokens). */
import type { ChartTokens } from "@/components/shared";

type O = Record<string, unknown>;

export function baseOpt(t: ChartTokens, reduced: boolean, extra: O = {}): O {
  return {
    animationDuration: reduced ? 0 : 700,
    animationDurationUpdate: reduced ? 0 : 500,
    textStyle: { fontFamily: t.font, color: t.muted },
    grid: { left: 46, right: 14, top: 32, bottom: 28, containLabel: false },
    tooltip: tooltip(t),
    legend: { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: t.muted, fontSize: 11, fontFamily: t.font } },
    ...extra,
  };
}

export function tooltip(t: ChartTokens, extra: O = {}): O {
  return {
    trigger: "axis",
    backgroundColor: t.tooltipBg,
    borderColor: t.read("--rule"),
    textStyle: { color: t.text, fontSize: 12, fontFamily: t.font },
    axisPointer: { lineStyle: { color: t.muted, type: "dashed" } },
    ...extra,
  };
}

export function axisX(t: ChartTokens, data: (string | number)[], extra: O = {}): O {
  return {
    type: "category",
    data,
    boundaryGap: false,
    axisLine: { lineStyle: { color: t.read("--rule") } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono },
    ...extra,
  };
}

export function axisY(t: ChartTokens, extra: O = {}): O {
  return {
    type: "value",
    splitLine: { lineStyle: { color: t.grid } },
    axisLine: { show: false },
    axisLabel: { color: t.muted, fontSize: 10, fontFamily: t.mono },
    nameTextStyle: { color: t.muted, fontSize: 10, align: "left" },
    ...extra,
  };
}

export function catY(t: ChartTokens, data: string[], extra: O = {}): O {
  return {
    type: "category",
    inverse: true,
    data,
    axisLine: { lineStyle: { color: t.read("--rule") } },
    axisTick: { show: false },
    axisLabel: { color: t.text, fontSize: 11.5, fontFamily: t.font },
    ...extra,
  };
}

export const barLabel = (t: ChartTokens): O => ({ show: true, position: "right", color: t.text, fontFamily: t.mono, fontSize: 10.5 });

export const verColor = (t: ChartTokens, v: string) => (v === "v1.0" ? t.read("--ver-1") : v === "v1.1" ? t.read("--ver-2") : t.read("--ver-3"));

/** Escape hatch for strict ECharts callback typings (formatters etc.). */
export const opt = (o: object) => o as import("echarts").EChartsOption;
