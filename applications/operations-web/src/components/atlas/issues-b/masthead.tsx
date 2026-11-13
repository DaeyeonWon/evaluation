"use client";
/**
 * Market Brief — masthead: edition line, period / baseline / model versions / scope, a generated
 * headline (top-ranked insight) + standfirst (overall insight), and the KPI ledger with the FAIL-rate trend.
 */
import { ClipboardCopy, FileDown, FileText } from "lucide-react";
import { useFmt, useT } from "@/i18n/client";
import type { InsightList, IssueSummary } from "@/lib/types";
import { useTween } from "@/components/shared";
import type { IssueFiltersApi, IssueFormat, useIssueExport } from "../issues-shared";
import { Skeleton } from "../ui";
import { Delta, FootRef, isoWeek, Spark, useTip } from "./bits";

export function Masthead({ sum, ins, f, fx, ex }: { sum: IssueSummary | undefined; ins: InsightList | undefined; f: IssueFiltersApi; fx: IssueFormat; ex: ReturnType<typeof useIssueExport> }) {
  const t = useT("issuesB");
  const s = useT("issues");
  const fmt = useFmt();
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const k = sum?.kpis;
  const range = sum?.range;
  const preset = range?.preset ?? f.range.resolved.preset;
  const presetKey = preset === "today" || preset === "7d" || preset === "30d" ? preset : "custom";
  const wk = range ? isoWeek(range.to) : null;
  const items = ins?.items ?? [];
  const headline = items.find((i) => i.kind !== "overall" && (i.severity === "P0" || i.severity === "P1"));
  const overall = items.find((i) => i.kind === "overall");
  const bl = sum?.baseline;
  const models = (sum?.columns.model_version ?? []).map((c) => c.value).sort();
  const pts = sum?.trend.points ?? [];
  const rate = useTween(k?.fail_rate ?? 0, { decimals: 1 });

  return (
    <header className="issb-mast">
      <div className="issb-mast-rule">
        <span className="issb-kicker">{t("kicker")}</span>
        <span className="issb-edition">
          <i className="issb-live" aria-hidden />
          <b>{t(`editionPreset.${presetKey}`)}</b>
          {wk ? <span>{t("edition", { year: String(wk.year), no: String(wk.week).padStart(2, "0") })}</span> : null}
        </span>
      </div>

      <div className="issb-mast-title">
        <h1>
          <span className="issb-brand">{t("brand")}</span>
          <span className="issb-brand-sub">{s("title")}</span>
        </h1>
        <div className="issb-export" role="group" aria-label={t("export.title")}>
          <button type="button" className="btn sm" onClick={() => void ex.copyMarkdown()}>
            <ClipboardCopy aria-hidden />
            {t("export.copy")}
          </button>
          <a className="btn sm" href={ex.csvUrl} download>
            <FileDown aria-hidden />
            {t("export.csv")}
          </a>
          <a className="btn sm ghost" href={ex.markdownUrl} download>
            <FileText aria-hidden />
            {t("export.md")}
          </a>
        </div>
      </div>

      <dl className="issb-mast-meta">
        <div>
          <dt>{t("mast.period")}</dt>
          <dd>{range ? `${fmt.dateTimeLabel(range.from)} — ${fmt.dateTimeLabel(range.to)}` : "—"}</dd>
        </div>
        <div>
          <dt>{t("mast.baseline")}</dt>
          <dd>
            {bl ? (
              <>
                {s(`baseline.mode.${bl.mode}`)}
                <small>{s("baseline.window", { from: fmt.dateLabel(bl.from), to: fmt.dateLabel(bl.to), days: bl.days })}</small>
                {!bl.sufficient ? <small className="issb-warn">{s("baseline.insufficient")}</small> : null}
                {bl.relaxed_columns?.length ? (
                  <small className="issb-warn" data-relaxed="">
                    {t("mast.relaxed", { columns: bl.relaxed_columns.map((c) => fx.column(c)).join(", ") })}
                  </small>
                ) : null}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt>{t("mast.models")}</dt>
          <dd className="issb-models">
            {models.length
              ? models.map((m, i) => (
                  <span key={m} data-new={i === models.length - 1 && models.length > 1 ? "" : undefined}>
                    {m}
                  </span>
                ))
              : "—"}
          </dd>
        </div>
        <div>
          <dt>{t("mast.scope")}</dt>
          <dd>{k ? t("mast.scopeValue", { utterances: fmt.number(k.utterances), fails: fmt.number(k.fails) }) : "—"}</dd>
        </div>
      </dl>

      {!sum || !ins ? (
        <Skeleton rows={3} />
      ) : (
        <div className="issb-lede">
          <p className="issb-headline">
            {headline ? fx.insight(headline) : t("mast.noCritical")}
            {headline ? <FootRef k={`ins:${headline.id}`} /> : null}
          </p>
          {overall ? (
            <p className="issb-standfirst">
              {fx.insight(overall)}
              <FootRef k={`ins:${overall.id}`} />
            </p>
          ) : null}
        </div>
      )}

      <div className="issb-ledger">
        <div className="issb-ledger-hero" ref={tipAttach}>
          <span className="issb-ledger-k">{t("kpi.failRate")}</span>
          <span className="issb-ledger-v">
            {k?.fail_rate != null ? rate.toFixed(1) : "—"}
            <small>%</small>
          </span>
          <span className="issb-ledger-s">
            <Delta d={k?.fail_rate_delta} fx={fx} /> {k?.baseline_fail_rate != null ? t("mast.vsBaseline", { rate: fx.pct(k.baseline_fail_rate) }) : null}
          </span>
          <div className="issb-ledger-spark" aria-label={t("mast.figTrend")}>
            <Spark values={pts.map((p) => p.fail_rate)} base={k?.baseline_fail_rate} w={220} h={44} label={t("mast.figTrend")} />
            <div className="issb-spark-hits">
              {pts.map((p) => (
                <span
                  key={p.t}
                  tabIndex={0}
                  {...tipOn(
                    <>
                      <b>{sum?.trend.bucket === "hour" ? fmt.dateTimeLabel(p.t) : fmt.dateLabel(p.t)}</b>
                      <div>
                        {s("kpi.failRate")} {fx.pct(p.fail_rate)} · FAIL {fmt.number(p.fails)} / {fmt.number(p.total)}
                      </div>
                    </>,
                  )}
                />
              ))}
            </div>
          </div>
          {tipEl}
        </div>
        <Ledger label={t("kpi.critical")} value={k?.critical_open} sub={k ? t("kpi.ofIssues", { n: fmt.number(k.issues) }) : ""} tone="p0" onClick={() => f.set({ severity: ["P0", "P1"] })} />
        <Ledger label={t("kpi.safety")} value={k?.safety_issues} sub={s("severityClass.safety")} tone="safety" onClick={() => f.only("severity_class", "safety")} />
        <Ledger label={t("kpi.patterns")} value={k?.new_patterns} sub={s("novelty.new")} tone="new" href="#issb-patterns" />
        <Ledger label={t("kpi.regressions")} value={k?.regressions} sub={s("factor.regression.label")} href="#issb-regression" />
        <Ledger label={t("kpi.markets")} value={k?.markets_affected} sub={marketList(sum?.market_matrix.cols ?? [])} href="#issb-markets" />
      </div>
    </header>
  );
}

function marketList(cols: string[]) {
  return cols.length > 4 ? `${cols.slice(0, 4).join(" · ")} +${cols.length - 4}` : cols.join(" · ");
}

function Ledger({ label, value, sub, tone, onClick, href }: { label: string; value: number | undefined; sub: string; tone?: string; onClick?: () => void; href?: string }) {
  const v = useTween(value ?? 0);
  const body = (
    <>
      <span className="issb-ledger-k">{label}</span>
      <span className="issb-ledger-v">{value == null ? "—" : Math.round(v)}</span>
      <span className="issb-ledger-s">{sub}</span>
    </>
  );
  if (href)
    return (
      <a className="issb-ledger-c" data-tone={tone} href={href}>
        {body}
      </a>
    );
  return (
    <button type="button" className="issb-ledger-c" data-tone={tone} onClick={onClick}>
      {body}
    </button>
  );
}
