/**
 * inspector — canvas side inspector panel: stage/workflow details, KV labels (src/components/atlas/canvas/inspector.tsx).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/inspector.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("inspector")` · server `const t = await getT("inspector")`.
 */
const inspector = {};

export default inspector;
