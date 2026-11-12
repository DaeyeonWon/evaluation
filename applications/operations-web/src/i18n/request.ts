/**
 * Request-scoped helpers WITHOUT next/headers — for route handlers, src/proxy.ts and src/server/http.ts.
 * (server.ts re-exports these; import from here when next/headers / React must not be pulled in.)
 *
 *   const locale = localeFromRequest(req);
 *   const t = tFor(req, "errors");     t("code.FORBIDDEN")
 */
import { resolveLocale } from "./config";
import { createTranslator, type MessageKey, type MessageTree, type Translator } from "./core";
import { LOCALE_COOKIE, type Locale } from "./locales";
import { MESSAGES, type LocaleMessages, type Namespace, type Schema } from "./messages";

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Locale of a Request: cookie `console_locale` → Accept-Language → DEFAULT_LOCALE. Sync. */
export function localeFromRequest(req: Request): Locale {
  return resolveLocale(readCookie(req.headers.get("cookie"), LOCALE_COOKIE), req.headers.get("accept-language"));
}

/** Every namespace of one locale (what the root layout passes to <I18nProvider>). */
export function getMessages(locale: Locale): LocaleMessages {
  return MESSAGES[locale];
}

/** Translator for `ns` in an explicit locale (sync). */
export function translatorFor<N extends Namespace>(locale: Locale, ns: N): Translator<MessageKey<Schema[N]>> {
  return createTranslator<MessageKey<Schema[N]>>(locale, MESSAGES[locale][ns] as MessageTree, ns);
}

/** Translator for `ns` in the locale of `req`. */
export function tFor<N extends Namespace>(req: Request, ns: N): Translator<MessageKey<Schema[N]>> {
  return translatorFor(localeFromRequest(req), ns);
}
