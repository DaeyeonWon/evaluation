"use client";
/** Compact ranking table of the breakdown values (cview=table). Row click / Enter drills into Triage. */
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/i18n/client";
import type { IssueBreakdownItem } from "@/lib/types";
import { useIssueFormat, type IssueViewLinks } from "../../issues-shared";
import type { ValueText } from "./labels";
import { Delta, SevBar, Spark } from "./marks";

export function RankingTable({
  dim,
  items,
  tag,
  vt,
  V,
  bucketLabels,
  maxShare,
}: {
  dim: string;
  items: IssueBreakdownItem[];
  tag: boolean;
  vt: ValueText;
  V: IssueViewLinks;
  bucketLabels: string[];
  maxShare: number;
}) {
  const t = useT("issuesCategories");
  const fx = useIssueFormat();
  const router = useRouter();
  return (
    <div className="cat-table-wrap">
      <table className="cat-table">
        <caption className="cat-sr">{t("table.caption", { dim: vt.dim(dim) })}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">
              {t("table.rank")}
            </th>
            <th scope="col">{t("table.value")}</th>
            <th scope="col" className="num">
              {t("table.issues")}
            </th>
            <th scope="col">{t("table.impact")}</th>
            <th scope="col" className="num" title={tag ? t("card.failShareHelp") : undefined}>
              {tag ? t("card.failShare") : t("table.failRate")}
            </th>
            <th scope="col" className="num">
              {t("table.delta")}
            </th>
            <th scope="col" className="num">
              {t("table.volume")}
            </th>
            <th scope="col">{t("table.share")}</th>
            <th scope="col">{t("table.trend")}</th>
            <th scope="col">{t("table.top")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const href = V.drillHref(dim, i.value);
            const name = vt.label(dim, i.value);
            const top = i.top_issues[0];
            return (
              <tr key={i.value} onClick={(e) => !(e.target as HTMLElement).closest("a") && router.push(href)}>
                <td className="num mono muted">{i.rank}</td>
                <th scope="row">
                  <Link href={href} title={t("card.drill", { value: name })}>
                    {name}
                  </Link>
                </th>
                <td className="num mono">{i.issues}</td>
                <td className="cat-t-sev">
                  <SevBar by={i.by_severity} legend={false} />
                </td>
                <td className="num mono">{fx.pct(i.fail_rate)}</td>
                <td className="num">
                  <Delta value={i.delta} />
                </td>
                <td className="num mono">{i.fails.toLocaleString("en-US")}</td>
                <td className="cat-t-share">
                  <span className="cat-share-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(2, (i.share / Math.max(1, maxShare)) * 100)}%` }} />
                  </span>
                  <span className="mono">{i.share.toFixed(1)}%</span>
                </td>
                <td className="cat-t-spark">
                  <Spark values={i.trend_rate} labels={bucketLabels} ariaLabel={t("card.trendAria", { value: name })} fmt={fx.pct} height={24} />
                </td>
                <td className="cat-t-top">
                  {top ? (
                    <Link href={V.issueHref(top.id)} title={fx.text(top.title)}>
                      <span className="iss-sev" data-sev={top.severity}>
                        {top.severity}
                      </span>
                      <span>{fx.text(top.title)}</span>
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
