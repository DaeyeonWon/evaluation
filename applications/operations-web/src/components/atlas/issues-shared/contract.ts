/**
 * Issue Report — response shapes of the merge endpoints, re-exported under the names the views use.
 * The source of truth is @/lib/types (data engineer); this file only aliases them so view code imports
 * everything from issues-shared.
 *
 *   GET /api/v1/issues/breakdown?dim=        → IssueBreakdownResponse  (= IssueBreakdown)
 *   GET /api/v1/issues/matrix?x=&y=&metric=  → IssueDimMatrixResponse  (= IssueDimMatrix)
 *   GET /api/v1/issues?group=&subgroup=      → IssueGroupedListResponse (= IssueListResponse with group/groups)
 *   GET /api/v1/issues/[id]                  → IssueDetailMerge (= IssueDetail, breakdown incl. division/region/bixby_version)
 *   GET /api/v1/issues/facets                → IssueFacetValueMerge (= IssueFacetValue incl. fails/fail_rate/delta/issues)
 */
import type { Issue, IssueBreakdown, IssueDetail, IssueDimMatrix, IssueFacetValue, IssueListResponse } from "@/lib/types";

export type { IssueBreakdownItem, IssueDimMatrixCell, IssueGroup, IssueDim, IssueDimStat, IssueMatrixMetric, IssueCategory, UserImpactType, DevMissType, Division, Region } from "@/lib/types";
export type IssueBreakdownResponse = IssueBreakdown;
export type IssueDimMatrixResponse = IssueDimMatrix;
export type IssueGroupedListResponse = IssueListResponse;
export type IssueWithMerge = Issue;
export type IssueDetailMerge = IssueDetail;
export type IssueFacetValueMerge = IssueFacetValue;
