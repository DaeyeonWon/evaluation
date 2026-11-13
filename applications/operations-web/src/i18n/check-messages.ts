/**
 * Message parity check — run from applications/operations-web:
 *
 *   npm run i18n:check          (= tsx src/i18n/check-messages.ts; no Node type-stripping warnings)
 *   node --experimental-strip-types src/i18n/check-messages.ts      (also works on Node ≥ 22.6, but
 *                                                                   prints the typeless-module warning)
 *
 * Asserts, for every locale directory under src/i18n/messages and every namespace:
 *   1. the same namespace files exist in every locale, and all are registered in messages/index.ts
 *   2. identical deep key sets (TypeScript `satisfies` catches this too; this catches bypasses)
 *   3. ko (the schema) has only string leaves; other locales: string or plural { one, other, zero? }
 *   4. every locale uses the same {placeholders} as ko for each key (plural `#` counts as {count})
 * Exit code 1 on any problem. Under plain node, message files may only use `import type` (erased).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Tree = { [k: string]: unknown };

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "messages");
const SCHEMA = "ko";

const locales = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const problems: string[] = [];

const nsOf = (locale: string) =>
  readdirSync(join(root, locale))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3))
    .sort();

const isPlural = (v: unknown): v is { one: string; other: string; zero?: string } =>
  typeof v === "object" && v !== null && typeof (v as Tree).other === "string" && typeof (v as Tree).one === "string";

function leaves(tree: Tree, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" || isPlural(v)) out.set(key, v);
    else if (typeof v === "object" && v !== null) leaves(v as Tree, key, out);
    else out.set(key, v);
  }
  return out;
}

function placeholders(v: unknown): string[] {
  const texts = typeof v === "string" ? [v] : isPlural(v) ? [v.one, v.other, v.zero ?? ""] : [];
  const set = new Set<string>();
  for (const s of texts) {
    for (const m of s.replace(/\{\{|\}\}/g, "").matchAll(/\{(\w+)\}/g)) set.add(m[1]);
    if (isPlural(v) && s.includes("#")) set.add("count");
  }
  return [...set].sort();
}

async function load(locale: string, ns: string): Promise<Tree> {
  const mod = (await import(pathToFileURL(join(root, locale, `${ns}.ts`)).href)) as { default?: Tree };
  if (!mod.default || typeof mod.default !== "object") throw new Error(`${locale}/${ns}.ts has no default-exported object`);
  return mod.default;
}

async function main() {
  if (!locales.includes(SCHEMA)) throw new Error(`schema locale "${SCHEMA}" missing under ${root}`);
  const schemaNs = nsOf(SCHEMA);

  const index = readFileSync(join(root, "index.ts"), "utf8");
  const registered = /NAMESPACES = \[([^\]]*)\]/.exec(index)?.[1].match(/"(\w+)"/g)?.map((s) => s.slice(1, -1)).sort() ?? [];
  for (const ns of schemaNs) if (!registered.includes(ns)) problems.push(`index.ts: namespace "${ns}" not in NAMESPACES`);
  for (const ns of registered) if (!schemaNs.includes(ns)) problems.push(`index.ts: NAMESPACES has "${ns}" but ${SCHEMA}/${ns}.ts is missing`);

  let keyCount = 0;
  for (const locale of locales) {
    const list = nsOf(locale);
    for (const ns of schemaNs) if (!list.includes(ns)) problems.push(`${locale}: missing namespace file ${ns}.ts`);
    for (const ns of list) if (!schemaNs.includes(ns)) problems.push(`${locale}: extra namespace file ${ns}.ts (not in ${SCHEMA})`);
  }

  for (const ns of schemaNs) {
    const schema = leaves(await load(SCHEMA, ns));
    keyCount += schema.size;
    for (const [k, v] of schema) if (typeof v !== "string") problems.push(`${SCHEMA}/${ns}: "${k}" must be a plain string (ko has no plural forms)`);
    for (const locale of locales) {
      if (locale === SCHEMA || !nsOf(locale).includes(ns)) continue;
      const other = leaves(await load(locale, ns));
      for (const k of schema.keys()) if (!other.has(k)) problems.push(`${locale}/${ns}: missing key "${k}"`);
      for (const [k, v] of other) {
        if (!schema.has(k)) {
          problems.push(`${locale}/${ns}: extra key "${k}"`);
          continue;
        }
        if (typeof v !== "string" && !isPlural(v)) problems.push(`${locale}/${ns}: "${k}" must be a string or { one, other }`);
        const a = placeholders(schema.get(k)).join(",");
        const b = placeholders(v).join(",");
        if (a !== b) problems.push(`${locale}/${ns}: "${k}" placeholders {${b}} ≠ ${SCHEMA} {${a}}`);
      }
    }
  }

  if (problems.length) {
    console.error(`✗ i18n parity: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`✓ i18n parity: ${locales.join(", ")} · ${schemaNs.length} namespaces · ${keyCount} keys each`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
