/**
 * Design-neutral shared primitives. Import from "@/components/shared".
 * Variants style these via CSS variables / data-attributes under their own [data-variant] scope.
 */
export { StatusPill, StatusIcon, TonePill, SeverityBadge, LangBadge, LangDot, statusInfo, toneVar, langVar } from "./status";
export type { StatusKind, StatusPillProps, StatusIconProps } from "./status";
export { EChart } from "./echart";
export type { ChartTokens, ChartOption, EChartProps } from "./echart";
export { ThemeProvider, ThemeScript, ThemeToggle, ThemeSelect, useTheme, setThemePreference } from "./theme";
export type { ThemePreference, ResolvedTheme } from "./theme";
export { useTween, usePrefersReducedMotion } from "./motion";
export type { TweenOpts } from "./motion";
export { ICONS, iconFor, CatalogIcon } from "./icons";
export { fmt, kstParts, kstDayStart } from "@/lib/format";
