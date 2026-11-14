"use client";
/**
 * One breakdown value as a card. The value title is a stretched link (whole card → Triage filtered to the value);
 * the top-issue links sit above it, so there are no nested anchors.
 */
import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useT } from "@/i18n/client";
import type { IssueBreakdownItem } from "@/lib/types";
import { TypeDot, isTypeDim, useIssueFormat, type IssueViewLinks } from "../../issues-shared";
import type { ValueText } from "./labels";
import { Delta, SevBar, Spark, deltaDir } from "./marks";

export function CategoryCard({
  dim,
  item,
  tag,
  vt,
  V,
  bucketLabels,
  maxShare,
  order,
}: {
  dim: string;
  item: IssueBreakdownItem;
  tag: boolean;
  vt: ValueText;
  V: IssueViewLinks;
  bucketLabels: string[];
  maxShare: number;
  order: number;
}) {
  const t = useT("issuesCategories");
  const s = useT("issues");
  const fx = useIssueFormat();
  const name = vt.label(dim, item.value);
  const help = vt.help(dim, item.value);
  const dir = deltaDir(item.delta);
  return (
    <article className="cat-card" data-dir={dir} style={{ ["--i" as string]: order } as CSSProperties}>
      <header className="cat-card-head">
        <span className="cat-rank mono">{t("card.rank", { rank: item.rank })}</span>
        <h3>
          {isTypeDim(dim) ? <TypeDot dim={dim} value={item.value} className="cat-tyd" /> : null}
          <Link href={V.drillHref(dim, item.value)} className="cat-card-link" aria-label={t("card.drill", { value: name })}>
            {name}
          </Link>
        </h3>
        <span className="cat-issues">
          <b className="mono">{item.issues}</b>
          <small>{t("card.issues")}</small>
        </span>
        {help ? <p className="cat-help">{help}</p> : null}
      </header>

      <dl className="cat-metrics">
        <div>
          <dt title={tag ? t("card.failShareHelp") : undefined}>{tag ? t("card.failShare") : t("card.failRate")}</dt>
          <dd>
            <b className="mono">{fx.pct(item.fail_rate)}</b>
            <Delta value={item.delta} />
          </dd>
          <dd className="cat-sub mono">{t("card.baseline", { rate: fx.pct(item.baseline_fail_rate) })}</dd>
        </div>
        <div>
          <dt>{t("card.volume")}</dt>
          <dd>
            <b className="mono">{item.fails.toLocaleString("en-US")}</b>
          </dd>
          <dd className="cat-share">
            <span className="cat-share-bar" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (item.share / Math.max(1, maxShare)) * 100)}%` }} />
            </span>
            <span className="mono">{t("card.share", { share: item.share.toFixed(1) })}</span>
          </dd>
        </div>
      </dl>

      <div className="cat-block">
        <span className="cat-k">{t("card.impact")}</span>
        <SevBar by={item.by_severity} />
      </div>

      <div className="cat-block">
        <span className="cat-k">{t("card.trend")}</span>
        <Spark values={item.trend_rate} labels={bucketLabels} ariaLabel={t("card.trendAria", { value: name })} fmt={fx.pct} />
      </div>

      <div className="cat-block cat-top">
        <span className="cat-k">{t("card.topIssues")}</span>
        {item.top_issues.length ? (
          <ol>
            {item.top_issues.map((i) => (
              <li key={i.id}>
                <span className="iss-sev" data-sev={i.severity} title={`${i.severity} · ${s.dynamic(`impactLevel.${i.severity}`, undefined, i.severity)}`}>
                  {i.severity}
                </span>
                <Link href={V.issueHref(i.id)} className="cat-top-title" title={fx.text(i.title)}>
                  {fx.text(i.title)}
                </Link>
                <span className="cat-top-score mono" title={t("card.score")}>
                  {fx.score(i.score)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="cat-none">{t("card.noIssues")}</p>
        )}
      </div>

      {item.top_pattern ? (
        <div className="cat-pattern">
          <Sparkles aria-hidden="true" />
          <span className="cat-k">{t("card.topPattern")}</span>
          <q lang={item.top_pattern.language}>{item.top_pattern.template}</q>
          <small className="mono">
            {fx.kind(item.top_pattern.kind)} · {t("card.patternRows", { count: item.top_pattern.count_in_value, rate: fx.pct(item.top_pattern.fail_rate) })}
          </small>
        </div>
      ) : null}

      <footer className="cat-card-foot" aria-hidden="true">
        <span>{t("card.drill", { value: name })}</span>
        <ArrowRight />
      </footer>
    </article>
  );
}
