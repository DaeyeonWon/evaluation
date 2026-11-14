"use client";
/**
 * Report view — § User impact (사용자 영향, lens 1). What users experienced, grouped by the shared impact
 * level: an impact level × user_impact_type cross-tab (issues per cell, FAIL share per type), then the
 * worst cases quoted verbatim — the top-scoring issue of each type within each impact level, with the
 * utterance, Bixby's reply and why it was classed that way. Each case links to /issues/[id].
 */
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useFmt, useT } from "@/i18n/client";
import type { Issue, IssueBreakdown, IssueListResponse, IssueSeverity, UserImpactType } from "@/lib/types";
import { LangBadge } from "@/components/shared";
import type { IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { Figure, FootRef, ImpactTag, TypeTag } from "./bits";
import { CrossLegend, CrossTab, LEVELS } from "./crosstab";
import type { BriefLinks } from "./links";
import { SecHead } from "./sec";

export const USER_IMPACTS: UserImpactType[] = ["safety_privacy", "wrong_action", "task_blocked", "misunderstood", "inappropriate_content", "degraded", "minor"];

/** top-scoring issue per (impact level, type), most critical levels first; ≤ perLevel per level, ≤ cap overall */
export function worstCases<K extends string>(items: Issue[], typeOf: (i: Issue) => K, opts: { perLevel?: number; cap?: number; keep?: (i: Issue) => boolean } = {}) {
  const perLevel = opts.perLevel ?? 3;
  const cap = opts.cap ?? 8;
  const out: { level: IssueSeverity; issues: Issue[] }[] = [];
  let n = 0;
  for (const l of LEVELS) {
    if (n >= cap) break;
    const seen = new Set<K>();
    const picked: Issue[] = [];
    for (const i of [...items].filter((x) => x.severity === l && (opts.keep?.(x) ?? true)).sort((a, b) => b.score - a.score)) {
      const k = typeOf(i);
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(i);
      if (picked.length >= perLevel || n + picked.length >= cap) break;
    }
    if (picked.length) {
      out.push({ level: l, issues: picked });
      n += picked.length;
    }
  }
  return out;
}

export function CaseCard({ issue, fx, B, kind, why }: { issue: Issue; fx: IssueFormat; B: BriefLinks; kind: "user_impact" | "dev_miss"; why: string }) {
  const t = useT("issuesReport");
  const fmt = useFmt();
  const i = issue;
  const x = i.sample;
  return (
    <article className="issb-case" data-sev={i.severity}>
      <header className="issb-case-h">
        <ImpactTag s={i.severity} compact />
        <TypeTag kind={kind} v={kind === "user_impact" ? i.user_impact_type : i.dev_miss_type} fx={fx} />
        <TypeTag kind="category" v={i.category} fx={fx} />
      </header>
      <blockquote className="issb-case-q">
        <p className="issb-case-u">{x.utterance_text}</p>
        <p className="issb-case-r">
          <span>{t("dossier.replied")}</span> {x.actual_response}
        </p>
      </blockquote>
      <p className="issb-case-why">{why}</p>
      <footer className="issb-case-f">
        <Link className="issb-case-t" href={B.issueHref(i.id)}>
          {fx.text(i.title)}
          <ArrowUpRight aria-hidden />
        </Link>
        <span className="issb-case-m mono">
          <LangBadge lang={x.language} /> {x.market} · {x.device_type} · FAIL {fmt.number(i.count)}
          <FootRef k={`iss:${i.id}`} />
        </span>
      </footer>
    </article>
  );
}

export function UserImpact({ id, no, bd, list, fx, B }: { id: string; no: number; bd: IssueBreakdown | null | undefined; list: IssueListResponse | undefined; fx: IssueFormat; B: BriefLinks }) {
  const t = useT("issuesReport");
  const items = list?.items ?? [];
  const cases = worstCases(items, (i) => i.user_impact_type, { perLevel: 3, cap: 8 });
  const top = bd?.items.slice().sort((a, b) => b.share - a.share)[0];
  const href = (l: IssueSeverity | null, v: string | null) => {
    const pairs: [string, string][] = [];
    if (v) pairs.push(["user_impact", v]);
    if (l) pairs.push(["severity", l]);
    return B.view(pairs, "triage", { lens: "user" });
  };
  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.user.title")} lead={t("section.user.lead")} />
      {bd === undefined || !list ? (
        <Skeleton rows={6} />
      ) : !bd || !bd.items.length ? (
        <p className="issb-empty">{t("section.user.empty")}</p>
      ) : (
        <div className="issb-stack">
          {top ? (
            <p className="issb-standout">
              {t("user.standout", { type: fx.value("user_impact", top.value), share: fx.pct(top.share), issues: top.issues })}{" "}
              <Link className="issb-link" href={href(null, top.value)}>
                {t("dim.triage")} <ArrowUpRight aria-hidden />
              </Link>
            </p>
          ) : null}
          <Figure n={`${no}.1`} title={t("user.figGrid")} src="/issues/breakdown?dim=user_impact" aside={<CrossLegend />}>
            <CrossTab dim="user_impact" cols={USER_IMPACTS.map((value) => ({ value }))} items={bd.items} fx={fx} href={href} label={t("user.figGrid")} />
          </Figure>
          <Figure n={`${no}.2`} title={t("user.figCases")} src={t("sources.issues")}>
            {!cases.length ? (
              <p className="issb-empty">{t("section.user.empty")}</p>
            ) : (
              <div className="issb-cases">
                {cases.map((g) => (
                  <div key={g.level} className="issb-cases-lv" data-sev={g.level}>
                    <h4 className="issb-cases-h">
                      <ImpactTag s={g.level} />
                      <span>{t("cases.count", { count: g.issues.length })}</span>
                    </h4>
                    <div className="issb-cases-g">
                      {g.issues.map((i) => (
                        <CaseCard key={i.id} issue={i} fx={fx} B={B} kind="user_impact" why={fx.text(i.type_reason.user_impact)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Figure>
        </div>
      )}
    </section>
  );
}
