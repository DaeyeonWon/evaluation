/**
 * Locale configuration (server-side values; env is read at server start).
 *
 *   CONSOLE_DEFAULT_LOCALE=en        default when there is no cookie and Accept-Language doesn't match
 *   CONSOLE_LOCALE_DETECTION=0       ignore Accept-Language (cookie → DEFAULT_LOCALE only)
 *
 * Resolution order (getLocale / localeFromRequest):
 *   1. cookie `console_locale` (the user's explicit KO/EN choice)
 *   2. Accept-Language (q-weighted, primary subtag match) — unless detection is disabled
 *   3. DEFAULT_LOCALE
 *
 * In the browser these env vars are undefined, so DEFAULT_LOCALE evaluates to "ko" there. Client code
 * never needs it: the active locale always comes from <I18nProvider locale=…> (resolved on the server).
 */
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALES, SCHEMA_LOCALE, type Locale } from "./locales";

export { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale };
export type { Locale };

const envLocale = typeof process !== "undefined" ? process.env.CONSOLE_DEFAULT_LOCALE?.trim().toLowerCase() : undefined;

/** Default locale: env CONSOLE_DEFAULT_LOCALE (if valid) → "ko". */
export const DEFAULT_LOCALE: Locale = isLocale(envLocale) ? envLocale : SCHEMA_LOCALE;

const envDetect = typeof process !== "undefined" ? process.env.CONSOLE_LOCALE_DETECTION?.trim().toLowerCase() : undefined;

/** Whether Accept-Language is consulted (default true). */
export const LOCALE_DETECTION = !(envDetect === "0" || envDetect === "false" || envDetect === "off");

/**
 * Pick the best supported locale from an Accept-Language header, or null.
 * "en-US,en;q=0.9,ko;q=0.8" → "en";  "fr-FR,ko;q=0.5" → "ko";  "fr" → null.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.lang && x.lang !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return null;
}

/** Pure resolution used by both server helpers (cookie value + Accept-Language → locale). */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (LOCALE_DETECTION) {
    const negotiated = negotiateLocale(acceptLanguage);
    if (negotiated) return negotiated;
  }
  return DEFAULT_LOCALE;
}
