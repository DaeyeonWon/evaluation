"use client";
/**
 * Ordered chart for dims with a natural order.
 *   bixby_version: FAIL rate per version (oldest → newest) with baseline ticks, plus small multiples per division
 *                  (GET /issues/matrix x=bixby_version y=division). A step ≥ REGRESSION_PP above the previous
 *                  version (with enough volume) is marked as a regression.
 *   severity:      FAILs per impact level P0 → P3 (reserved severity colours, always with the P-label).
 */
import clsx from "clsx";
import { TriangleAlert } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useT } from "@/i18n/client";
import { BIXBY_VERSIONS, DIVISIONS } from "@/lib/catalog";
import type { IssueBreakdown } from "@/lib/types";
import { useIssueFormat, useIssueMatrix, type IssueFiltersApi, type IssueViewLinks } from "../../issues-shared";
import type { ValueText } from "./labels";
import { REGRESSION_PP, naturalItems } from "./state";

interface Bar {
  key: string;
  label: string;
  value: number | null;
  base: number | null;
  /** readout above the bar */
  top: string;
  /** caption under the bar */
  cap: string;
  tip: string;
  sev?: string;
  reg?: string | null;
  href?: string;
}

/** a step counts when both sides have volume */
const MIN_TOTAL = 30;
const MIN_FAILS = 5;
interface Pt {
  v: string;
  rate: number | null;
  fails: number;
  total: number;
}
function regressions(pts: Pt[]): Map<string, { from: string; pp: number }> {
  const out = new Map<string, { from: string; pp: number }>();
  let prev: Pt | null = null;
  for (const p of pts) {
    if (p.rate == null || p.total < MIN_TOTAL) continue;
    if (prev && prev.rate != null && p.fails >= MIN_FAILS && p.rate - prev.rate >= REGRESSION_PP) out.set(p.v, { from: prev.v, pp: p.rate - prev.rate });
    prev = p;
  }
  return out;
}

function Bars({ bars, max, compact, ariaLabel }: { bars: Bar[]; max: number; compact?: boolean; ariaLabel: string }) {
  const [hi, setHi] = useState<string | null>(null);
  const h = (v: number | null) => (v == null ? 0 : Math.max(1.5, (v / (max || 1)) * 84));
  return (
    <div className={clsx("cat-ob", compact && "compact")} role="list" aria-label={ariaLabel}>
      {bars.map((b, i) => (
        <div
          key={b.key}
          role="listitem"
          className={clsx("cat-ob-col", b.reg && "reg", b.value == null && "nil", hi === b.key && "hi")}
          data-sev={b.sev}
          style={{ ["--i" as string]: i } as CSSProperties}
          onMouseEnter={() => setHi(b.key)}
          onMouseLeave={() => setHi(null)}
          onFocus={() => setHi(b.key)}
          onBlur={() => setHi(null)}
          tabIndex={0}
          aria-label={b.tip}
        >
          <span className="cat-ob-flag">
            {b.reg ? (
              <span className="cat-ob-reg mono">
                <TriangleAlert aria-hidden="true" />
                {b.reg}
              </span>
            ) : null}
          </span>
          <div className="cat-ob-plot">
            <span className="cat-ob-val mono" style={{ bottom: `${h(b.value)}%` }}>
              {b.value == null ? "—" : b.top}
            </span>
            <i className="cat-ob-bar" style={{ height: `${h(b.value)}%` }} />
            {b.base != null ? <i className="cat-ob-base" style={{ bottom: `${h(b.base)}%` }} /> : null}
          </div>
          <span className="cat-ob-x mono">{b.label}</span>
          {!compact && b.cap ? <span className="cat-ob-cap">{b.cap}</span> : null}
          {hi === b.key ? (
            <span className="cat-ob-tip" data-edge={i === 0 ? "l" : i === bars.length - 1 ? "r" : "c"}>
              {b.tip}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Legend({ regression }: { regression: boolean }) {
  const t = useT("issuesCategories");
  return (
    <ul className="cat-ob-legend">
      <li>
        <i className="sw bar" />
        {t("ordered.legendRate")}
      </li>
      <li>
        <i className="sw base" />
        {t("ordered.legendBaseline")}
      </li>
      {regression ? (
        <li>
          <i className="sw reg" />
          {t("ordered.legendRegression")}
        </li>
      ) : null}
    </ul>
  );
}

export function OrderedChart({ dim, data, f, vt, V }: { dim: string; data: IssueBreakdown; f: IssueFiltersApi; vt: ValueText; V: IssueViewLinks }) {
  return dim === "bixby_version" ? <VersionChart data={data} f={f} vt={vt} V={V} /> : <ImpactChart data={data} vt={vt} />;
}

function VersionChart({ data, f, vt }: { data: IssueBreakdown; f: IssueFiltersApi; vt: ValueText; V: IssueViewLinks }) {
  const t = useT("issuesCategories");
  const fx = useIssueFormat();
  const items = naturalItems("bixby_version", data.items);
  const pp = (n: number) => fx.pp(n);
  const tip = (v: string, rate: number | null, fails: number, total: number, base: number | null) =>
    t("ordered.tip", { value: v, rate: fx.pct(rate), fails: fails.toLocaleString("en-US"), total: total.toLocaleString("en-US"), base: fx.pct(base) });

  const regAll = regressions(items.map((i) => ({ v: i.value, rate: i.fail_rate, fails: i.fails, total: i.total })));
  const overall: Bar[] = items.map((i) => ({
    key: i.value,
    label: i.value,
    value: i.fail_rate,
    base: i.baseline_fail_rate,
    top: fx.pct(i.fail_rate),
    cap: vt.help("bixby_version", i.value),
    tip: tip(i.value, i.fail_rate, i.fails, i.total, i.baseline_fail_rate),
    reg: regAll.get(i.value) ? pp(regAll.get(i.value)!.pp) : null,
  }));

  const mx = useIssueMatrix(f, { x: "bixby_version", y: "division", metric: "fail_rate" });
  const m = mx.data;
  const versions = BIXBY_VERSIONS.filter((v) => m?.x_values.includes(v) || items.some((i) => i.value === v));
  const divs = m ? DIVISIONS.filter((d) => m.y_values.includes(d)) : [];
  const panels = divs.map((d) => {
    const cells = versions.map((v) => m!.cells.find((c) => c.x === v && c.y === d));
    const pts: Pt[] = versions.map((v, k) => ({ v, rate: cells[k]?.total ? (cells[k]!.fail_rate ?? null) : null, fails: cells[k]?.fails ?? 0, total: cells[k]?.total ?? 0 }));
    const reg = regressions(pts);
    return {
      d,
      reg,
      bars: versions.map((v, k): Bar => {
        const c = cells[k];
        const has = !!c && c.total > 0;
        const r = reg.get(v);
        return {
          key: v,
          label: v.replace("-beta", "β"),
          value: has ? c!.fail_rate : null,
          base: has ? c!.baseline_fail_rate : null,
          top: has && c!.fail_rate != null ? c!.fail_rate.toFixed(1) : "—",
          cap: "",
          tip: has ? `${vt.label("division", d)} · ${tip(v, c!.fail_rate, c!.fails, c!.total, c!.baseline_fail_rate)}` : `${vt.label("division", d)} · ${v}: ${t("ordered.noData")}`,
          reg: r ? pp(r.pp) : null,
        };
      }),
    };
  });
  const allRegs = [
    ...[...regAll.entries()].map(([v, r]) => ({ scope: t("ordered.overall"), v, ...r })),
    ...(panels.length > 1 ? panels : []).flatMap((p) => [...p.reg.entries()].map(([v, r]) => ({ scope: vt.label("division", p.d), v, ...r }))),
  ].sort((a, b) => b.pp - a.pp);
  const max = Math.max(1, ...items.flatMap((i) => [i.fail_rate ?? 0, i.baseline_fail_rate ?? 0]), ...panels.flatMap((p) => p.bars.flatMap((b) => [b.value ?? 0, b.base ?? 0])));

  return (
    <section className="cat-ordered" aria-labelledby="cat-ob-h">
      <header>
        <div>
          <h3 id="cat-ob-h">{t("ordered.versionTitle")}</h3>
          <p>{t("ordered.versionLead", { pp: pp(REGRESSION_PP) })}</p>
        </div>
        <Legend regression={allRegs.length > 0} />
      </header>
      <div className={clsx("cat-ob-grid", panels.length < 2 && "single")}>
        <div className="cat-ob-main">
          <span className="cat-ob-k">{t("ordered.overall")}</span>
          <Bars bars={overall} max={max} ariaLabel={t("ordered.versionTitle")} />
        </div>
        {panels.length > 1 ? (
          <div className="cat-ob-multi">
            <span className="cat-ob-k">{t("ordered.byDivision")}</span>
            <div className="cat-ob-panels">
              {panels.map((p) => (
                <div key={p.d} className={clsx("cat-ob-panel", p.reg.size && "reg")}>
                  <b>{vt.label("division", p.d)}</b>
                  <Bars bars={p.bars} max={max} compact ariaLabel={`${vt.label("division", p.d)} · ${t("ordered.versionTitle")}`} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <p className={clsx("cat-ob-note", allRegs.length && "reg")}>
        {allRegs.length ? <TriangleAlert aria-hidden="true" /> : null}
        {allRegs.length
          ? allRegs
              .slice(0, 3)
              .map((r) => `${r.scope} · ${t("ordered.regression", { from: r.from, to: r.v, pp: pp(r.pp) })}`)
              .join("   ·   ")
          : t("ordered.noRegression")}
      </p>
    </section>
  );
}

function ImpactChart({ data, vt }: { data: IssueBreakdown; vt: ValueText }) {
  const t = useT("issuesCategories");
  const fx = useIssueFormat();
  const items = naturalItems("severity", data.items);
  const max = Math.max(1, ...items.map((i) => i.fails));
  const bars: Bar[] = items.map((i) => ({
    key: i.value,
    label: vt.label("severity", i.value),
    value: i.fails,
    base: null,
    top: i.fails.toLocaleString("en-US"),
    cap: `${t("card.share", { share: i.share.toFixed(1) })} · ${i.issues} ${t("card.issues")}`,
    tip: `${vt.label("severity", i.value)}: FAIL ${i.fails.toLocaleString("en-US")} · ${i.issues} ${t("card.issues")} · ${fx.pct(i.fail_rate)}`,
    sev: i.value,
  }));
  return (
    <section className="cat-ordered" aria-labelledby="cat-ob-h">
      <header>
        <div>
          <h3 id="cat-ob-h">{t("ordered.impactTitle")}</h3>
          <p>{t("ordered.impactLead")}</p>
        </div>
      </header>
      <div className="cat-ob-main wide">
        <Bars bars={bars} max={max} ariaLabel={t("ordered.impactTitle")} />
      </div>
    </section>
  );
}
