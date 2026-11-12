"use client";
/**
 * Client-side i18n.
 *
 *   const t = useT("dlq");            t("replay.confirm", { count: 3 })
 *   const locale = useLocale();       // "ko" | "en"
 *   const f = useFmt();               f.relative(ts, now) · f.duration(ms) · f.dateTimeLabel(ts)
 *   const { setLocale, isPending } = useSetLocale();   setLocale("en")
 *
 * <I18nProvider> is mounted ONCE by the root layout with the locale + messages resolved on the
 * server, so the first client render equals the server HTML (no hydration mismatch, no flash).
 * setLocale() writes the `console_locale` cookie, updates <html lang> immediately and calls
 * router.refresh(): server components (layout, metadata, provider props) re-render in the new
 * locale while client state (filters, scroll, open panels) is kept.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useTransition, type ReactNode } from "react";
import { createFmt, type LocaleFmt } from "@/lib/format";
import { createTranslator, type MessageKey, type MessageTree, type Translator } from "./core";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_META, SCHEMA_LOCALE, isLocale, type Locale } from "./locales";
import type { LocaleMessages, Namespace, Schema } from "./messages";

interface I18nContextValue {
  locale: Locale;
  messages: LocaleMessages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: LocaleMessages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

let warnedNoProvider = false;
function warnNoProvider() {
  if (warnedNoProvider || process.env.NODE_ENV === "production") return;
  warnedNoProvider = true;
  console.warn("[i18n] <I18nProvider> is not mounted — falling back to the default locale and rendering keys. See docs/i18n.md §7 (root layout).");
}

function useCtx(): I18nContextValue | null {
  const ctx = useContext(I18nContext);
  if (!ctx) warnNoProvider();
  return ctx;
}

/** Active UI locale. Without a provider → "ko" (+ one dev warning). */
export function useLocale(): Locale {
  return useCtx()?.locale ?? SCHEMA_LOCALE;
}

/** Translator for one namespace; stable across renders while the locale is unchanged. */
export function useT<N extends Namespace>(ns: N): Translator<MessageKey<Schema[N]>> {
  const ctx = useCtx();
  const locale = ctx?.locale ?? SCHEMA_LOCALE;
  const tree = ctx?.messages[ns] as MessageTree | undefined;
  return useMemo(() => createTranslator<MessageKey<Schema[N]>>(locale, tree, ns), [locale, tree, ns]);
}

/** Locale-bound formatters (see src/lib/format.ts). */
export function useFmt(): LocaleFmt {
  return createFmt(useLocale());
}

/** Persist the choice in the `console_locale` cookie (readable by the server on the next request). */
export function writeLocaleCookie(locale: Locale) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/** Switch the UI locale: cookie → <html lang> → router.refresh() (server components re-render). */
export function useSetLocale(): { locale: Locale; setLocale: (next: Locale) => void; isPending: boolean } {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const setLocale = useCallback(
    (next: Locale) => {
      if (!isLocale(next)) return;
      writeLocaleCookie(next);
      document.documentElement.lang = LOCALE_META[next].htmlLang;
      if (next === locale) return;
      startTransition(() => router.refresh());
    },
    [locale, router],
  );
  return { locale, setLocale, isPending };
}

/** Everything at once (locale, setLocale, isPending, fmt). */
export function useI18n() {
  const { locale, setLocale, isPending } = useSetLocale();
  return { locale, setLocale, isPending, fmt: createFmt(locale) };
}
