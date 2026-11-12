/**
 * i18n core — isomorphic, dependency-free, no `next` imports (safe in server, client and plain node).
 *
 *   const t = createTranslator("en", messages.en.common, "common");
 *   t("actions.cancel")                         // "Cancel"
 *   t("units.workflows", { count: 3 })          // "3 workflows"   (en plural forms)
 *   t("search.noMatch", { q: "ko-0022" })       // "{q}" interpolation
 *
 * Message files (src/i18n/messages/{ko,en}/<ns>.ts):
 *   - ko is the SCHEMA: a plain object (no `as const`) whose leaves are strings.
 *   - en must be `{...} satisfies Messages<typeof ko>` → missing AND excess keys are compile errors.
 *   - en leaves may be plural objects `{ one, other, zero? }` (selected with Intl.PluralRules by `count`).
 *     Korean has no plural forms; ko leaves are always strings.
 *   - Interpolation: `{name}` → vars.name. Unknown placeholders stay as-is. Use `{{` / `}}` for literal braces.
 */
import type { Locale } from "./locales";

export { LOCALES, isLocale, LOCALE_META } from "./locales";
export type { Locale } from "./locales";

/** Plural forms (en). `count` selects the form; `#` inside a form is replaced by the formatted count. */
export interface PluralForms {
  zero?: string;
  one: string;
  other: string;
}

/** Map the ko schema (string leaves) to the shape another locale must provide. */
export type Messages<T> = {
  [K in keyof T]: T[K] extends string ? string | PluralForms : Messages<T[K]>;
};

/** Message tree as stored at runtime. */
export interface MessageTree {
  [key: string]: string | PluralForms | MessageTree;
}

/** Dot paths to every leaf of a ko namespace object, e.g. "actions.cancel" | "workflow.RUNNING.label". */
export type MessageKey<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageKey<T[K]>}`;
    }[keyof T & string];

export type Vars = Record<string, string | number | null | undefined>;

/** Translate function bound to one namespace. `has()` checks existence without warning. */
export interface Translator<K extends string = string> {
  (key: K, vars?: Vars): string;
  has(key: string): boolean;
  /** Same as t() but for keys computed at runtime (no compile-time check). Returns `fallback` if missing. */
  dynamic(key: string, vars?: Vars, fallback?: string): string;
  readonly locale: Locale;
  readonly ns: string;
}

function isPlural(v: unknown): v is PluralForms {
  // both `one` and `other` must be strings (same rule as check-messages.ts), so a group that merely has
  // an `other` key (e.g. { quota: "…", other: "기타" }) is still traversed as a group
  return typeof v === "object" && v !== null && typeof (v as PluralForms).one === "string" && typeof (v as PluralForms).other === "string";
}

export function lookup(tree: MessageTree | undefined, key: string): string | PluralForms | undefined {
  if (!tree) return undefined;
  let cur: unknown = tree;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object" || isPlural(cur)) return undefined;
    cur = (cur as MessageTree)[part];
  }
  return typeof cur === "string" || isPlural(cur) ? cur : undefined;
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  let pr = pluralRules.get(locale);
  if (!pr) {
    pr = new Intl.PluralRules(locale);
    pluralRules.set(locale, pr);
  }
  return pr.select(n);
}

const numberFmt = new Intl.NumberFormat("en-US");

/** Format a value for interpolation: numbers get thousands separators (same in ko and en). */
function show(v: string | number | null | undefined): string {
  if (v == null) return "";
  return typeof v === "number" && Number.isFinite(v) ? numberFmt.format(v) : String(v);
}

export function interpolate(template: string, vars?: Vars): string {
  if (!template.includes("{")) return template;
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, name: string | undefined) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    if (!vars || !name || !(name in vars)) return m;
    return show(vars[name]);
  });
}

export function format(locale: Locale, value: string | PluralForms, vars?: Vars): string {
  if (typeof value === "string") return interpolate(value, vars);
  const count = Number(vars?.count ?? 0);
  const form = count === 0 && value.zero != null ? value.zero : pluralCategory(locale, count) === "one" ? value.one : value.other;
  return interpolate(form.replace(/#/g, show(count)), vars);
}

const warned = new Set<string>();
export function warnMissing(locale: string, ns: string, key: string) {
  if (process.env.NODE_ENV === "production") return;
  const id = `${locale}:${ns}.${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] missing message "${ns}.${key}" for locale "${locale}" — rendering the key. Add it to src/i18n/messages/{ko,en}/${ns}.ts`);
}

/**
 * Build a translator for one namespace. Missing key → dev console warning + returns "ns.key".
 * `tree` may be undefined (namespace not loaded) — every lookup then falls back to the key.
 */
export function createTranslator<K extends string = string>(locale: Locale, tree: MessageTree | undefined, ns: string): Translator<K> {
  const t = ((key: string, vars?: Vars) => {
    const v = lookup(tree, key);
    if (v === undefined) {
      warnMissing(locale, ns, key);
      return `${ns}.${key}`;
    }
    return format(locale, v, vars);
  }) as unknown as Translator<K>;
  t.has = (key: string) => lookup(tree, key) !== undefined;
  t.dynamic = (key: string, vars?: Vars, fallback?: string) => {
    const v = lookup(tree, key);
    if (v === undefined) {
      if (fallback !== undefined) return fallback;
      warnMissing(locale, ns, key);
      return `${ns}.${key}`;
    }
    return format(locale, v, vars);
  };
  Object.defineProperty(t, "locale", { value: locale });
  Object.defineProperty(t, "ns", { value: ns });
  return t;
}
