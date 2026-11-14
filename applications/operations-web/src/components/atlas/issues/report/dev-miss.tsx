"use client";
/**
 * Report view — § Must-handle misses (Bixby 미처리, dev lens). Cases Bixby supports on that device /
 * Bixby version and should have handled, grouped by the same impact levels as § User impact:
 * a must-handle ledger, an impact level × dev_miss_type cross-tab, the critical misses ranked by
 * criticality within each level (with the must_handle reason), three focus panels (regressions incl.
 * Bixby / model version, guardrail misses, new-feature gaps) and why issues count as must-handle.
 */
import { ArrowUpRight, GitBranch, ShieldOff, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useFmt, useT } from "@/i18n/client";
import type { DevMissType, Issue, IssueBreakdown, IssueListResponse, IssueSeverity } from "@/lib/types";
import type { IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { Figure, FootRef, ImpactTag, TypeTag } from "./bits";
import { CrossLegend, CrossTab, LEVELS } from "./crosstab";
import type { BriefLinks } from "./links";
import { SecHead } from "./sec";

export const DEV_MISSES: DevMissType[] = [
  "guardrail_miss",
  "regression",
  "new_feature_gap",
  "locale_gap",
  "supported_intent_failed",
  "routing",
  "slot_extraction",
  "asr_robustness",
  "performance",
  "out_of_scope",
];

const sevRank = (s: IssueSeverity) => LEVELS.indexOf(s);
/** must-handle issues by impact level, then criticality */
export const criticalMisses = (items: Issue[], n = 8) =>
  items
    .filter((i) => i.must_handle)
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.score - a.score)
    .slice(0, n);

const FOCUS: { type: DevMissType; icon: LucideIcon }[] = [
  { type: "regression", icon: GitBranch },
  { type: "guardrail_miss", icon: ShieldOff },
  { type: "new_feature_gap", icon: Sparkles },
];
export const focusIssues = (items: Issue[], type: DevMissType, n = 4) =>
  items
    .filter((i) => i.dev_miss_type === type)
    .sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.score - a.score)
    .slice(0, n);

export function DevMiss({ id, no, bd, bdMust, list, fx, B }: { id: string; no: number; bd: IssueBreakdown | null | undefined; bdMust: IssueBreakdown | null | undefined; list: IssueListResponse | undefined; fx: IssueFormat; B: BriefLinks }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const items = list?.items ?? [];
  const must = items.filter((i) => i.must_handle);
  // counts come from the breakdowns (every issue in scope); the list (top 200 by score) feeds the examples
  const mustStat = bdMust?.items.find((x) => x.value === "true");
  const allIssues = bdMust ? bdMust.items.reduce((a, x) => a + x.issues, 0) : (list?.total ?? items.length);
  const typeStat = (ty: DevMissType) => bd?.items.find((x) => x.value === ty);
  const typeCount = (ty: DevMissType) => typeStat(ty)?.issues ?? items.filter((i) => i.dev_miss_type === ty).length;
  const typeCrit = (ty: DevMissType) => {
    const st = typeStat(ty);
    return st ? (st.by_severity.P0 ?? 0) + (st.by_severity.P1 ?? 0) : items.filter((i) => i.dev_miss_type === ty && (i.severity === "P0" || i.severity === "P1")).length;
  };
  const crit = criticalMisses(items);
  const out = items.filter((i) => !i.must_handle).sort((a, b) => b.count - a.count);
  // why issues count as must-handle (must_handle_reason keys)
  const reasons = new Map<string, number>();
  for (const i of must) reasons.set(i.must_handle_reason.key, (reasons.get(i.must_handle_reason.key) ?? 0) + 1);
  const reasonRows = [...reasons.entries()].sort((a, b) => b[1] - a[1]);
  const rmax = Math.max(1, ...reasonRows.map((r) => r[1]));

  const dev = (pairs: [string, string][], mh: "true" | "false" | null = "true") => B.view(pairs, "triage", { lens: "dev", ...(mh ? { must_handle: mh } : {}) });
  const href = (l: IssueSeverity | null, v: string | null) => {
    const pairs: [string, string][] = [];
    if (v) pairs.push(["dev_miss", v]);
    if (l) pairs.push(["severity", l]);
    return dev(pairs, v === "out_of_scope" ? "false" : "true");
  };

  const ledger: { k: string; v: string; sub: string; href: string; tone?: string }[] = [
    { k: t("dev.mustIssues"), v: fmt.number(mustStat?.issues ?? must.length), sub: t("dev.ofIssues", { n: fmt.number(allIssues) }), href: dev([]) },
    { k: t("dev.mustShare"), v: mustStat ? fx.pct(mustStat.share) : "—", sub: t("dev.mustShareSub", { n: fmt.number(mustStat?.fails ?? 0) }), href: dev([]) },
    ...FOCUS.map((x) => ({ k: fx.value("dev_miss", x.type), v: fmt.number(typeCount(x.type)), sub: t("dev.critical", { n: typeCrit(x.type) }), href: dev([["dev_miss", x.type]]), tone: x.type })),
  ];

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.dev.title")} lead={t("section.dev.lead")} />
      {bd === undefined || !list ? (
        <Skeleton rows={6} />
      ) : !items.length ? (
        <p className="issb-empty">{t("section.dev.empty")}</p>
      ) : (
        <div className="issb-stack">
          <div className="issb-mini-ledger" role="list">
            {ledger.map((x) => (
              <Link key={x.k} role="listitem" className="issb-mini-c" href={x.href} data-tone={x.tone}>
                <span className="issb-ledger-k">{x.k}</span>
                <span className="issb-mini-v">{x.v}</span>
                <span className="issb-ledger-s">{x.sub}</span>
              </Link>
            ))}
          </div>

          {bd && bd.items.length ? (
            <Figure n={`${no}.1`} title={t("dev.figGrid")} src="/issues/breakdown?dim=dev_miss" aside={<CrossLegend />}>
              <CrossTab dim="dev_miss" cols={DEV_MISSES.map((value) => ({ value, muted: value === "out_of_scope" }))} items={bd.items} fx={fx} href={href} label={t("dev.figGrid")} />
            </Figure>
          ) : null}

          <Figure n={`${no}.2`} title={t("dev.figCritical")} src={t("sources.issues")} aside={<span className="issb-hintx">{t("dev.sortHint")}</span>}>
            {!crit.length ? (
              <p className="issb-empty">{t("section.dev.empty")}</p>
            ) : (
              <ol className="issb-miss">
                {crit.map((i, k) => (
                  <li key={i.id} className="issb-miss-r" data-sev={i.severity} style={{ ["--i" as string]: k }}>
                    <span className="issb-miss-n mono">{String(k + 1).padStart(2, "0")}</span>
                    <div className="issb-miss-b">
                      <div className="issb-miss-tags">
                        <ImpactTag s={i.severity} />
                        <TypeTag kind="dev_miss" v={i.dev_miss_type} fx={fx} />
                        <TypeTag kind="category" v={i.category} fx={fx} />
                      </div>
                      <Link className="issb-miss-t" href={B.issueHref(i.id)}>
                        {fx.text(i.title)}
                        <ArrowUpRight aria-hidden />
                      </Link>
                      <p className="issb-miss-why">
                        <span>{t("dev.why")}</span> {fx.text(i.type_reason.dev_miss)}
                      </p>
                      <p className="issb-miss-why mh">
                        <span>{s("mustHandleValue.true")}</span> {fx.text(i.must_handle_reason)}
                      </p>
                    </div>
                    <div className="issb-miss-v mono">
                      <b>{fx.score(i.score)}</b>
                      <small>FAIL {fmt.number(i.count)}</small>
                      <FootRef k={`iss:${i.id}`} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Figure>

          <Figure n={`${no}.3`} title={t("dev.figFocus")} src={t("sources.issues")}>
            <div className="issb-focus">
              {FOCUS.map(({ type, icon: I }) => {
                const xs = focusIssues(items, type);
                return (
                  <div key={type} className="issb-focus-c" data-type={type}>
                    <h4>
                      <I aria-hidden />
                      {fx.value("dev_miss", type)}
                      <small className="mono">{typeCount(type)}</small>
                    </h4>
                    <p className="issb-focus-help">{s.dynamic(`devMissHelp.${type}`, undefined, "")}</p>
                    {!xs.length ? (
                      <p className="issb-empty">{t("dev.noneOfType")}</p>
                    ) : (
                      <ul>
                        {xs.map((i) => (
                          <li key={i.id}>
                            <ImpactTag s={i.severity} compact />
                            <Link href={B.issueHref(i.id)}>{fx.text(i.title)}</Link>
                            <small>{fx.text(i.type_reason.dev_miss)}</small>
                            {i.bixby_regression ? (
                              <small className="mono issb-focus-bx">
                                Bixby {i.bixby_regression.previous} {fx.pct(i.bixby_regression.previousRate)} → {i.bixby_regression.current} <b>{fx.pct(i.bixby_regression.currentRate)}</b> · {fx.value("division", i.bixby_regression.division)}
                              </small>
                            ) : i.regression ? (
                              <small className="mono issb-focus-bx">
                                {fx.column(i.regression.axis)} {i.regression.previous} {fx.pct(i.regression.previousRate)} → {i.regression.current} <b>{fx.pct(i.regression.currentRate)}</b>
                              </small>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link className="issb-link" href={dev([["dev_miss", type]])}>
                      {t("dev.openTriage")} <ArrowUpRight aria-hidden />
                    </Link>
                  </div>
                );
              })}
            </div>
          </Figure>

          <Figure n={`${no}.4`} title={t("dev.figReasons")} src={t("sources.issues")}>
            <div className="issb-two tight">
              <ul className="issb-reasons">
                {reasonRows.map(([key, n]) => (
                  <li key={key}>
                    <span className="issb-reasons-l">{t.dynamic(`mh.${key.replace(/^mustHandle\./, "")}`, undefined, key)}</span>
                    <span className="issb-reasons-track">
                      <i style={{ width: `${(n / rmax) * 100}%` }} />
                    </span>
                    <span className="mono">{t("dev.issuesN", { count: n })}</span>
                  </li>
                ))}
              </ul>
              <div className="issb-oos">
                <h4>
                  {s("mustHandleValue.false")} <small className="mono">{bdMust?.items.find((x) => x.value === "false")?.issues ?? out.length}</small>
                </h4>
                {!out.length ? (
                  <p className="issb-empty">{t("dev.noOos")}</p>
                ) : (
                  <ul>
                    {out.slice(0, 4).map((i) => (
                      <li key={i.id}>
                        <Link href={B.issueHref(i.id)}>{fx.text(i.title)}</Link>
                        <small>{fx.text(i.must_handle_reason)}</small>
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="issb-link" href={dev([], "false")}>
                  {t("dev.openOos")} <ArrowUpRight aria-hidden />
                </Link>
              </div>
            </div>
          </Figure>
        </div>
      )}
    </section>
  );
}
