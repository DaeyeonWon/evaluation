/**
 * pipelines — Pipeline list / versions (/workflows index, pipeline version views).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/pipelines.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("pipelines")` · server `const t = await getT("pipelines")`.
 */
const pipelines = {};

export default pipelines;
