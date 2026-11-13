"use client";
/**
 * Signal Lab — emerging utterance patterns (R2): a stream of new-pattern rows per kind over the compare
 * window, the pattern ladder (frequency, growth, FAIL rate, function → predicted intent, examples) and
 * the novel-term cloud. A ladder row brushes its issues (`pat`); a term searches it (q).
 */
import clsx from "clsx";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { EChart, LangBadge, type ChartTokens } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { NewPattern, PatternKind, PatternList } from "@/lib/types";
import { axisX, axisY, opt, tooltip } from "../chart";
import { useIssueFormat, useIssueLinks, type IssueFiltersApi } from "../issues-shared";
import { Skeleton, useReducedMotionSafe } from "../ui";
import { KINDS, kindVar, sparkPath } from "./lab";

function MiniSpark({ vals, kind }: { vals: number[]; kind: PatternKind }) {
  const w = 72;
  const h = 20;
  return (
    <svg className="lab-mspark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden style={{ ["--kc" as string]: kindVar(kind) }}>
      {vals.map((v, i) => {
        const max = Math.max(1, ...vals);
        const bw = w / vals.length;
        const bh = Math.max(v ? 1.5 : 0, (v / max) * (h - 2));
        return <rect key={i} x={i * bw + 0.6} y={h - bh} width={Math.max(1, bw - 1.2)} height={bh} rx="0.8" />;
      })}
      <polyline points={sparkPath(vals, w, h, 1)} />
    </svg>
  );
}

export function Patterns({ data, f, activeId, onBrush }: { data: PatternList | undefined; f: IssueFiltersApi; activeId: string | null; onBrush: (p: NewPattern | null) => void }) {
  const t = useT("issuesC");
  const s = useT("issues");
  const fx = useIssueFormat();
  const fm = useFmt();
  const L = useIssueLinks();
  const reduced = useReducedMotionSafe();
  const [kinds, setKinds] = useState<PatternKind[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const items = useMemo(() => (data?.items ?? []).filter((p) => !kinds.length || kinds.includes(p.kind)), [data, kinds]);
  const kindCount = useMemo(() => {
    const c: Record<PatternKind, number> = { new_feature_name: 0, code_switch: 0, new_term: 0, new_phrasing: 0 };
    for (const p of data?.items ?? []) c[p.kind]++;
    return c;
  }, [data]);
  const buckets = useMemo(() => data?.items[0]?.daily_t ?? [], [data]);
  const hourly = buckets.length > 1 && buckets[1] - buckets[0] < 86_400_000;

  const option = useCallback(
    (tk: ChartTokens) => {
      const labels = buckets.map((x) => (hourly ? fm.hm(x) : fm.dateLabel(x)));
      const present = KINDS.filter((k) => items.some((p) => p.kind === k));
      return opt({
        animationDuration: reduced ? 0 : 700,
        textStyle: { fontFamily: tk.font, color: tk.muted },
        grid: { left: 34, right: 10, top: 30, bottom: 24 },
        legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 6, textStyle: { color: tk.muted, fontSize: 10.5, fontFamily: tk.font }, data: present.map((k) => fx.kind(k)) },
        tooltip: tooltip(tk),
        xAxis: axisX(tk, labels, { axisLabel: { color: tk.muted, fontSize: 10, fontFamily: tk.mono, hideOverlap: true } }),
        yAxis: axisY(tk, { minInterval: 1 }),
        series: present.map((k) => ({
          type: "line",
          name: fx.kind(k),
          stack: "k",
          smooth: 0.35,
          symbol: "none",
          color: tk.read(`--issc-k-${k}`),
          lineStyle: { width: 1.5 },
          areaStyle: { opacity: 0.55 },
          emphasis: { focus: "series" },
          data: buckets.map((_, bi) => items.filter((p) => p.kind === k).reduce((a, p) => a + (p.daily[bi] ?? 0), 0)),
        })),
      });
    },
    [buckets, hourly, items, fm, fx, reduced],
  );

  if (!data) return <Skeleton rows={7} />;
  const list = showAll ? items : items.slice(0, 8);
  const maxCount = Math.max(1, ...items.map((p) => p.count));
  const terms = data.terms.filter((x) => x.term.length > 1).slice(0, 14);

  return (
    <div className="lab-pat">
      <div className="lab-kinds" role="group" aria-label={s("field.kind")}>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kinds.includes(k)}
            title={fx.kindHelp(k)}
            disabled={!kindCount[k]}
            onClick={() => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))}
            style={{ ["--kc" as string]: kindVar(k) }}
          >
            <i aria-hidden /> {fx.kind(k)} <span className="mono">{kindCount[k]}</span>
          </button>
        ))}
      </div>
      {items.length ? <EChart className="lab-stream" option={option} ariaLabel={t("pat.streamAria")} /> : null}
      {!items.length ? <div className="empty">{s("empty.patterns")}</div> : null}
      <ol className="lab-ladder-list">
        {list.map((p, idx) => {
          const on = activeId === p.id;
          const top = p.intents_predicted[0];
          const ex = open === p.id;
          return (
            <li key={p.id} className={clsx(on && "on")} style={{ ["--kc" as string]: kindVar(p.kind), ["--i" as string]: idx }}>
              <div className="lab-pl-main">
                <button type="button" className="lab-pl-btn" aria-pressed={on} onClick={() => onBrush(on ? null : p)} title={t("pat.brush")}>
                  <span className="lab-pl-tpl">
                    <LangBadge lang={p.language} />
                    <q>{p.template}</q>
                  </span>
                  <span className="lab-pl-meta">
                    <span className="lab-kind">
                      <i aria-hidden /> {fx.kind(p.kind)}
                    </span>
                    <span className="mono muted">
                      {fx.fn(p.agent_function)} · {p.intent_expected}
                      {top && top.intent !== p.intent_expected ? (
                        <>
                          {" "}
                          → <b className="lab-pred">{top.intent}</b>
                        </>
                      ) : null}
                    </span>
                  </span>
                </button>
                <MiniSpark vals={p.daily} kind={p.kind} />
                <span className="lab-pl-n">
                  <b className="mono">{fm.number(p.count)}</b>
                  <span className="lab-pl-cbar" style={{ ["--w" as string]: `${(p.count / maxCount) * 100}%` }} />
                </span>
                <span className="lab-pl-g mono" title={t("pat.growthHelp")}>
                  {p.growth == null ? <span className="lab-newtag">{t("pat.onlyRecent")}</span> : `×${p.growth.toFixed(1)}`}
                </span>
                <span className="lab-pl-fr" title={s("field.failRate")}>
                  <span className="lab-frbar">
                    <i style={{ width: `${p.fail_rate}%` }} data-hot={p.fail_rate >= 40 ? "" : undefined} />
                  </span>
                  <span className="mono">{fx.pct(p.fail_rate)}</span>
                </span>
                <button type="button" className="btn icon ghost sm lab-pl-x" aria-expanded={ex} aria-label={s("field.examples")} onClick={() => setOpen(ex ? null : p.id)}>
                  <ChevronDown aria-hidden />
                </button>
              </div>
              {ex ? (
                <div className="lab-pl-ex">
                  <ul>
                    {p.examples.slice(0, 4).map((e) => (
                      <li key={e.utterance_id}>
                        <span className={clsx("lab-res", e.result === "FAIL" && "fail")}>{e.result}</span>
                        <Link href={L.utterance(e.utterance_id)}>{e.utterance_text}</Link>
                        {e.asr_text !== e.utterance_text ? <span className="muted"> · ASR “{e.asr_text}”</span> : null}
                        <span className="mono muted"> → {e.intent_predicted}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="lab-pl-exf">
                    <span className="muted mono">
                      {s("field.terms")}: {p.terms.join(", ") || "—"} · {s("field.markets")}: {p.markets.join(", ")} · {s("field.firstSeen")} {fm.dateTimeLabel(p.first_seen)}
                    </span>
                    <Link className="btn sm" href={L.resultsFor({ utterance_pattern: p.id })}>
                      {s("actions.openResults")} <ArrowUpRight aria-hidden />
                    </Link>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {items.length > 8 ? (
        <button type="button" className="btn sm ghost" onClick={() => setShowAll((x) => !x)}>
          {showAll ? t("pat.less") : t("pat.more", { n: items.length - 8 })}
        </button>
      ) : null}
      {terms.length ? (
        <div className="lab-terms">
          <span className="lab-terms-k">{t("pat.terms")}</span>
          {terms.map((x) => {
            const max = data.terms[0]?.count || 1;
            return (
              <button key={x.term} type="button" className={clsx("lab-term", f.values.q === x.term && "on")} style={{ ["--s" as string]: 0.85 + (x.count / max) * 0.45 }} onClick={() => f.set({ q: f.values.q === x.term ? null : x.term })} title={t("pat.termHelp", { n: x.count })}>
                {x.term} <span className="mono">{x.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
