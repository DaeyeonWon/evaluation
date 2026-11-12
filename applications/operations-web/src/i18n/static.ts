/**
 * Synchronous, provider-free labels for REFERENCE DATA (the `status` and `catalog` namespaces).
 * Isomorphic: works in server components, client components, route handlers, ECharts option
 * callbacks, CSV builders and plain functions — anywhere you have a `locale` but no React context.
 *
 *   statusLabel("workflow", "RUNNING", "en")      // "Running"
 *   statusHelp("dlq", "PENDING_REVIEW", "ko")     // "검토 대기 · 운영자 검토가 필요합니다"
 *   stageLabel("vertex", "ko")                    // "평가 Pipeline"
 *   capsuleLabel("weather", "en")                 // "Weather"   (also accepts the Korean label "날씨")
 *   languageName("ja", "en")                      // "Japanese"
 *   eventLabel("RETRY_SCHEDULED", "ko")           // "Retry 예약"
 *   const t = staticT("en", "status");  t("failureReason.SLOT_ERROR.label")
 *
 * Both locales of these two namespaces are bundled (a few KB) so shared components such as
 * <StatusPill> keep working even before/without <I18nProvider>. Every other namespace goes through
 * useT()/getT().
 */
import { createTranslator, type MessageKey, type MessageTree, type Translator } from "./core";
import type { Locale } from "./locales";
import { SCHEMA_LOCALE } from "./locales";
import koStatus from "./messages/ko/status";
import enStatus from "./messages/en/status";
import koCatalog from "./messages/ko/catalog";
import enCatalog from "./messages/en/catalog";

type StaticNs = "status" | "catalog";
type StaticSchema = { status: typeof koStatus; catalog: typeof koCatalog };

const STATIC: Record<Locale, Record<StaticNs, MessageTree>> = {
  ko: { status: koStatus, catalog: koCatalog },
  en: { status: enStatus as MessageTree, catalog: enCatalog as MessageTree },
};

const cache = new Map<string, Translator>();

/** Translator for `status` / `catalog` without a provider. */
export function staticT<N extends StaticNs>(locale: Locale, ns: N): Translator<MessageKey<StaticSchema[N]>> {
  const id = `${locale}:${ns}`;
  let t = cache.get(id);
  if (!t) {
    t = createTranslator(locale, STATIC[locale]?.[ns] ?? STATIC[SCHEMA_LOCALE][ns], ns);
    cache.set(id, t);
  }
  return t as Translator<MessageKey<StaticSchema[N]>>;
}

/** Status families in the `status` namespace that have { label, help }. */
export type StatusFamily =
  | "workflow"
  | "node"
  | "attempt"
  | "dlq"
  | "replay"
  | "reservation"
  | "alert"
  | "severity"
  | "capacity"
  | "service"
  | "version"
  | "result"
  | "role";

/** Display label of any status enum (unknown values → the raw value). */
export function statusLabel(family: StatusFamily, value: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "status").dynamic(`${family}.${value}.label`, undefined, value);
}

/** Explanation of a status enum (tooltip / legend). Unknown → "". */
export function statusHelp(family: StatusFamily, value: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "status").dynamic(`${family}.${value}.help`, undefined, "");
}

export function failureCategoryLabel(category: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "status").dynamic(`failureCategory.${category}.label`, undefined, category);
}

export function failureCategoryPolicy(category: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "status").dynamic(`failureCategory.${category}.policy`, undefined, "");
}

export function failureReasonLabel(reason: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "status").dynamic(`failureReason.${reason}.label`, undefined, reason);
}

export function stageLabel(stageId: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`stages.${stageId}.label`, undefined, stageId);
}

/** System name of a stage ("Cloud Run Event Ingress") — the same in every locale. */
export function stageService(stageId: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`stages.${stageId}.service`, undefined, stageId);
}

export function stageDescription(stageId: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`stages.${stageId}.description`, undefined, "");
}

export function componentLabel(componentId: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`components.${componentId}.label`, undefined, componentId);
}

export function componentDescription(componentId: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`components.${componentId}.description`, undefined, "");
}

export function eventLabel(eventType: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`events.${eventType}`, undefined, eventType);
}

/** Korean capsule label → id (API rows sometimes carry the Korean label, e.g. `capsule: "날씨"`). */
const CAPSULE_ID_BY_KO: Record<string, string> = Object.fromEntries(Object.entries(koCatalog.capsules).map(([id, ko]) => [ko, id]));
// the catalog data spells this one without a space
CAPSULE_ID_BY_KO["기기제어(SmartThings)"] = "device_control";

/** Capsule name by id (or by its Korean label). Unknown → the input. */
export function capsuleLabel(idOrKoLabel: string, locale: Locale = SCHEMA_LOCALE): string {
  const id = idOrKoLabel in koCatalog.capsules ? idOrKoLabel : CAPSULE_ID_BY_KO[idOrKoLabel];
  return id ? staticT(locale, "catalog").dynamic(`capsules.${id}`, undefined, idOrKoLabel) : idOrKoLabel;
}

export function deviceLabel(device: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`devices.${device}`, undefined, device);
}

/** Evaluation language name in the UI locale: languageName("ko","en") → "Korean". */
export function languageName(code: string, locale: Locale = SCHEMA_LOCALE): string {
  return staticT(locale, "catalog").dynamic(`languages.${code}`, undefined, code.toUpperCase());
}
