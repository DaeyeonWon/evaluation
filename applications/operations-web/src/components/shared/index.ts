/**
 * Design-neutral shared primitives. Import from "@/components/shared".
 * Variants style these via CSS variables / data-attributes under their own [data-variant] scope.
 */
export { StatusPill, StatusIcon, TonePill, SeverityBadge, LangBadge, LangDot } from "./status";
export type { StatusPillProps, StatusIconProps } from "./status";
export { statusInfo, toneVar, langVar } from "./status-meta";
export type { StatusKind, StatusInfo } from "./status-meta";
export { LocaleToggle } from "./locale-toggle";
export type { LocaleToggleProps } from "./locale-toggle";
export { EChart } from "./echart";
export type { ChartTokens, ChartOption, EChartProps } from "./echart";
export { ThemeProvider, ThemeScript, ThemeToggle, ThemeSelect, useTheme, setThemePreference } from "./theme";
export type { ThemePreference, ResolvedTheme } from "./theme";
export { useTween, usePrefersReducedMotion } from "./motion";
export type { TweenOpts } from "./motion";
export { ICONS, iconFor, CatalogIcon } from "./icons";
export { fmt, createFmt, kstParts, kstDayStart } from "@/lib/format";
export type { LocaleFmt, FmtLocale } from "@/lib/format";
