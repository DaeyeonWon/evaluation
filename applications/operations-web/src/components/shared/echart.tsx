"use client";
/**
 * <EChart> — client-only Apache ECharts wrapper.
 *
 *   <EChart
 *     className="h-64"
 *     option={(t) => ({
 *       textStyle: { fontFamily: t.font },
 *       grid: { left: 40, right: 12, top: 16, bottom: 28 },
 *       xAxis: { type: "time", axisLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
 *       yAxis: { type: "value", splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
 *       series: LANG_CODES.map((l) => ({ type: "line", name: l, color: t.lang[l], data: … })),
 *     })}
 *     onEvents={{ click: (p) => … }}
 *   />
 *
 * - `option` may be an object or a function of ChartTokens; the function form is re-evaluated
 *   whenever <html data-theme> or the OS color scheme changes, so charts re-theme live.
 * - Tokens are read with getComputedStyle from the chart's own element, so a variant can scope
 *   them: --chart-text, --chart-muted, --chart-grid, --chart-surface, --chart-tooltip-bg,
 *   --chart-font, --chart-mono (fallbacks are provided in globals.css), plus --st-* and --lang-*.
 * - echarts is dynamically imported (kept out of the initial JS bundle). Resizes via ResizeObserver.
 * - Give the element a height (className/style) — ECharts cannot size itself.
 */
import clsx from "clsx";
import type { EChartsOption, ECharts, SetOptionOpts } from "echarts";
import { useEffect, useRef, type CSSProperties } from "react";
import { LANG_CODES, TONES } from "@/lib/catalog";
import { useT } from "@/i18n/client";
import type { LangCode, Tone } from "@/lib/types";

export interface ChartTokens {
  theme: "light" | "dark";
  text: string;
  muted: string;
  grid: string;
  surface: string;
  tooltipBg: string;
  font: string;
  mono: string;
  tone: Record<Tone, string>;
  lang: Record<LangCode, string>;
  /** read any other CSS custom property from the chart element (e.g. t.read("--accent")) */
  read: (name: string, fallback?: string) => string;
}

export type ChartOption = EChartsOption | ((t: ChartTokens) => EChartsOption);

export interface EChartProps {
  option: ChartOption;
  className?: string;
  style?: CSSProperties;
  renderer?: "canvas" | "svg";
  /** passed to setOption (default { notMerge: true }) */
  setOptionOpts?: SetOptionOpts;
  onEvents?: Record<string, (params: unknown, chart: ECharts) => void>;
  onReady?: (chart: ECharts) => void;
  loading?: boolean;
  /** accessible description of the chart (default: localized "Chart" / "차트") */
  ariaLabel?: string;
}

function readTokens(el: HTMLElement): ChartTokens {
  const cs = getComputedStyle(el);
  const read = (name: string, fallback = "") => cs.getPropertyValue(name).trim() || fallback;
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  return {
    theme,
    text: read("--chart-text", theme === "dark" ? "#dce4f0" : "#1f2430"),
    muted: read("--chart-muted", theme === "dark" ? "#8b95a7" : "#6b7280"),
    grid: read("--chart-grid", theme === "dark" ? "rgba(255,255,255,.08)" : "rgba(15,23,42,.08)"),
    surface: read("--chart-surface", theme === "dark" ? "#131c2b" : "#ffffff"),
    tooltipBg: read("--chart-tooltip-bg", theme === "dark" ? "#1b2536" : "#ffffff"),
    font: read("--chart-font", "Pretendard Variable, system-ui, sans-serif"),
    mono: read("--chart-mono", "ui-monospace, monospace"),
    tone: Object.fromEntries(TONES.map((t) => [t, read(`--st-${t}`)])) as Record<Tone, string>,
    lang: Object.fromEntries(LANG_CODES.map((l) => [l, read(`--lang-${l}`)])) as Record<LangCode, string>,
    read,
  };
}

export function EChart({ option, className, style, renderer = "canvas", setOptionOpts, onEvents, onReady, loading, ariaLabel }: EChartProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const optsRef = useRef(setOptionOpts);
  const eventsRef = useRef(onEvents);
  const readyRef = useRef(onReady);
  const t = useT("common");

  useEffect(() => {
    optionRef.current = option;
    optsRef.current = setOptionOpts;
    eventsRef.current = onEvents;
    readyRef.current = onReady;
  });

  const apply = () => {
    const el = elRef.current;
    const chart = chartRef.current;
    if (!el || !chart) return;
    const o = optionRef.current;
    const resolved = typeof o === "function" ? o(readTokens(el)) : o;
    chart.setOption(resolved, optsRef.current ?? { notMerge: true });
  };

  // init / dispose
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let mq: MediaQueryList | null = null;
    const onScheme = () => apply();
    void import("echarts").then((echarts) => {
      const el = elRef.current;
      if (disposed || !el) return;
      const chart = echarts.init(el, undefined, { renderer });
      chartRef.current = chart;
      // events proxy (always calls the latest handler)
      const names = Object.keys(eventsRef.current ?? {});
      for (const n of names) chart.on(n, (p: unknown) => eventsRef.current?.[n]?.(p, chart));
      apply();
      readyRef.current?.(chart);
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(el);
      mo = new MutationObserver(() => apply());
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onScheme);
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      mo?.disconnect();
      mq?.removeEventListener("change", onScheme);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [renderer]); // re-init only when the renderer changes

  // option changes
  useEffect(() => {
    apply();
  }, [option, setOptionOpts]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    if (loading) c.showLoading({ text: "", color: getComputedStyle(elRef.current!).getPropertyValue("--st-running").trim() || "#3987e5", maskColor: "transparent" });
    else c.hideLoading();
  }, [loading]);

  return <div ref={elRef} className={clsx("echart", className)} style={style} role="img" aria-label={ariaLabel ?? t("chart.defaultLabel")} aria-busy={loading || undefined} />;
}
