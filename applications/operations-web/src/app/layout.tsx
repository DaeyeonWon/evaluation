import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/fonts";
import { ThemeProvider, ThemeScript } from "@/components/shared/theme";
import { LiveStreamProvider } from "@/lib/client/live-stream";
import { SessionProvider } from "@/lib/client/session";
import { getSession, sessionInfo } from "@/server/auth";
import { I18nProvider } from "@/i18n/client";
import { getI18nProps, getT } from "@/i18n/server";
import { LOCALE_META } from "@/i18n/locales";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("common");
  return {
    title: { default: `${t("app.productName")} · ${t("app.subtitle")}`, template: `%s · ${t("app.productName")}` },
    description: t("app.consoleName"),
    robots: { index: false, follow: false },
  };
}

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
 * - I18nProvider: locale from cookie / Accept-Language (src/i18n), messages passed from the server
 * - SessionProvider: the server-resolved session (src/server/auth) → useSession(); no client fetch
 * - LiveStreamProvider: ONE EventSource to /api/v1/stream for the whole app — only when signed in
 *   (the stream requires a session; /login and the 403 page don't need it)
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [session, { locale, messages }] = await Promise.all([getSession(), getI18nProps()]);
  return (
    <html lang={LOCALE_META[locale].htmlLang} className={fontVariables} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <I18nProvider locale={locale} messages={messages}>
        <ThemeProvider>
          <SessionProvider initial={sessionInfo(session)}>
            {session ? <LiveStreamProvider>{children}</LiveStreamProvider> : children}
          </SessionProvider>
        </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
