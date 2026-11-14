"use client";
/** Summary strip above the cards: value count, worst / best mover (Δ vs baseline) and top-3 concentration. */
import { Layers, TrendingDown, TrendingUp, Target } from "lucide-react";
import Link from "next/link";
import { useT } from "@/i18n/client";
import type { IssueBreakdown } from "@/lib/types";
import { useIssueFormat, type IssueViewLinks } from "../../issues-shared";
import type { ValueText } from "./labels";
import { Delta } from "./marks";

export function SummaryStrip({ dim, data, vt, V }: { dim: string; data: IssueBreakdown; vt: ValueText; V: IssueViewLinks }) {
  const t = useT("issuesCategories");
  const fx = useIssueFormat();
  const withDelta = data.items.filter((i) => i.delta != null);
  const worst = withDelta.length ? withDelta.reduce((a, b) => ((b.delta as number) > (a.delta as number) ? b : a)) : null;
  const best = withDelta.length ? withDelta.reduce((a, b) => ((b.delta as number) < (a.delta as number) ? b : a)) : null;
  const top3 = [...data.items].sort((a, b) => b.fails - a.fails).slice(0, 3);
  const conc = top3.reduce((n, i) => n + i.share, 0);
  const n = data.items.length + data.truncated;
  return (
    <dl className="cat-summary">
      <div>
        <dt>
          <Layers aria-hidden="true" />
          {t("summary.values")}
        </dt>
        <dd className="cat-sum-big mono">{n}</dd>
        <dd className="cat-sum-sub">
          {t("summary.valuesOf", { dim: vt.dim(dim), count: n })} · <span className="mono">{t("summary.fails", { fails: data.totals.fails.toLocaleString("en-US"), total: data.totals.total.toLocaleString("en-US") })}</span>
        </dd>
      </div>
      <Mover kind="worst" icon={<TrendingUp aria-hidden="true" />} item={worst && (worst.delta as number) > 0 ? worst : null} dim={dim} vt={vt} V={V} />
      <Mover kind="best" icon={<TrendingDown aria-hidden="true" />} item={best && (best.delta as number) < 0 ? best : null} dim={dim} vt={vt} V={V} />
      <div>
        <dt>
          <Target aria-hidden="true" />
          {t("summary.concentration")}
        </dt>
        <dd className="cat-sum-big mono">{fx.pct(Math.min(100, conc))}</dd>
        <dd className="cat-conc" aria-hidden="true">
          {top3.map((i, k) => (
            <i key={i.value} style={{ width: `${i.share}%`, opacity: 1 - k * 0.25 }} />
          ))}
        </dd>
        <dd className="cat-sum-sub">{t("summary.concentrationOf", { share: Math.min(100, conc).toFixed(1), names: top3.map((i) => vt.label(dim, i.value)).join(", ") })}</dd>
      </div>
    </dl>
  );
}

function Mover({ kind, icon, item, dim, vt, V }: { kind: "worst" | "best"; icon: React.ReactNode; item: IssueBreakdown["items"][number] | null; dim: string; vt: ValueText; V: IssueViewLinks }) {
  const t = useT("issuesCategories");
  const fx = useIssueFormat();
  return (
    <div data-kind={kind} data-empty={item ? undefined : true}>
      <dt>
        {icon}
        {t(`summary.${kind}`)}
      </dt>
      {item ? (
        <>
          <dd className="cat-sum-name">
            <Link href={V.drillHref(dim, item.value)}>{vt.label(dim, item.value)}</Link>
          </dd>
          <dd className="cat-sum-sub">
            <Delta value={item.delta} /> <span className="mono">{fx.pct(item.baseline_fail_rate)} → {fx.pct(item.fail_rate)}</span>
          </dd>
        </>
      ) : (
        <dd className="cat-sum-name muted">{t("summary.none")}</dd>
      )}
    </div>
  );
}
