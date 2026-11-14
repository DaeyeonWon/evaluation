"use client";
/** Issue detail — patterns in this issue (new vs established), related workflows, similar + same-category issues. */
import { ArrowUpRight, Network, Sparkles, Workflow } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { LangBadge } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import type { IssueDetail } from "@/lib/types";
import type { IssueFormat } from "../../issues-shared";
import { useDetailLinks } from "./links";
import { Plate } from "../../ui";

export function Patterns({ d, base }: { d: IssueDetail; base: Record<string, string> }) {
  const t = useT("issuesDetail");
  const fm = useFmt();
  const L = useDetailLinks();
  const pats = [...d.patterns].sort((a, b) => Number(b.novel) - Number(a.novel) || b.count - a.count);
  const total = Math.max(1, d.patterns.reduce((s, p) => s + p.count, 0));
  const novel = d.patterns.filter((p) => p.novel).reduce((s, p) => s + p.count, 0);
  const { utterance_pattern: _drop, ...noPattern } = base;
  void _drop;
  return (
    <Plate title={<><Sparkles aria-hidden /> {t("patterns.title")}</>} refText={t("patterns.ref", { n: d.patterns.length })}>
      <div className="idt-pat-mix" role="img" aria-label={t("patterns.mixAria", { pct: Math.round((novel / total) * 100) })}>
        <span className="idt-pat-mix-bar">
          <i data-k="new" style={{ width: `${(novel / total) * 100}%` }} />
          <i data-k="est" style={{ width: `${100 - (novel / total) * 100}%` }} />
        </span>
        <span className="idt-pat-legend mono">
          <span data-k="new">
            <i aria-hidden /> {t("patterns.new")} {Math.round((novel / total) * 100)}%
          </span>
          <span data-k="est">
            <i aria-hidden /> {t("patterns.established")} {100 - Math.round((novel / total) * 100)}%
          </span>
        </span>
      </div>
      {pats.length ? (
        <ul className="idt-pats">
          {pats.slice(0, 10).map((p) => (
            <li key={p.id} data-novel={p.novel ? "" : undefined}>
              <Link href={L.results({ ...noPattern, utterance_pattern: p.id })} className="idt-pat">
                <span className="idt-pat-k mono">{p.novel ? t("patterns.new") : t("patterns.established")}</span>
                <span className="idt-pat-t">
                  <LangBadge lang={p.language} />
                  <q>{p.template}</q>
                </span>
                <span className="idt-pat-bar" aria-hidden>
                  <i style={{ width: `${(p.count / total) * 100}%` }} />
                </span>
                <span className="mono idt-pat-n">
                  {fm.number(p.count)} <small>{((p.count / total) * 100).toFixed(0)}%</small>
                </span>
                <ArrowUpRight aria-hidden className="idt-go" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("patterns.none")}</p>
      )}
      <p className="muted idt-foot">{t("patterns.foot", { days: d.baseline.days })}</p>
    </Plate>
  );
}

export function Workflows({ d }: { d: IssueDetail }) {
  const t = useT("issuesDetail");
  const fm = useFmt();
  const L = useDetailLinks();
  const max = Math.max(1, ...d.workflows.map((w) => w.fails));
  return (
    <Plate title={<><Workflow aria-hidden /> {t("wf.title")}</>} refText={t("wf.ref", { n: d.workflows.length })}>
      {d.workflows.length ? (
        <ul className="idt-wfs">
          {d.workflows.map((w) => (
            <li key={w.workflow_id}>
              <Link href={L.workflow(w.workflow_id)} className="idt-wfl">
                <span className="idt-wfl-id mono">{w.workflow_id}</span>
                <span className="idt-wfl-meta mono muted">
                  <LangBadge lang={w.language} /> {w.pipeline_version} · {w.model_version} · {fm.dateLabel(w.created_at)}
                </span>
                <span className="idt-wfl-bar" aria-hidden>
                  <i style={{ width: `${(w.fails / max) * 100}%` }} />
                </span>
                <span className="mono idt-wfl-n">{t("wf.fails", { n: w.fails })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("wf.none")}</p>
      )}
    </Plate>
  );
}

type Card = { id: string; title: IssueDetail["title"]; severity: IssueDetail["severity"]; score: number; count: number; tag: string };

function IssueCards({ items, fx, href }: { items: Card[]; fx: IssueFormat; href: (id: string) => string }) {
  const fm = useFmt();
  const t = useT("issuesDetail");
  return (
    <ul className="idt-sims">
      {items.map((x, n) => (
        <li key={x.id} style={{ ["--d" as string]: `${n * 40}ms` } as CSSProperties}>
          <Link href={href(x.id)} className="idt-sim" data-sev={x.severity}>
            <span className="idt-sim-top">
              <span className="iss-sev" data-sev={x.severity}>
                {x.severity}
              </span>
              <span className="mono muted idt-sim-tag">{x.tag}</span>
              <b className="mono idt-sim-score" title="Criticality">
                {fx.score(x.score)}
              </b>
            </span>
            <span className="idt-sim-t">{fx.text(x.title)}</span>
            <span className="mono muted idt-sim-n">{t("sim.fails", { n: fm.number(x.count) })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Similar({ d, fx, href }: { d: IssueDetail; fx: IssueFormat; href: (id: string) => string }) {
  const t = useT("issuesDetail");
  const s = useT("issues");
  const sim: Card[] = d.similar.filter((x) => x.relation !== "same_category").slice(0, 8).map((x) => ({ ...x, tag: s.dynamic(`relation.${x.relation}`, undefined, x.relation) }));
  const simIds = new Set(sim.map((x) => x.id));
  const cat: Card[] = (d.same_category ?? []).filter((x) => !simIds.has(x.id)).slice(0, 8).map((x) => ({ ...x, tag: `${fx.fn(x.signature.agent_function)} · ${x.signature.intent_expected}` }));
  return (
    <Plate title={<><Network aria-hidden /> {t("sim.title")}</>}>
      <div className="idt-sim-groups">
        <section>
          <h3>{t("sim.similar")}</h3>
          {sim.length ? <IssueCards items={sim} fx={fx} href={href} /> : <p className="muted">{t("sim.noneSimilar")}</p>}
        </section>
        <section>
          <h3>{t("sim.sameCategory", { category: fx.value("category", d.category) })}</h3>
          {cat.length ? <IssueCards items={cat} fx={fx} href={href} /> : <p className="muted">{t("sim.noneCategory")}</p>}
        </section>
      </div>
    </Plate>
  );
}
