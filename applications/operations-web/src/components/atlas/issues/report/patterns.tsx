"use client";
/**
 * Market Brief — §3 Emerging utterance patterns: slope chart (first half → second half of the compare
 * window), patterns that only appeared recently, a new-term cloud and the phrasing-shift table
 * (established phrasing of the same intent vs the new phrasing, what Bixby understood, FAIL rate).
 */
import clsx from "clsx";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { IssueSummary, LangCode, NewPattern, NovelTerm, PatternKind, PatternList } from "@/lib/types";
import { LangBadge } from "@/components/shared";
import { useIssueLinks, type IssueFiltersApi, type IssueFormat } from "../../issues-shared";
import { Skeleton } from "../../ui";
import { Figure, FootRef, HBars, useTip } from "./bits";
import { SecHead } from "./sec";

const KINDS: PatternKind[] = ["new_feature_name", "code_switch", "new_term", "new_phrasing"];
const LANG_ORDER: LangCode[] = ["ko", "en", "ja", "es"];

export function useWidth<T extends HTMLElement>() {
  const [el, attach] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { attach, w };
}

function halves(p: NewPattern) {
  const mid = Math.floor(p.daily.length / 2);
  const a = p.daily.slice(0, mid).reduce((x, y) => x + y, 0);
  const b = p.daily.slice(mid).reduce((x, y) => x + y, 0);
  return { a, b };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Wrap the novel terms of a template in <mark>. */
function Marked({ text, terms, hl }: { text: string; terms: string[]; hl?: string | null }) {
  const ts = [...new Set(terms)].filter((x) => x.length > 1).sort((a, b) => b.length - a.length);
  if (!ts.length) return <>{text}</>;
  const re = new RegExp(`(${ts.map(esc).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} data-hl={hl && p.toLowerCase().includes(hl.toLowerCase()) ? "" : undefined}>
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Slope({ items, fx, onPick }: { items: (NewPattern & { a: number; b: number })[]; fx: IssueFormat; onPick: (p: NewPattern) => void }) {
  const t = useT("issuesReport");
  const { attach, w } = useWidth<HTMLDivElement>();
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const W = Math.max(300, w);
  const H = Math.max(240, Math.min(420, 70 + items.length * 26));
  const xL = 36;
  const xR = Math.round(Math.max(130, Math.min(W - 250, W * 0.46)));
  const top = 30;
  const bot = H - 18;
  const max = Math.max(1, ...items.map((p) => Math.max(p.a, p.b)));
  const y = (v: number) => bot - (v / max) * (bot - top);
  // right-hand labels, de-overlapped
  const labs = items.map((p) => ({ id: p.id, y: y(p.b) })).sort((a, b) => a.y - b.y);
  const gap = 15;
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < gap) labs[i].y = labs[i - 1].y + gap;
  const over = labs.length ? labs[labs.length - 1].y - (H - 6) : 0;
  if (over > 0) for (const l of labs) l.y -= over;
  for (let i = 0; i < labs.length; i++) if (labs[i].y < top - 8) labs[i].y = top - 8 + i * gap;
  const ly = new Map(labs.map((l) => [l.id, l.y]));
  const narrow = W < 560;
  const suffix = (p: NewPattern) => `${!narrow && p.growth != null ? `×${p.growth} · ` : ""}${fx.pct(p.fail_rate)}`;
  // approximate text width (CJK glyphs ≈ 11.5px, latin ≈ 6.6px at 11.5px SUIT) to keep labels inside the svg
  const wOf = (s: string) => [...s].reduce((a, ch) => a + (/[\u1100-\uffff]/.test(ch) ? 11.5 : 6.6), 0);
  const cut = (s: string, room: number) => {
    if (wOf(s) <= room) return s;
    let out = "";
    for (const ch of s) {
      if (wOf(out + ch + "…") > room) break;
      out += ch;
    }
    return out + "…";
  };
  const ticks = [0, Math.round(max / 2), max];

  return (
    <div className="issb-slope" ref={attach}>
      <div ref={tipAttach} className="issb-slope-in">
        {w ? (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("patterns.figSlope")}>
            <text className="issb-ax-t" x={xL} y={14} textAnchor="middle">
              {t("patterns.firstHalf")}
            </text>
            <text className="issb-ax-t" x={xR} y={14} textAnchor="middle">
              {t("patterns.secondHalf")}
            </text>
            {ticks.map((v) => (
              <g key={v}>
                <line className="issb-grid" x1={xL} x2={xR} y1={y(v)} y2={y(v)} />
                <text className="issb-ax" x={xL - 8} y={y(v) + 3} textAnchor="end">
                  {v}
                </text>
              </g>
            ))}
            <line className="issb-axis" x1={xL} x2={xL} y1={top - 6} y2={bot} />
            <line className="issb-axis" x1={xR} x2={xR} y1={top - 6} y2={bot} />
            {items.map((p) => {
              const on = hover === p.id;
              const dim = hover && !on;
              const node = (
                <>
                  <b>“{p.template}”</b>
                  <div>
                    {fx.kind(p.kind)} · {p.language}
                  </div>
                  <div>
                    {t("patterns.firstHalf")} {p.a} → {t("patterns.secondHalf")} {p.b} {p.growth != null ? `(${t("patterns.growth", { n: p.growth })})` : ""}
                  </div>
                  <div>
                    {t("patterns.failRate", { rate: fx.pct(p.fail_rate) })} · {fx.fn(p.agent_function)}
                  </div>
                </>
              );
              return (
                <g
                  key={p.id}
                  className={clsx("issb-slope-g", `lg-${p.language}`, dim && "dim", on && "on")}
                  tabIndex={0}
                  role="button"
                  aria-label={`${p.template}: ${p.a} → ${p.b}`}
                  onMouseEnter={(e) => {
                    setHover(p.id);
                    tipOn(node).onMouseEnter(e);
                  }}
                  onMouseMove={tipOn(node).onMouseMove}
                  onMouseLeave={() => {
                    setHover(null);
                    tipOn(node).onMouseLeave();
                  }}
                  onFocus={(e) => {
                    setHover(p.id);
                    tipOn(node).onFocus(e);
                  }}
                  onBlur={() => {
                    setHover(null);
                    tipOn(node).onBlur();
                  }}
                  onClick={() => onPick(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(p);
                    }
                  }}
                >
                  <line className="issb-slope-hit" x1={xL} x2={xR} y1={y(p.a)} y2={y(p.b)} />
                  <line className="issb-slope-l" x1={xL} x2={xR} y1={y(p.a)} y2={y(p.b)} />
                  <circle className="issb-slope-d" cx={xL} cy={y(p.a)} r={4} />
                  <circle className="issb-slope-d" cx={xR} cy={y(p.b)} r={4} />
                  <line className="issb-slope-lead" x1={xR + 6} x2={xR + 14} y1={y(p.b)} y2={ly.get(p.id)} />
                  <text className="issb-slope-lab" x={xR + 18} y={(ly.get(p.id) ?? 0) + 4}>
                    {cut(p.template, W - xR - 26 - suffix(p).length * 6.4 - 6)}
                    <tspan className="issb-slope-num" dx={6}>
                      {suffix(p)}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        {tipEl}
      </div>
    </div>
  );
}

export function LangLegend({ langs }: { langs: LangCode[] }) {
  return (
    <span className="issb-legend" role="list">
      {LANG_ORDER.filter((l) => langs.includes(l)).map((l) => (
        <span role="listitem" key={l} className={`lg-${l}`}>
          <i data-lang /> {l}
        </span>
      ))}
    </span>
  );
}

export function EmergingPatterns({ id, no, pats, f, fx }: { id: string; no: number; pats: PatternList | undefined; sum: IssueSummary | undefined; f: IssueFiltersApi; fx: IssueFormat }) {
  const t = useT("issuesReport");
  const s = useT("issues");
  const fmt = useFmt();
  const L = useIssueLinks();
  const { attach: tipAttach, on: tipOn, el: tipEl } = useTip();
  const [kind, setKind] = useState<PatternKind | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const items = useMemo(() => (pats?.items ?? []).filter((p) => !kind || p.kind === kind).map((p) => ({ ...p, ...halves(p) })), [pats, kind]);
  const slope = items.filter((p) => p.a > 0).sort((a, b) => b.b - a.b);
  const recent = items.filter((p) => p.a === 0).sort((a, b) => b.first_seen - a.first_seen);
  const langs = [...new Set(slope.map((p) => p.language))];
  const counts = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, (pats?.items ?? []).filter((p) => p.kind === k).length])), [pats]);

  // pattern-kind mix: FAIL rate per kind over every new pattern (not narrowed by the kind tab); tick = all new patterns
  const kindMix = useMemo(
    () =>
      KINDS.map((k) => {
        const xs = (pats?.items ?? []).filter((p) => p.kind === k);
        const rows = xs.reduce((a, p) => a + p.count, 0);
        const fails = xs.reduce((a, p) => a + p.fails, 0);
        return { kind: k, patterns: xs.length, rows, rate: rows ? Math.round((fails / rows) * 1000) / 10 : null };
      }),
    [pats],
  );
  const mixRows = kindMix.reduce((a, k) => a + k.rows, 0);
  const mixAll = mixRows ? Math.round(((pats?.items ?? []).reduce((a, p) => a + p.fails, 0) / mixRows) * 1000) / 10 : null;
  const terms = cleanTerms((pats?.terms ?? []).filter((x) => !kind || x.pattern_ids.some((pid) => items.some((p) => p.id === pid))));
  const tmax = Math.max(1, ...terms.map((x) => x.count));
  const ranked = [...items].sort((a, b) => b.fails - a.fails || b.count - a.count);
  const rows = all ? ranked : ranked.slice(0, 6);
  const pick = (p: NewPattern) => (p.issue_ids[0] ? f.select(p.issue_ids[0]) : undefined);

  const kindTabs = (
    <div className="seg issb-kinds" role="group" aria-label={s("field.kind")}>
      <button type="button" aria-pressed={!kind} onClick={() => setKind(null)}>
        {t("patterns.kindAll")} <small>{pats?.items.length ?? 0}</small>
      </button>
      {KINDS.map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} disabled={!counts[k]} title={fx.kindHelp(k)}>
          {fx.kind(k)} <small>{counts[k] ?? 0}</small>
        </button>
      ))}
    </div>
  );

  return (
    <section id={id} className="issb-sec" aria-labelledby={`${id}-h`}>
      <SecHead id={id} no={no} title={t("section.patterns.title")} lead={t("section.patterns.lead")} right={kindTabs} />
      {!pats ? (
        <Skeleton rows={6} />
      ) : !items.length ? (
        <p className="issb-empty">{s("empty.patterns")}</p>
      ) : (
        <>
          <div className="issb-pat-figs">
            <Figure n={`${no}.1`} title={t("patterns.figSlope")} src={t("sources.patterns")} aside={<LangLegend langs={langs} />}>
              {slope.length ? <Slope items={slope} fx={fx} onPick={pick} /> : <p className="issb-empty">{s("empty.patterns")}</p>}
            </Figure>
            <div className="issb-pat-side">
              <Figure n={`${no}.2`} title={t("patterns.figTerms")} src={t("sources.patterns")}>
                <div className="issb-cloud" ref={tipAttach}>
                  {terms.map((x) => {
                    const k = Math.sqrt(x.count / tmax);
                    const size = `calc(12px + ${k.toFixed(3)} * min(13px, 2.6vw))`;
                    const cs = isCodeSwitchTerm(x);
                    return (
                      <button
                        key={x.term}
                        type="button"
                        className={clsx("issb-term", x.languages[0] && `lg-${x.languages[0]}`, hl === x.term && "on", k > 0.75 && "big")}
                        data-cs={cs || undefined}
                        style={{ fontSize: size }}
                        aria-pressed={hl === x.term}
                        onClick={() => setHl((h) => (h === x.term ? null : x.term))}
                        {...tipOn(
                          <>
                            <b>{x.term}</b>
                            <div>
                              {t("patterns.termCount", {
                                n: x.count,
                                count: x.count,
                              })}{" "}
                              · Baseline {x.baseline_count}
                            </div>
                            <div>{x.languages.join(", ")}</div>
                            {cs ? <div>{t("patterns.codeSwitched")}</div> : null}
                          </>,
                        )}
                      >
                        <i data-lang aria-hidden />
                        {x.term}
                      </button>
                    );
                  })}
                  {tipEl}
                </div>
              </Figure>
              <Figure n={`${no}.3`} title={t("patterns.figKinds")} src={t("sources.patterns")} aside={<span className="issb-hintx">{t("patterns.kindsTick")}</span>}>
                <HBars
                  fx={fx}
                  max={100}
                  rows={kindMix.map((k) => ({
                    key: k.kind,
                    label: (
                      <span className="issb-kmix-l">
                        <span className="issb-kind" data-kind={k.kind}>
                          {fx.kind(k.kind)}
                        </span>
                        <small className="mono">{t("patterns.kindsSub", { count: k.patterns, rows: fmt.number(k.rows) })}</small>
                      </span>
                    ),
                    value: k.rate,
                    base: mixAll,
                    active: kind === k.kind,
                    onClick: k.patterns ? () => setKind((x) => (x === k.kind ? null : k.kind)) : undefined,
                  }))}
                />
              </Figure>
            </div>
          </div>

          {recent.length ? (
            <div className="issb-recent">
              <h4>{t("patterns.onlyRecent")}</h4>
              <p>{t("patterns.onlyRecentLead")}</p>
              <ul>
                {recent.slice(0, 8).map((p) => (
                  <li key={p.id} className={`lg-${p.language}`}>
                    <i data-lang aria-hidden />
                    <span className="issb-recent-t">“{p.template}”</span>
                    <span className="issb-recent-m mono">
                      {fmt.dateTimeLabel(p.first_seen)} · {t("patterns.count", { n: p.count, count: p.count })} · {t("patterns.failRate", { rate: fx.pct(p.fail_rate) })}
                    </span>
                  </li>
                ))}
              </ul>
              {recent.length > 8 ? <p className="issb-recent-more mono">+{recent.length - 8}</p> : null}
            </div>
          ) : null}

          <Figure n={`${no}.4`} title={t("patterns.figShift")} src={`${t("sources.patterns")} · ${t("sources.issues")}`}>
            <div className="issb-shift" role="table" aria-label={t("patterns.figShift")}>
              <div className="issb-shift-h" role="row">
                <span role="columnheader">{t("patterns.established")}</span>
                <span role="columnheader" aria-hidden />
                <span role="columnheader">{t("patterns.emerging")}</span>
                <span role="columnheader">{t("patterns.understoodAs")}</span>
                <span role="columnheader">{s("field.failRate")}</span>
              </div>
              {rows.map((p) => {
                const prev = (p.established ?? []).slice(0, 2);
                const wrong = [...p.intents_predicted].sort((a, b) => b.count - a.count);
                const total = wrong.reduce((a, x) => a + x.count, 0) || 1;
                const hit = hl ? p.terms.some((x) => x.toLowerCase() === hl.toLowerCase()) : false;
                return (
                  <div key={p.id} role="row" className={clsx("issb-shift-r", hl && (hit ? "hit" : "dim"))}>
                    <div role="cell" className="issb-shift-old">
                      {prev.length ? (
                        <>
                          <em className="issb-shift-cap">{t("patterns.sameIntent")}</em>
                          {prev.map((x) => (
                            <span key={x.pattern_id} className="issb-shift-est">
                              <LangBadge lang={x.language} />
                              <span className="issb-shift-est-b">
                                <span>
                                  “<Marked text={x.template} terms={x.shared_terms} />”
                                </span>
                                <small className="mono">{t("patterns.estMeta", { n: x.count, rate: fx.pct(x.fail_rate) })}</small>
                              </span>
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="muted">{p.established ? t("patterns.newIntent") : t("patterns.noEstablished")}</span>
                      )}
                      <small className="mono">
                        {fx.fn(p.agent_function)} · {p.intent_expected}
                      </small>
                    </div>
                    <div role="cell" className="issb-shift-arrow" aria-hidden>
                      <ArrowRight />
                    </div>
                    <div role="cell" className="issb-shift-new">
                      <span className="issb-shift-tpl">
                        <LangBadge lang={p.language} />
                        <span className="issb-shift-q">
                          “<Marked text={p.template} terms={p.terms} hl={hl} />”
                        </span>
                        <FootRef k={`pat:${p.id}`} />
                      </span>
                      <span className="issb-shift-meta">
                        <span className="issb-kind" data-kind={p.kind} title={fx.kindHelp(p.kind)}>
                          {fx.kind(p.kind)}
                        </span>
                        <span className="mono">
                          {t("patterns.count", { n: p.count, count: p.count })}
                          {p.growth != null ? ` · ${t("patterns.growth", { n: p.growth })}` : ` · ${t("patterns.onlyRecent")}`}
                        </span>
                        <span className="mono">{p.markets.join(" · ")}</span>
                      </span>
                      <details className="issb-shift-ex">
                        <summary>{t("patterns.examples")}</summary>
                        <ul>
                          {p.examples.slice(0, 4).map((e) => (
                            <li key={e.utterance_id}>
                              <span className={clsx("issb-res", e.result === "FAIL" ? "fail" : "pass")}>{e.result}</span>
                              <Link href={L.utterance(e.utterance_id)}>“{e.utterance_text}”</Link>
                              {e.asr_text && e.asr_text !== e.utterance_text ? <small>ASR: {e.asr_text}</small> : null}
                              <small>
                                → {e.intent_predicted} · {e.actual_response}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    <div role="cell" className="issb-shift-pred">
                      {wrong.slice(0, 2).map((x) => (
                        <span key={x.intent} data-ok={x.intent === p.intent_expected || undefined}>
                          <b className="mono">{x.intent}</b>
                          <small>
                            {Math.round((x.count / total) * 100)}% ({x.count})
                          </small>
                        </span>
                      ))}
                    </div>
                    <div role="cell" className="issb-shift-rate">
                      <RateMeter v={p.fail_rate} />
                      {p.fail_rate < 30 ? <small className="issb-contrast">{t("patterns.passing")}</small> : null}
                      {p.issue_ids[0] ? (
                        <button type="button" className="issb-link" onClick={() => f.select(p.issue_ids[0])}>
                          {t("patterns.issue")} <ArrowUpRight aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Figure>
          {ranked.length > 6 ? (
            <button type="button" className="btn sm issb-more" onClick={() => setAll((a) => !a)}>
              {all
                ? t("patterns.less")
                : t("patterns.more", {
                    n: ranked.length - 6,
                    count: ranked.length - 6,
                  })}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

export function RateMeter({ v, label }: { v: number; label?: ReactNode }) {
  return (
    <span className="issb-meter" data-hot={v >= 40 || undefined}>
      <span className="issb-meter-track">
        <i style={{ width: `${Math.min(100, v)}%` }} />
      </span>
      <b>{label ?? `${v.toFixed(1)}%`}</b>
    </span>
  );
}

/** generic verbs / function words that carry no product signal in the new-term cloud */
const GENERIC = new Set(["show", "open", "use", "ask", "front", "turn", "set", "play", "tell", "can", "you", "please", "what", "how", "get", "make", "this", "that", "me", "my"]);
const KO_VERB = /(줘|줄래|봐줘|해줘|할래|할까)$/;
const LATIN = /^[a-z][a-z\-]*$/i;

/** Latin word inside a ko / ja / es utterance → a code-switched word (kept even when short). */
function isCodeSwitchTerm(x: NovelTerm) {
  return LATIN.test(x.term) && !x.term.includes(" ") && x.languages.length > 0 && x.languages.every((l) => l !== "en");
}

/**
 * De-noise the cloud: drop generic words and Korean verb endings, fold the parts of a multi-word feature name
 * ("나우", "브리프" → "나우 브리프"; "지우개로" → "오디오 지우개"; "제미나이한테" → "제미나이"), cap at 18.
 */
function cleanTerms(all: NovelTerm[]): NovelTerm[] {
  const multi = all.filter((x) => x.term.includes(" "));
  const words = new Set(multi.flatMap((x) => x.term.split(" ")));
  const single = all.filter((x) => !x.term.includes(" "));
  const folded = (x: NovelTerm) => {
    if (x.term.includes(" ")) return false;
    for (const w of words) if (x.term === w || (x.term.startsWith(w) && x.term.length - w.length <= 2)) return true;
    for (const y of single) if (y !== x && y.term.length >= 2 && x.term.startsWith(y.term) && x.term.length - y.term.length <= 2 && y.count >= x.count * 0.6) return true;
    return false;
  };
  return all
    .filter((x) => !GENERIC.has(x.term.toLowerCase()))
    .filter((x) => isCodeSwitchTerm(x) || !(x.languages.includes("ko") && KO_VERB.test(x.term)))
    .filter((x) => isCodeSwitchTerm(x) || !folded(x))
    .slice(0, 18);
}
