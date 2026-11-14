/**
 * Issue Report shared module — the ONLY layer the views (src/components/atlas/issues/*) and the frame use
 * to reach issue data, URL filters, dims, links, formatting and triage. Owned by the framework engineer
 * (filters/dims/links/contract) and the data engineer (data/format/triage); see docs/issue-report-frame.md.
 *
 *   import { useIssueFilters, useIssueViewLinks, useDimLabel, useIssueBreakdown, useIssueFormat } from "../../issues-shared";
 */
export * from "./filters";
export * from "./dims";
export * from "./contract";
export * from "./data";
export * from "./format";
export * from "./links";
export * from "./permissions";
export * from "./triage";
