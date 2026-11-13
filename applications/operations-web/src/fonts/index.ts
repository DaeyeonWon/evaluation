/**
 * Fonts — self-hosted via next/font (no runtime requests to Google; files are emitted under
 * /_next/static/media). The root layout puts both CSS variables on <html>; Atlas reads them through
 * its tokens (src/styles/atlas.css: --f-ui / --f-mono) and globals.css uses the sans face as the
 * page default (login, 403 and anything outside the Atlas shell).
 *
 *   --font-atlas-sans : SUIT Variable 100–900 (complete Hangul + Latin; UI text in both locales)
 *   --font-atlas-mono : IBM Plex Mono 400/500/600 (IDs, code, numbers)
 *
 * SUIT is preloaded (every page renders it); Plex Mono declares @font-face only.
 */
import localFont from "next/font/local";
import { IBM_Plex_Mono } from "next/font/google";

// NOTE: next/font options must be inline literals (no shared constants).

export const suit = localFont({
  src: "../../node_modules/@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-atlas-sans",
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "system-ui", "sans-serif"],
  preload: true,
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-atlas-mono",
  display: "swap",
  preload: false,
  fallback: ["SFMono-Regular", "Menlo", "Consolas", "D2Coding", "monospace"],
});

/** All font variable classes — applied on <html> in the root layout. */
export const fontVariables = [suit, ibmPlexMono].map((f) => f.variable).join(" ");
