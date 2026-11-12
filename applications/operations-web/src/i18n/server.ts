/**
 * Server-side i18n — server components, layouts, generateMetadata, route handlers, server actions.
 * Never import this from a "use client" module (it imports next/headers and every message bundle).
 *
 *   // server component / layout / generateMetadata
 *   const locale = await getLocale();
 *   const t = await getT("nav");                 t("overview.title")
 *
 *   // route handler (no await needed when you have the request)
 *   const t = tFor(req, "errors");               t("domain.workflowNotFound", { id })
 *   const locale = localeFromRequest(req);
 *
 *   // root layout
 *   const { locale, messages } = await getI18nProps();
 *   <html lang={locale}> … <I18nProvider locale={locale} messages={messages}>
 */
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { createFmt, type LocaleFmt } from "@/lib/format";
import { resolveLocale } from "./config";
import type { MessageKey, Translator } from "./core";
import { LOCALE_COOKIE, type Locale } from "./locales";
import type { LocaleMessages, Namespace, Schema } from "./messages";
import { getMessages, translatorFor } from "./request";

export { localeFromRequest, getMessages, translatorFor, tFor } from "./request";
export type { Namespace, LocaleMessages } from "./messages";

/** Active locale for this request: cookie `console_locale` → Accept-Language → DEFAULT_LOCALE. Memoized per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale(c.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
});

/** Translator for `ns` in the request's locale (or an explicit one). */
export async function getT<N extends Namespace>(ns: N, locale?: Locale): Promise<Translator<MessageKey<Schema[N]>>> {
  return translatorFor(locale ?? (await getLocale()), ns);
}

/** Locale-bound formatters (fmt with the request locale applied). */
export async function getFmt(locale?: Locale): Promise<LocaleFmt> {
  return createFmt(locale ?? (await getLocale()));
}

/** Props for <I18nProvider> in the root layout. */
export async function getI18nProps(): Promise<{ locale: Locale; messages: LocaleMessages }> {
  const locale = await getLocale();
  return { locale, messages: getMessages(locale) };
}
