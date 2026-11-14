"use client";
/**
 * Report view — § Bixby version regression. FAIL rate across BIXBY_VERSIONS (oldest first):
 *  - the callout: bixby_version insights (e.g. 4.0.3 on TV routes music to video search, +34pp);
 *  - one panel per division with a column per version on ONE shared scale, coloured by the change vs
 *    the previous version deployed on that division (versions not rolled out there are marked);
 *  - FAIL rate per version overall (breakdown) with the baseline tick;
 *  - issues whose newest Bixby version is worse than the previous one (dumbbells → /issues/[id]).
 */
import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useFmt, useT } from "@/i18n/client";
import { BIXBY_VERSIONS } from "@/lib/catalog";
import type { InsightList, IssueBreakdown, IssueDimMatrix, IssueListResponse } from "@/lib/types";
import type { IssueFiltersApi, IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { Delta, deltaDir, Figure, FootRef, HBars, ImpactTag, useTip } from "./bits";
import type { BriefLinks } from "./links";
import { SecHead } from "./sec";

const DIVS = ["Mobile", "Wearable", "Audio", "TV", "Appliance"];
const vIdx = (v: string) => {
  const i = BIXBY_VERSIONS.indexOf(v);
  return i < 0 ? 99 : i;
};
export const bixbyRegressions = (list: IssueListResponse | undefined) =>
  (list?.items ?? [])
    .filter((i) => i.bixby_regression)
    .sort((a, b) => b.bixby_regression!.currentRate - b.bixby_regression!.previousRate - (a.bixby_regression!.currentRate - a.bixby_regression!.previousRate))
    .slice(0, 8);

export function BixbyRegression({
  id,
  no,
  mx,
  bd,
  ins,
  list,
  f,
  fx,
  B,
}: {
  id: string;
  no: number;
  mx: IssueDimMatrix | null | undefined;
  bd: IssueBreakdown | null | undefined;
  ins: InsightList | undefined;
  list: IssueListResponse | undefined;
  f: IssueFiltersApi;
  fx: IssueFormat;
  B: BriefLinks;
}) {
  const t = useT("issuesReport");
  const fmt = useFmt();
  const { attach, on, el } = useTip();
  const { attach: dAttach, on: dOn, el: dEl } = useTip();
  const callouts = (ins?.items ?? []).filter((i) => i.kind === "bixby_version");
  const versions = [...(mx?.x_values ?? BIXBY_VERSIONS)].filter((v) => v !== "__other__").sort((a, b) => vIdx(a) - vIdx(b));
  const divs = [...(mx?.y_values ?? [])].filter((v) => v !== "__other__").sort((a, b) => DIVS.indexOf(a) - DIVS.indexOf(b));
  const cell = new Map((mx?.cells ?? []).map((c) => [`${c.y}|${c.x}`, c]));
  const vmax = Math.max(10, ...(mx?.cells ?? []).filter((c) => c.total >= 10).map((c) => c.fail_rate ?? 0));
  const step = [5, 10, 20, 25].find((s) => vmax / s <= 4) ?? 25;
  const ymax = Math.ceil(vmax / step) * step;
  const ticks = Array.from({ length: ymax / step + 1 }, (_, k) => k * step);
  const hot = new Set(callouts.map((c) => `${c.vars.division}|${c.vars.version}`));
  const regs = bixbyRegressions(list);
  const raw = Math.max(10, ...regs.map((i) => Math.max(i.bixby_regression!.currentRate, i.bixby_regression!.previousRate)));
  const dstep = [5, 10, 20, 25, 50].find((s) => raw / s <= 5) ?? 25;
  const dmax = Math.ceil(raw / dstep) * dstep;
  const dticks = Array.from({ length: dmax / dstep + 1 }, (_, k) => k * dstep);

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.bixby.title")} lead={t("section.bixby.lead")} />
      {mx === undefined || bd === undefined ? (
        <Skeleton rows={6} />
      ) : (
        <div className="issb-stack">
          {callouts.length ? (
            callouts.slice(0, 2).map((c) => (
              <aside key={c.id} className="issb-callout" data-sev={c.severity}>
                <div className="issb-callout-n">
                  <span className="issb-callout-v">{String(c.vars.version)}</span>
                  <span className="issb-callout-u mono">
                    {fx.value("division", String(c.vars.division))} · {fx.fn(String(c.vars.fn))}
                  </span>
                </div>
                <div className="issb-callout-b">
                  <span className="issb-callout-k">
                    <ImpactTag s={c.severity} /> {t("bixby.callout")}
                  </span>
                  <p>
                    {fx.insight(c)}
                    <FootRef k={`ins:${c.id}`} />
                  </p>
                  <div className="issb-callout-cmp mono" aria-hidden>
                    <span>
                      {String(c.vars.previous)} <b>{fx.pct(Number(c.vars.prevRate))}</b>
                    </span>
                    <i />
                    <span data-hot="">
                      {String(c.vars.version)} <b>{fx.pct(Number(c.vars.rate))}</b>
                    </span>
                    <Delta d={Number(c.vars.delta)} fx={fx} />
                  </div>
                  <span className="issb-callout-links">
                    {c.evidence.issue_id ? (
                      <Link className="issb-link" href={B.issueHref(c.evidence.issue_id)}>
                        {t("bixby.openIssue")} <ArrowUpRight aria-hidden />
                      </Link>
                    ) : null}
                    <Link className="issb-link" href={B.evidence(c)}>
                      {t("dossier.results")} <ArrowUpRight aria-hidden />
                    </Link>
                    <Link className="issb-link" href={B.view([["division", String(c.vars.division)], ["bixby_version", String(c.vars.version)]], "triage")}>
                      {t("dim.triage")} <ArrowUpRight aria-hidden />
                    </Link>
                  </span>
                </div>
              </aside>
            ))
          ) : (
            <p className="issb-standout">{t("bixby.none")}</p>
          )}

          <Figure
            n={`${no}.1`}
            title={t("bixby.figDivisions")}
            src="/issues/matrix?x=bixby_version&y=division"
            aside={
              <span className="issb-legend" role="list">
                <span role="listitem">
                  <i data-dir="up" /> {t("bixby.worse")}
                </span>
                <span role="listitem">
                  <i data-dir="flat" /> {t("markets.flat")}
                </span>
                <span role="listitem">
                  <i data-dir="down" /> {t("bixby.better")}
                </span>
                <span role="listitem">
                  <i data-dir="first" /> {t("bixby.first")}
                </span>
                <span role="listitem">
                  <i data-dir="nd" /> {t("bixby.notDeployed")}
                </span>
              </span>
            }
          >
            {!mx || !divs.length ? (
              <p className="issb-empty">{t("dim.empty")}</p>
            ) : (
              <div className="issb-bxgrid" ref={attach}>
                {divs.map((d) => {
                  let prev: { v: string; r: number } | null = null;
                  const cols = versions.map((v) => {
                    const c = cell.get(`${d}|${v}`);
                    const r = c && c.total > 0 ? c.fail_rate : null;
                    const chg = r != null && prev ? r - prev.r : null;
                    const from = prev;
                    if (r != null) prev = { v, r };
                    return { v, c, r, chg, from };
                  });
                  const isHot = versions.some((v) => hot.has(`${d}|${v}`));
                  return (
                    <div key={d} className={clsx("issb-bx", isHot && "hot")}>
                      <div className="issb-bx-h">
                        <b>{fx.value("division", d)}</b>
                        {isHot ? <span className="issb-bx-flag">{t("bixby.flag")}</span> : null}
                      </div>
                      <div className="issb-bx-plot">
                        <div className="issb-bx-grid" aria-hidden>
                          {ticks.map((v) => (
                            <span key={v} style={{ bottom: `${(v / ymax) * 100}%` }}>
                              <em>{v}%</em>
                            </span>
                          ))}
                        </div>
                        {cols.map(({ v, c, r, chg, from }) => {
                          const dir = r == null ? "none" : chg == null ? "first" : deltaDir(chg);
                          const hv = hot.has(`${d}|${v}`);
                          return (
                            <span
                              key={v}
                              className={clsx("issb-bx-col", hv && "hot")}
                              data-empty={r == null || undefined}
                              tabIndex={r == null ? undefined : 0}
                              {...(r != null && c
                                ? on(
                                    <>
                                      <b>
                                        {fx.value("division", d)} · Bixby {v}
                                      </b>
                                      <div>
                                        FAIL {fx.pct(r)} ({fmt.number(c.fails)} / {fmt.number(c.total)})
                                      </div>
                                      {from && chg != null ? (
                                        <div>
                                          {t("bixby.vsPrev", { prev: from.v, delta: fx.pp(chg) })}
                                        </div>
                                      ) : (
                                        <div>{t("bixby.first")}</div>
                                      )}
                                    </>,
                                  )
                                : {})}
                            >
                              {r != null ? (
                                <>
                                  <em className="mono">{r.toFixed(1)}</em>
                                  <i data-dir={dir} style={{ height: `${Math.min(100, (r / ymax) * 100)}%` }} />
                                </>
                              ) : (
                                <small title={t("bixby.notDeployed")}>{t("bixby.notDeployed")}</small>
                              )}
                            </span>
                          );
                        })}
                      </div>
                      <div className="issb-bx-x mono" aria-hidden>
                        {versions.map((v) => (
                          <span key={v}>{v.replace("-beta", "β")}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {el}
              </div>
            )}
          </Figure>

          <div className="issb-two">
            <Figure n={`${no}.2`} title={t("bixby.figOverall")} src="/issues/breakdown?dim=bixby_version">
              {!bd?.items.length ? (
                <p className="issb-empty">{t("dim.empty")}</p>
              ) : (
                <HBars
                  fx={fx}
                  rows={[...bd.items]
                    .sort((a, b) => vIdx(a.value) - vIdx(b.value))
                    .map((c) => ({
                      key: c.value,
                      label: <span className="mono">{c.value}</span>,
                      value: c.fail_rate,
                      base: c.baseline_fail_rate,
                      delta: c.delta,
                      active: f.values.bixby_version.includes(c.value),
                      onClick: () => f.toggle("bixby_version", c.value),
                    }))}
                />
              )}
            </Figure>
            <Figure
              n={`${no}.3`}
              title={t("bixby.figIssues")}
              src={t("sources.issues")}
              aside={
                <span className="issb-legend" role="list">
                  <span role="listitem">
                    <i data-dot="prev" /> {t("regression.previous")}
                  </span>
                  <span role="listitem">
                    <i data-dot="cur" /> {t("regression.current")}
                  </span>
                </span>
              }
            >
              {!regs.length ? (
                <p className="issb-empty">{t("bixby.noIssues")}</p>
              ) : (
                <div className="issb-dumb compact" ref={dAttach}>
                  <div className="issb-dumb-ax" aria-hidden>
                    <span />
                    <span className="issb-dumb-ticks">
                      {dticks.map((v, k) => (
                        <span key={k} style={{ left: `${(v / dmax) * 100}%` }}>
                          {v}%
                        </span>
                      ))}
                    </span>
                    <span />
                  </div>
                  {regs.map((i) => {
                    const r = i.bixby_regression!;
                    const lo = Math.min(r.previousRate, r.currentRate);
                    const hi = Math.max(r.previousRate, r.currentRate);
                    return (
                      <div
                        key={i.id}
                        className="issb-dumb-r"
                        {...dOn(
                          <>
                            <b>{fx.text(i.title)}</b>
                            <div>
                              {fx.value("division", r.division)}: {r.previous} {fx.pct(r.previousRate)} (n={fmt.number(r.previousTotal)}) → {r.current} {fx.pct(r.currentRate)} (n={fmt.number(r.currentTotal)}) · z={r.z}
                            </div>
                          </>,
                        )}
                      >
                        <Link className="issb-dumb-l" href={B.issueHref(i.id)}>
                          <ImpactTag s={i.severity} compact />
                          <span className="issb-dumb-t">{fx.text(i.title)}</span>
                          <small className="mono">
                            {fx.value("division", r.division)} · {r.previous} → {r.current}
                          </small>
                        </Link>
                        <span className="issb-dumb-track">
                          {dticks.map((v) => (
                            <b key={v} className="issb-dumb-g" aria-hidden style={{ left: `${(v / dmax) * 100}%` }} />
                          ))}
                          <span className="issb-dumb-line" style={{ left: `${(lo / dmax) * 100}%`, width: `${((hi - lo) / dmax) * 100}%` }} />
                          <i data-dot="prev" style={{ left: `${(r.previousRate / dmax) * 100}%` }} />
                          <i data-dot="cur" style={{ left: `${(r.currentRate / dmax) * 100}%` }} />
                        </span>
                        <span className="issb-dumb-v mono">
                          <span>
                            {fx.pct(r.previousRate)} → <b>{fx.pct(r.currentRate)}</b>
                          </span>
                          <small>{fx.pp(r.currentRate - r.previousRate)}</small>
                        </span>
                        <FootRef k={`bxi:${i.id}`} />
                      </div>
                    );
                  })}
                  {dEl}
                </div>
              )}
            </Figure>
          </div>
        </div>
      )}
    </section>
  );
}
