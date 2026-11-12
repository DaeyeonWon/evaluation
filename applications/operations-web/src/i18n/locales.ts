/**
 * Supported locales — isomorphic constants (no env access; safe to import from client code).
 * To add a locale: append here, add LOCALE_META, add src/i18n/messages/<locale>/ (see docs/i18n.md).
 */
export const LOCALES = ["ko", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export interface LocaleMeta {
  /** value for <html lang> and the `lang` attribute of the toggle option */
  htmlLang: string;
  /** BCP-47 tag for Intl.* (number/plural rules) */
  intl: string;
  /** short label in the toggle ("KO" / "EN") — the same in every UI locale */
  short: string;
  /** the language's own name (endonym), used as the toggle option's accessible name */
  native: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  ko: { htmlLang: "ko", intl: "ko-KR", short: "KO", native: "한국어" },
  en: { htmlLang: "en", intl: "en-US", short: "EN", native: "English" },
};

/** The cookie that stores the user's explicit choice (written by setLocale / LocaleToggle). */
export const LOCALE_COOKIE = "console_locale";
/** 1 year */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Locale used when nothing else resolves AND the base of message-file typing (ko is the schema). */
export const SCHEMA_LOCALE: Locale = "ko";
