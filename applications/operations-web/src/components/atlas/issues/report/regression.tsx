"use client";
/** Market Brief — §5 Regression watch: dumbbells previous → newest version per regressed issue + FAIL rate by version. */
import { useFmt, useT } from "@/i18n/client";
import type { IssueListResponse, IssueSummary } from "@/lib/types";
import type { IssueFiltersApi, IssueFormat } from "../../issues-shared";
import { JudgeCaveat } from "../../judge-caveat";
import { Skeleton } from "../../ui";
import { Figure, FootRef, HBars, Sev, useTip } from "./bits";
import { SecHead } from "./sec";

export function RegressionWatch({ id, no, list, sum, f, fx }: { id: string; no: number; list: IssueListResponse | undefined; sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const regs = (list?.items ?? []).filter((i) => i.regression).slice(0, 10);
  const raw = Math.max(10, ...regs.map((i) => Math.max(i.regression!.currentRate, i.regression!.previousRate)));
  const step = [5, 10, 20, 25, 50].find((s) => raw / s <= 5) ?? 25;
  const max = Math.ceil(raw / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, k) => k * step);

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.regression.title")} lead={t("section.regression.lead")} />
      {sum ? <JudgeCaveat versions={sum.columns.pipeline_version.filter((c) => c.total > 0).map((c) => c.value)} mode="direct" className="issb-judge" /> : null}
      {!list || !sum ? (
        <Skeleton rows={5} />
      ) : (
        <div className="issb-reg">
          <Figure
            n={`${no}.1`}
            title={t("regression.figDumbbell")}
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
              <p className="issb-empty">{t("regression.none")}</p>
            ) : (
              <div className="issb-dumb" ref={tipAttach}>
                <div className="issb-dumb-ax" aria-hidden>
                  <span />
                  <span className="issb-dumb-ticks">
                    {ticks.map((v, k) => (
                      <span key={k} style={{ left: `${(v / max) * 100}%` }}>
                        {v}%
                      </span>
                    ))}
                  </span>
                  <span />
                </div>
                {regs.map((i) => {
                  const r = i.regression!;
                  const lo = Math.min(r.previousRate, r.currentRate);
                  const hi = Math.max(r.previousRate, r.currentRate);
                  const mult = r.previousRate > 0 ? r.currentRate / r.previousRate : null;
                  return (
                    <div
                      key={i.id}
                      className="issb-dumb-r"
                      {...tipOn(
                        <>
                          <b>{fx.text(i.title)}</b>
                          <div>
                            {fx.column(r.axis)}: {r.previous} {fx.pct(r.previousRate)} (n={fmt.number(r.previousTotal)}) → {r.current} {fx.pct(r.currentRate)} (n={fmt.number(r.currentTotal)})
                          </div>
                        </>,
                      )}
                    >
                      <button type="button" className="issb-dumb-l" onClick={() => f.select(i.id)}>
                        <Sev s={i.severity} />
                        <span className="issb-dumb-t">{fx.text(i.title)}</span>
                        <small className="mono">
                          {fx.column(r.axis)} · {r.previous} → {r.current}
                        </small>
                      </button>
                      <span className="issb-dumb-track">
                        {ticks.map((v) => (
                          <b key={v} className="issb-dumb-g" aria-hidden style={{ left: `${(v / max) * 100}%` }} />
                        ))}
                        <span className="issb-dumb-line" style={{ left: `${(lo / max) * 100}%`, width: `${((hi - lo) / max) * 100}%` }} />
                        <i data-dot="prev" style={{ left: `${(r.previousRate / max) * 100}%` }} />
                        <i data-dot="cur" style={{ left: `${(r.currentRate / max) * 100}%` }} />
                      </span>
                      <span className="issb-dumb-v mono">
                        <span>
                          {fx.pct(r.previousRate)} → <b>{fx.pct(r.currentRate)}</b>
                        </span>
                        {mult ? <small>{t("regression.multiple", { n: mult.toFixed(1) })}</small> : null}
                      </span>
                      <FootRef k={`iss:${i.id}`} />
                    </div>
                  );
                })}
                {tipEl}
              </div>
            )}
          </Figure>
          <Figure n={`${no}.2`} title={t("regression.figVersions")} src={t("sources.summary")}>
            <div className="issb-vers">
              {(["model_version", "pipeline_version"] as const).map((col) => (
                <div key={col}>
                  <h4>{s(`column.${col}`)}</h4>
                  <HBars
                    fx={fx}
                    rows={[...sum.columns[col]]
                      .sort((a, b) => a.value.localeCompare(b.value))
                      .map((c) => ({
                        key: c.value,
                        label: <span className="mono">{c.value}</span>,
                        value: c.fail_rate,
                        base: c.baseline_fail_rate,
                        delta: c.delta,
                        active: f.values[col].includes(c.value),
                        onClick: () => f.toggle(col, c.value),
                      }))}
                  />
                </div>
              ))}
            </div>
          </Figure>
        </div>
      )}
    </section>
  );
}
