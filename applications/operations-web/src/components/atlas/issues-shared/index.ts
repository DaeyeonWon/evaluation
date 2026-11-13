/**
 * Issue Report shared module — the ONLY layer candidates A/B/C (src/components/atlas/issues-a|b|c) use to
 * reach the issue data. Owned by the data/platform engineer; designers must not edit these files.
 *
 *   import { useIssueFilters, useIssues, useIssueSummary, useIssueFormat, useIssueLinks, useIssuePermission } from "../issues-shared";
 */
export * from "./filters";
export * from "./data";
export * from "./format";
export * from "./links";
export * from "./permissions";
export * from "./triage";
