/**
 * board — live board / lane views of active Workflows (board widgets shared by canvas and overview).
 *
 * ko is the schema: add keys here first (plain strings, nested objects OK, no `as const`), then the
 * same keys in ../en/board.ts. Follow the glossary in docs/i18n.md (system terms stay English).
 * Usage: client `const t = useT("board")` · server `const t = await getT("board")`.
 */
const board = {};

export default board;
