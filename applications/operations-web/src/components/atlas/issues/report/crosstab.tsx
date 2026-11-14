"use client";
/**
 * Report view — impact level × type cross-tab (§ User impact, § Must-handle misses).
 * Rows are the shared impact grouping (P0 Critical … P3 Low), columns the lens type
 * (user_impact or dev_miss). Cells = issues, single-hue sequential shading on one scale; the foot row
 * carries each type's share of FAILs and its change vs baseline. Every cell links to Triage with
 * the current query + that level and type (and the matching lens).
 */
import clsx from "clsx";
import Link from "next/link";
import { useFmt, useT } from "@/i18n/client";
import type { IssueBreakdownItem, IssueSeverity } from "@/lib/types";
import type { IssueFormat } from "../../issues-shared";
import { Delta, ImpactTag, useTip } from "./bits";

export const LEVELS: IssueSeverity[] = ["P0", "P1", "P2", "P3"];

export interface CrossCol {
  value: string;
  muted?: boolean;
}

export function CrossTab({
  dim,
  cols,
  items,
  fx,
  href,
  label,
}: {
  dim: "user_impact" | "dev_miss";
  cols: CrossCol[];
  items: IssueBreakdownItem[];
  fx: IssueFormat;
  href: (level: IssueSeverity | null, value: string | null) => string;
  label: string;
}) {
  const t = useT("issuesReport");
  const fmt = useFmt();
  const { attach, on, el } = useTip();
  const by = new Map(items.map((i) => [i.value, i]));
  const max = Math.max(1, ...items.flatMap((i) => LEVELS.map((l) => i.by_severity[l] ?? 0)));
  const rowTotal = (l: IssueSeverity) => cols.reduce((a, c) => a + (by.get(c.value)?.by_severity[l] ?? 0), 0);
  const g = dim === "user_impact" ? "userImpact" : "devMiss";
  return (
    <div className="issb-xt-wrap" ref={attach}>
      <div className="issb-xt-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className="issb-xt" style={{ ["--cols" as string]: cols.length }}>
          <thead>
            <tr>
              <th scope="col" className="issb-xt-corner">
                <span>{t("xt.level")}</span>
                <span>{t("xt.type")}</span>
              </th>
              {cols.map((c) => (
                <th key={c.value} scope="col" data-muted={c.muted || undefined} title={fx.t.dynamic(`${g}Help.${c.value}`, undefined, "")}>
                  <Link href={href(null, c.value)}>{fx.value(dim, c.value)}</Link>
                </th>
              ))}
              <th scope="col" className="issb-xt-sum">
                {t("xt.issues")}
              </th>
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((l) => (
              <tr key={l} data-sev={l}>
                <th scope="row">
                  <Link href={href(l, null)}>
                    <ImpactTag s={l} />
                  </Link>
                </th>
                {cols.map((c) => {
                  const it = by.get(c.value);
                  const n = it?.by_severity[l] ?? 0;
                  return (
                    <td key={c.value} data-muted={c.muted || undefined} data-zero={!n || undefined}>
                      {n ? (
                        <Link
                          href={href(l, c.value)}
                          className="issb-xt-cell"
                          style={{ ["--a" as string]: (0.12 + 0.88 * (n / max)).toFixed(3) }}
                          aria-label={t("xt.cellAria", { level: l, type: fx.value(dim, c.value), count: n })}
                          {...on(
                            <>
                              <b>
                                {l} · {fx.value(dim, c.value)}
                              </b>
                              <div>{t("xt.cellTip", { count: n })}</div>
                              <div>{t("xt.drill")}</div>
                            </>,
                          )}
                        >
                          {n}
                        </Link>
                      ) : (
                        <span className="issb-xt-cell" aria-hidden>
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="issb-xt-sum mono">{rowTotal(l) || "·"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{t("xt.share")}</th>
              {cols.map((c) => {
                const it = by.get(c.value);
                return (
                  <td key={c.value} data-muted={c.muted || undefined}>
                    <span className="issb-xt-share">
                      <i style={{ width: `${Math.min(100, it?.share ?? 0)}%` }} />
                    </span>
                    <span className="mono">{it ? fx.pct(it.share) : "—"}</span>
                    {it ? <Delta d={it.delta} fx={fx} /> : null}
                    {it ? <small className="mono">FAIL {fmt.number(it.fails)}</small> : null}
                  </td>
                );
              })}
              <td className={clsx("issb-xt-sum")} />
            </tr>
          </tfoot>
        </table>
      </div>
      {el}
    </div>
  );
}

/** Legend for the cross-tab shading + the delta colours used in its foot row. */
export function CrossLegend() {
  const t = useT("issuesReport");
  return (
    <span className="issb-legend" role="list">
      <span role="listitem">
        <i className="issb-xt-key" aria-hidden /> {t("xt.legendShade")}
      </span>
      <span role="listitem">
        <i data-dir="up" /> {t("markets.worse")}
      </span>
      <span role="listitem">
        <i data-dir="down" /> {t("markets.better")}
      </span>
    </span>
  );
}
