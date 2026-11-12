import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/fonts";
import { ThemeProvider, ThemeScript } from "@/components/shared/theme";
import { LiveStreamProvider } from "@/lib/client/live-stream";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AIPO · 빅스비 실발화 평가 운영 콘솔",
    template: "%s · AIPO",
  },
  description: "빅스비 실발화 평가 파이프라인(AIPO) 운영 대시보드 데모 — Mock 데이터로 동작합니다.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1018" },
  ],
};

/**
 * Root layout (shared — variants must not edit).
 * - all font CSS variables on <html>
 * - ThemeScript (pre-paint data-theme) + ThemeProvider
 * - LiveStreamProvider: ONE EventSource to /api/v1/stream for the whole app
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={fontVariables} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <ThemeProvider>
          <LiveStreamProvider>{children}</LiveStreamProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
