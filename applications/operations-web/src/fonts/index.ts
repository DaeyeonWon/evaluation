/**
 * Fonts — self-hosted via next/font (no runtime requests to Google; files are emitted under
 * /_next/static/media). Every font exposes a CSS variable; the root layout puts ALL variables on
 * <html>, and each variant picks its own via `font-family: var(--font-…)` (or the Tailwind
 * utilities font-flowline / font-atlas / font-lanes … defined in globals.css).
 *
 * Only Pretendard is preloaded (landing page + Flowline + Lanes body). The others declare
 * @font-face only, so a page downloads just the faces it actually renders.
 *
 *   Flowline : --font-flowline-sans (Pretendard Variable 45–920) · --font-flowline-mono (JetBrains Mono)
 *   Atlas    : --font-atlas-sans (SUIT Variable 100–900)         · --font-atlas-mono (IBM Plex Mono 400/500/600)
 *   Lanes    : --font-lanes-display (Wanted Sans Variable 400–1000) · --font-lanes-sans (Pretendard Variable)
 *              · --font-lanes-mono (Fira Code)
 */
import localFont from "next/font/local";
import { Fira_Code, IBM_Plex_Mono, JetBrains_Mono } from "next/font/google";

// NOTE: next/font options must be inline literals (no shared constants).

// ── Pretendard Variable (shared by Flowline sans + Lanes sans; one font file, two variables)
export const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  weight: "45 920",
  style: "normal",
  display: "swap",
  variable: "--font-pretendard",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "system-ui", "sans-serif"],
  preload: true,
});

// ── SUIT Variable (Atlas)
export const suit = localFont({
  src: "../../node_modules/@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-atlas-sans",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "system-ui", "sans-serif"],
  preload: false,
});

// ── Wanted Sans Variable (Lanes display)
export const wantedSans = localFont({
  src: "../../node_modules/wanted-sans/fonts/webfonts/variable/complete/woff2/WantedSansVariable.woff2",
  weight: "400 1000",
  style: "normal",
  display: "swap",
  variable: "--font-lanes-display",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "system-ui", "sans-serif"],
  preload: false,
});

// ── Monospace (Google, self-hosted at build time)
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-flowline-mono",
  display: "swap",
  preload: false,
  fallback: ["SFMono-Regular", "Menlo", "Consolas", "D2Coding", "monospace"],
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-atlas-mono",
  display: "swap",
  preload: false,
  fallback: ["SFMono-Regular", "Menlo", "Consolas", "D2Coding", "monospace"],
});

export const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-lanes-mono",
  display: "swap",
  preload: false,
  fallback: ["SFMono-Regular", "Menlo", "Consolas", "D2Coding", "monospace"],
});

/** All font variable classes — applied on <html> in the root layout. */
export const fontVariables = [pretendard, suit, wantedSans, jetbrainsMono, ibmPlexMono, firaCode].map((f) => f.variable).join(" ");

/**
 * Per-variant font-family stacks (also available as CSS vars, see globals.css):
 *   --font-flowline-sans = var(--font-pretendard)
 *   --font-lanes-sans    = var(--font-pretendard)
 */
export const fontFamilies = {
  landing: "var(--font-pretendard)",
  flowline: { sans: "var(--font-flowline-sans)", mono: "var(--font-flowline-mono)" },
  atlas: { sans: "var(--font-atlas-sans)", mono: "var(--font-atlas-mono)" },
  lanes: { display: "var(--font-lanes-display)", sans: "var(--font-lanes-sans)", mono: "var(--font-lanes-mono)" },
} as const;
