"use client";
/**
 * Issue Report — 분해 보기 / Breakdown view (/issues/categories). OWNED BY THE CATEGORIES VIEW ENGINEER.
 * The page header, view switcher, export buttons and the unified FilterBar come from the frame (../frame).
 *
 * TODO(categories): everything below is a placeholder.
 *   - dimension switch over BREAKDOWN_DIMS (category / agent_function / division / region / bixby_version /
 *     user_impact / dev_miss); keep it in a view-local URL param registered in links.ts VIEW_STATE_PARAMS
 *     (reserved: "dim", "csort", "cview").
 *   - cards from useIssueBreakdown(f, dim): issues by severity, FAIL rate + Δ, FAIL volume, sparkline,
 *     top 3 issues, top new pattern, share of total; sortable + compact ranking table.
 *   - card click → useIssueViewLinks().drillHref(dim, value) (Triage with that filter).
 *   - styles go in src/styles/atlas-issues-categories.css, scoped under [data-variant="atlas"] .iss-cat.
 */
import Link from "next/link";
import { useT } from "@/i18n/client";
import { useDimLabel, useIssueBreakdown, useIssueFilters, useIssueViewLinks } from "../../issues-shared";
import { ErrorNote, Plate, Skeleton } from "../../ui";
import "@/styles/atlas-issues-categories.css";

export function IssuesCategories() {
  const t = useT("issuesCategories");
  const f = useIssueFilters();
  const V = useIssueViewLinks();
  const dl = useDimLabel();
  const bd = useIssueBreakdown(f, "category");
  return (
    <div className="iss-cat iss-view">
      <Plate title={dl.dim("category")}>
        <p className="muted iss-cat-ph">{t("placeholder")}</p>
        {bd.error ? <ErrorNote error={bd.error} /> : null}
        {bd.isLoading ? (
          <Skeleton rows={3} />
        ) : bd.data?.items.length ? (
          <ul className="iss-cat-ph-list">
            {bd.data.items.map((i) => (
              <li key={i.value}>
                <Link href={V.drillHref("category", i.value)}>{dl.value("category", i.value)}</Link> <span className="mono muted">{i.issues}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Plate>
    </div>
  );
}
