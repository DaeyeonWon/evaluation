"use client";
/**
 * Issue detail — this issue split by division, region, market, device, bixby_version, model_version and
 * language (detail breakdowns). Each dim is a small bar list (one hue, length = FAIL count); every value
 * drills to Triage with that filter, and the arrow opens the issue's rows for that value in /results.
 */
import clsx from "clsx";
import { ArrowUpRight, Boxes } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { LangBadge } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { IssueColumnStat, IssueDetail } from "@/lib/types";
import { useDimLabel, type IssueFormat } from "../../issues-shared";
import { Plate } from "../../ui";

const COLLAPSED = 6;

function DimList({
  dim,
  stats,
  fx,
  total,
  drill,
  results,
  current,
}: {
  dim: string;
  stats: IssueColumnStat[];
  fx: IssueFormat;
  total: number;
  drill: (dim: string, v: string) => string;
  results: (dim: string, v: string) => string;
  current: string[];
}) {
  const t = useT("issuesDetail");
  const fm = useFmt();
  const dl = useDimLabel();
  const [all, setAll] = useState(false);
  const rows = stats.filter((r) => r.fails > 0 || stats.length <= COLLAPSED);
  const shown = all ? rows : rows.slice(0, COLLAPSED);
  const max = Math.max(1, ...rows.map((r) => r.fails));
  const label = dl.dim(dim);
  return (
    <section className="idt-bd" aria-label={label} data-dim={dim}>
      <h3>
        <span>{label}</span>
        <small className="mono muted">{t("bd.values", { n: rows.length })}</small>
      </h3>
      {shown.length ? (
        <ul>
          {shown.map((r, n) => {
            const v = dl.value(dim, r.value);
            const share = total ? (r.fails / total) * 100 : 0;
            const dir = r.delta == null ? "flat" : r.delta > 0.5 ? "up" : r.delta < -0.5 ? "down" : "flat";
            return (
              <li key={r.value} className={clsx(current.includes(r.value) && "on")} style={{ ["--d" as string]: `${n * 40}ms` } as CSSProperties}>
                <Link
                  href={drill(dim, r.value)}
                  className="idt-bd-row"
                  title={t("bd.rowTitle", { value: v, fails: fm.number(r.fails), total: fm.number(r.total), rate: fx.pct(r.fail_rate), delta: fx.pp(r.delta) })}
                >
                  <span className="idt-bd-l">
                    {dim === "language" ? <LangBadge lang={r.value as never} /> : null}
                    <span>{v}</span>
                  </span>
                  <span className="idt-bd-bar" aria-hidden>
                    <i style={{ width: `${(r.fails / max) * 100}%` }} />
                  </span>
                  <span className="mono idt-bd-n">{fm.number(r.fails)}</span>
                  <span className="mono idt-bd-r">
                    {fx.pct(r.fail_rate)}
                    <small className="idt-dv" data-dir={dir}>
                      {r.delta == null ? "" : fx.pp(r.delta)}
                    </small>
                  </span>
                  <span className="sr">{t("bd.share", { share: share.toFixed(0) })}</span>
                </Link>
                <Link href={results(dim, r.value)} className="idt-bd-go" aria-label={t("bd.results", { value: v })} title={t("bd.results", { value: v })}>
                  <ArrowUpRight aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted idt-bd-empty">{t("bd.empty")}</p>
      )}
      {rows.length > COLLAPSED ? (
        <button type="button" className="btn sm ghost idt-bd-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? t("bd.less") : t("bd.more", { n: rows.length - COLLAPSED })}
        </button>
      ) : null}
    </section>
  );
}

export function Breakdowns({
  d,
  fx,
  items,
  drill,
  results,
  current,
}: {
  d: IssueDetail;
  fx: IssueFormat;
  items: { dim: string; stats: IssueColumnStat[] }[];
  drill: (dim: string, v: string) => string;
  results: (dim: string, v: string) => string;
  current: (dim: string) => string[];
}) {
  const t = useT("issuesDetail");
  return (
    <Plate title={<><Boxes aria-hidden /> {t("bd.title")}</>} refText={t("bd.ref")}>
      <p className="idt-lead">{t("bd.lead")}</p>
      <div className="idt-bds">
        {items.map((b) => (
          <DimList key={b.dim} dim={b.dim} stats={b.stats} fx={fx} total={d.count} drill={drill} results={results} current={current(b.dim)} />
        ))}
      </div>
    </Plate>
  );
}
