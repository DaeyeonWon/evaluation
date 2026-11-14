"use client";
/**
 * Market Brief — §4 Market & device impact: one small multiple per market (FAIL rate per Agent function on
 * a shared scale, coloured by change vs baseline, baseline tick), plus device and language bars.
 */
import clsx from "clsx";
import { useFmt, useT } from "@/i18n/client";
import type { IssueMatrixCell, IssueSummary, LangCode } from "@/lib/types";
import { LangBadge } from "@/components/shared";
import type { IssueFiltersApi, IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { Delta, DeltaLegend, deltaDir, Figure, FootRef, HBars, useTip } from "./bits";
import { SecHead } from "./sec";

export function MarketImpact({ id, no, sum, f, fx }: { id: string; no: number; sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const { attach: devTipAttach, on: devTipOn, el: devTipEl } = useTip();
  const mm = sum?.market_matrix;
  const cells = new Map((mm?.cells ?? []).map((c) => [`${c.row}|${c.col}`, c]));
  const max = Math.max(10, ...(mm?.cells ?? []).filter((c) => c.total >= 5).map((c) => c.fail_rate ?? 0));
  const mstat = new Map((sum?.columns.market ?? []).map((c) => [c.value, c]));

  const cellTip = (c: IssueMatrixCell) => (
    <>
      <b>
        {fx.value("market", c.col)} × {fx.fn(c.row)}
      </b>
      <div>
        {s("field.failRate")} {fx.pct(c.fail_rate)} · Baseline {fx.pct(c.baseline_fail_rate)} · {fx.pp(c.delta)}
      </div>
      <div>
        FAIL {fmt.number(c.fails)} / {fmt.number(c.total)}
      </div>
    </>
  );

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.markets.title")} lead={t("section.markets.lead")} />
      {!sum || !mm ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <Figure n={`${no}.1`} title={t("markets.figGrid")} src={t("sources.summary")} aside={<DeltaLegend />}>
            <div className="issb-multiples" ref={tipAttach}>
              {mm.cols.map((m) => {
                const st = mstat.get(m);
                const col = mm.rows.map((r) => cells.get(`${r}|${m}`)).filter((c): c is IssueMatrixCell => !!c);
                const peak = col.filter((c) => c.total >= 5).sort((a, b) => (b.fail_rate ?? 0) - (a.fail_rate ?? 0))[0];
                const on = f.values.market.includes(m);
                return (
                  <div key={m} className={clsx("issb-mult", on && "on")} data-dir={deltaDir(st?.delta)}>
                    <button type="button" className="issb-mult-h" aria-pressed={on} onClick={() => f.toggle("market", m)} title={t("markets.filter", { value: fx.value("market", m) })}>
                      <span className="issb-mult-code">{m}</span>
                      <span className="issb-mult-name">{fx.value("market", m)}</span>
                      <span className="issb-mult-v">{fx.pct(st?.fail_rate)}</span>
                      <Delta d={st?.delta} fx={fx} />
                    </button>
                    <div className="issb-mult-sub mono">
                      {t("markets.rows", { n: fmt.number(st?.total ?? 0), count: st?.total ?? 0 })} · FAIL {fmt.number(st?.fails ?? 0)}
                      <FootRef k={`mkt:${m}`} />
                    </div>
                    <ul className="issb-mult-rows">
                      {mm.rows.map((r) => {
                        const c = cells.get(`${r}|${m}`);
                        const empty = !c || c.total === 0;
                        return (
                          <li key={r}>
                            <button
                              type="button"
                              disabled={empty}
                              className={clsx("issb-mult-r", peak && c === peak && "peak")}
                              onClick={() => f.set({ market: [m], agent_function: [r] })}
                              {...(c && !empty ? tipOn(cellTip(c)) : {})}
                            >
                              <span className="issb-mult-l">{fx.fn(r)}</span>
                              <span className="issb-mult-track">
                                {!empty ? <i data-dir={deltaDir(c!.delta)} style={{ width: `${Math.min(100, ((c!.fail_rate ?? 0) / max) * 100)}%` }} /> : null}
                                {c?.baseline_fail_rate != null ? <b style={{ left: `${Math.min(100, (c.baseline_fail_rate / max) * 100)}%` }} aria-hidden /> : null}
                              </span>
                              <span className="issb-mult-n mono">{empty ? "—" : fx.pct(c!.fail_rate)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {peak ? (
                      <div className="issb-mult-peak">
                        {t("markets.hottest")}: <b>{fx.fn(peak.row)}</b> {fx.pct(peak.fail_rate)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {tipEl}
            </div>
          </Figure>

          <div className="issb-two">
            <Figure n={`${no}.2`} title={t("markets.figDevice")} src={t("sources.summary")}>
              <div ref={devTipAttach} style={{ position: "relative" }}>
                <HBars
                  fx={fx}
                  tipOn={devTipOn}
                  rows={sum.columns.device.map((c) => ({
                    key: c.value,
                    label: c.value,
                    value: c.fail_rate,
                    base: c.baseline_fail_rate,
                    delta: c.delta,
                    active: f.values.device.includes(c.value),
                    onClick: () => f.toggle("device", c.value),
                    tip: (
                      <>
                        <b>{c.value}</b>
                        <div>
                          FAIL {fmt.number(c.fails)} / {fmt.number(c.total)} · Baseline {fx.pct(c.baseline_fail_rate)}
                        </div>
                      </>
                    ),
                  }))}
                />
                {devTipEl}
              </div>
            </Figure>
            <Figure n={`${no}.3`} title={t("markets.figLang")} src={t("sources.summary")}>
              <HBars
                fx={fx}
                rows={sum.columns.language.map((c) => ({
                  key: c.value,
                  label: <LangBadge lang={c.value as LangCode} />,
                  value: c.fail_rate,
                  base: c.baseline_fail_rate,
                  delta: c.delta,
                  active: f.values.language.includes(c.value),
                  onClick: () => f.toggle("language", c.value),
                }))}
              />
            </Figure>
          </div>
        </>
      )}
    </section>
  );
}
