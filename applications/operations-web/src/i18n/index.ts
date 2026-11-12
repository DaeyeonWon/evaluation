/**
 * Isomorphic i18n entry (safe in server AND client modules).
 *   - server components / route handlers: import { getLocale, getT, tFor } from "@/i18n/server"
 *   - client components:                  import { useT, useLocale, useFmt, useSetLocale } from "@/i18n/client"
 *   - anywhere (reference data):          import { statusLabel, stageLabel, … } from "@/i18n"
 * See docs/i18n.md.
 */
export { LOCALES, LOCALE_META, LOCALE_COOKIE, isLocale, type Locale, type LocaleMeta } from "./locales";
export { createTranslator, interpolate, type Messages, type MessageKey, type PluralForms, type Translator, type Vars } from "./core";
export * from "./static";
export type { Namespace, Schema, LocaleMessages } from "./messages";
