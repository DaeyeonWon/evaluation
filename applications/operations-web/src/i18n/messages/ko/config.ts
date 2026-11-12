/**
 * config — S-06 Operations config: limits, retry/timeouts, services, alert policies, drift, audit (src/components/atlas/config.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/config.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("config")` · server `const t = await getT("config")`.
 */
const config = {};

export default config;
