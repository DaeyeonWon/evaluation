"use client";
/** Issue detail — score anatomy (waterfall of the six factor contributions on one 0–100 axis) + why flagged. */
import clsx from "clsx";
import { AlertTriangle, ListOrdered } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import type { IssueDetail, IssueFactor, IssueFactorKey } from "@/lib/types";
import type { IssueFormat } from "../../issues-shared";
import { Plate } from "../../ui";
import { FACTOR_ORDER, SCORE_BANDS } from "./lib";

const fv = (k: IssueFactorKey) => `var(--fa-${k})`;

/** plain-language explanation of a factor's raw detail */
function useFactorNote(fx: IssueFormat) {
  const t = useT("issuesDetail");
  return (f: IssueFactor): string | null => {
    const dt = f.detail;
    const n = (k: string) => (typeof dt[k] === "number" ? (dt[k] as number) : dt[k] != null ? Number(dt[k]) : null);
    switch (f.key) {
      case "volume":
        return n("count") != null ? t("anatomy.note.volume", { count: n("count")!, max: n("max") ?? n("count")! }) : null;
      case "severity":
        return dt.cls ? t("anatomy.note.severity", { cls: fx.cls(dt.cls as never) }) : null;
      case "trend":
        return n("observed") != null && n("expected") != null ? t("anatomy.note.trend", { observed: n("observed")!, expected: (n("expected") ?? 0).toFixed(1), z: (n("z") ?? 0).toFixed(1) }) : null;
      case "regression":
        return f.contribution > 0 && dt.current ? t("anatomy.note.regression", { current: String(dt.current), previous: String(dt.previous ?? "—") }) : t("anatomy.note.noRegression");
      case "reach":
        return n("markets") != null ? t("anatomy.note.reach", { markets: n("markets")!, devices: n("devices") ?? 0, divisions: n("divisions") ?? 0, languages: n("languages") ?? 0 }) : null;
      case "novelty":
        if (n("new_cluster")) return t("anatomy.note.newCluster", { share: n("novel_share") ?? 0 });
        return (n("novel_share") ?? 0) > 0 ? t("anatomy.note.novelShare", { share: n("novel_share")! }) : t("anatomy.note.noNovelty");
    }
    return null;
  };
}

export function Anatomy({ d, fx }: { d: IssueDetail; fx: IssueFormat }) {
  const t = useT("issuesDetail");
  const note = useFactorNote(fx);
  const [hover, setHover] = useState<IssueFactorKey | null>(null);
  const rows = FACTOR_ORDER.map((k) => d.factors.find((f) => f.key === k)).filter((f): f is IssueFactor => !!f);
  const steps = rows.map((f, n) => {
    const start = rows.slice(0, n).reduce((a, x) => a + x.contribution, 0);
    return { f, start, end: start + f.contribution };
  });
  const total = d.score;
  return (
    <Plate title={<>{t("anatomy.title")}</>} refText={t("anatomy.ref", { score: fx.score(total) })} className="idt-anat-plate">
      <div className="idt-anat-wrap">
        <div className="idt-wf" role="table" aria-label={t("anatomy.aria")}>
          <div className="idt-wf-axis" aria-hidden>
            <span />
            <span className="idt-wf-scale">
              {[0, 20, 40, 60, 80, 100].map((x) => (
                <i key={x} style={{ left: `${x}%` }}>
                  {x}
                </i>
              ))}
            </span>
            <span />
          </div>
          {steps.map(({ f, start, end }, n) => (
            <div
              key={f.key}
              role="row"
              className={clsx("idt-wf-row", hover && hover !== f.key && "dim")}
              style={{ ["--fc" as string]: fv(f.key), ["--d" as string]: `${n * 70}ms` } as CSSProperties}
              onMouseEnter={() => setHover(f.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(f.key)}
              onBlur={() => setHover(null)}
              tabIndex={0}
            >
              <span role="rowheader" className="idt-wf-k">
                <i aria-hidden />
                <b>{fx.factor(f.key)}</b>
                <small className="mono">{t("anatomy.weight", { w: f.weight })}</small>
              </span>
              <span role="cell" className="idt-wf-track" aria-label={t("anatomy.rowAria", { factor: fx.factor(f.key), pts: f.contribution.toFixed(1), w: f.weight, v: Math.round(f.value * 100) })}>
                {SCORE_BANDS.map((b) => (
                  <em key={b.sev} className="idt-wf-band" style={{ left: `${b.at}%` }} aria-hidden />
                ))}
                <span className="idt-wf-cap" style={{ left: `${start}%`, width: `${f.weight}%` }} aria-hidden />
                {f.contribution > 0.05 ? (
                  <span className="idt-wf-bar" style={{ left: `${start}%`, width: `${end - start}%` }} aria-hidden />
                ) : (
                  <span className="idt-wf-zero" style={{ left: `${start}%` }} aria-hidden />
                )}
                {n < steps.length - 1 ? <span className="idt-wf-link" style={{ left: `${end}%` }} aria-hidden /> : null}
              </span>
              <span role="cell" className="idt-wf-pts mono">
                +{f.contribution.toFixed(1)}
                <small>/{f.weight}</small>
              </span>
              <span className="idt-wf-help">
                <span>{fx.factorHelp(f.key)}</span>
                {note(f) ? <span className={clsx("idt-wf-note", f.contribution === 0 && "zero")}>{note(f)}</span> : null}
              </span>
            </div>
          ))}
          <div role="row" className="idt-wf-row idt-wf-total" style={{ ["--d" as string]: `${steps.length * 70}ms` } as CSSProperties}>
            <span role="rowheader" className="idt-wf-k">
              <i aria-hidden className="idt-wf-noi" />
              <b>{t("anatomy.total")}</b>
              <small className="mono">= Criticality</small>
            </span>
            <span role="cell" className="idt-wf-track" data-sev={d.severity}>
              {SCORE_BANDS.map((b) => (
                <em key={b.sev} className="idt-wf-band lbl" style={{ left: `${b.at}%` }} data-l={b.sev} aria-hidden />
              ))}
              <span className="idt-wf-bar total" style={{ left: 0, width: `${Math.min(100, total)}%` }} aria-hidden />
            </span>
            <span role="cell" className="idt-wf-pts mono total">{fx.score(total)}</span>
          </div>
        </div>
        <section className="idt-why" aria-labelledby="idt-why-h">
          <h3 id="idt-why-h">
            <ListOrdered aria-hidden /> {t("why.title")}
          </h3>
          <ol>
            {d.reasons.map((r, n) => (
              <li key={n}>
                <span className="mono idt-why-n">{String(n + 1).padStart(2, "0")}</span>
                <span>{fx.text(r)}</span>
              </li>
            ))}
          </ol>
          {d.regression ? (
            <div className="note warn idt-why-reg">
              <AlertTriangle aria-hidden />{" "}
              {t("why.regression", {
                axis: fx.column(d.regression.axis),
                current: d.regression.current,
                curRate: fx.pct(d.regression.currentRate),
                previous: d.regression.previous,
                prevRate: fx.pct(d.regression.previousRate),
              })}
            </div>
          ) : null}
          {!d.baseline.sufficient ? <div className="note warn">{fx.t("baseline.insufficient")}</div> : null}
        </section>
      </div>
    </Plate>
  );
}
