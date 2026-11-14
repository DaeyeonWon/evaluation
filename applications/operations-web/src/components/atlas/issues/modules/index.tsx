"use client";
/**
 * Deep Analysis — /issues/modules: the analysis-module registry (src/config/analysis-modules.ts).
 *
 *   three layers (단건 → 집계 → 교차·시계열) · M9 callout · roadmap (Phase 1 품질 대시보드 / Phase 2 심층 분석) ·
 *   bucket A pipeline columns · bucket B reference tables · bucket C module cards (+ M10/M11) ·
 *   feature × module dependency matrix (sticky header + first column, scrolls inside its container).
 *
 * The frame (../frame) renders the page header and the view switcher (with the 분석 모듈 tab); no FilterBar here.
 * Module cards carry id="M1"… so /issues/modules#M3 (badge links) lands on the card.
 */
import { ArrowRight, ExternalLink, FileText, TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import {
  ANALYSIS_MODULES,
  FAILURE_CODES,
  FEATURES,
  FEATURE_PAGES,
  FUTURE_MODULES,
  MODULES,
  MODULE_IDS,
  PIPELINE_COLUMNS,
  REFERENCE_TABLES,
  dependantsOf,
  featuresOf,
  type FeatureDeps,
  type FeatureId,
  type ModuleId,
} from "@/config/analysis-modules";
import { useT } from "@/i18n/client";
import { ModuleChip } from "../../issues-shared";
import "@/styles/atlas-issues-modules.css";

const DOCS_PATH = "applications/operations-web/docs/analysis-modules.md";
/** GitHub view of the design doc (repo-relative path above) */
const DOCS_URL = `https://github.com/DaeyeonWon/evaluation/blob/main/${DOCS_PATH}`;

function DocsLink({ className }: { className?: string }) {
  const t = useT("modules");
  const tc = useT("common");
  return (
    <p className={className ?? "mod-docs"}>
      <FileText aria-hidden />
      <span>{t("page.docsLead")}</span>{" "}
      <a href={DOCS_URL} target="_blank" rel="noreferrer" title={tc("a11y.externalLink")}>
        <code>{DOCS_PATH}</code>
        <ExternalLink aria-hidden />
      </a>
    </p>
  );
}
const NOTE_COLS = new Set(["result", "judge_reason", "failure_reason", "device_type", "bixby_version", "utterance_pattern"]);
const ROUTE: Record<string, string> = { triage: "/issues", categories: "/issues/categories", analysis: "/issues/analysis", report: "/issues/report", detail: "/issues/[id]", export: "/issues/*" };

function useFeatureLabel() {
  const t = useT("modules");
  return (f: FeatureId) => t.dynamic(`feature.${f}`, undefined, f);
}

function Layers() {
  const t = useT("modules");
  return (
    <section id="layers" aria-labelledby="mod-layers-h">
      <h2 className="mod-h" id="mod-layers-h">
        {t("layers.title")}
      </h2>
      <p className="mod-lead">{t("layers.lead")}</p>
      <ol className="mod-layers" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {(["1", "2", "3"] as const).map((l) => (
          <li key={l} className="mod-layer" data-l={l}>
            <span className="mod-layer-k">{t(`layers.l${l}.k`)}</span>
            <h3>{t(`layers.l${l}.title`)}</h3>
            <p>{t(`layers.l${l}.body`)}</p>
            <span className="mod-layer-w">{t(`layers.l${l}.where`)}</span>
          </li>
        ))}
      </ol>
      <p className="mod-test">{t("layers.test")}</p>
    </section>
  );
}

function M9Callout() {
  const t = useT("modules");
  return (
    <section className="mod-m9" aria-labelledby="mod-m9-h" role="note">
      <TriangleAlert aria-hidden />
      <div>
        <span className="mod-m9-k">{t("m9.kicker")}</span>
        <h2 id="mod-m9-h">{t("m9.title")}</h2>
        <p>{t("m9.body")}</p>
        <p>{t("m9.need")}</p>
      </div>
      <a className="btn sm" href="#M9">
        {t("m9.cta")} <ArrowRight aria-hidden />
      </a>
    </section>
  );
}

function Roadmap() {
  const t = useT("modules");
  return (
    <section id="roadmap" aria-labelledby="mod-road-h">
      <h2 className="mod-h" id="mod-road-h">
        {t("roadmap.title")}
      </h2>
      <div className="mod-road">
        {(["1", "2"] as const).map((p) => (
          <div key={p} className="mod-phase" data-p={p}>
            <span className="mod-phase-k">{t(`roadmap.p${p}.k`)}</span>
            <h3>{t(`roadmap.p${p}.title`)}</h3>
            <p>{t(`roadmap.p${p}.body`)}</p>
            <span className="mod-phase-items">{t(`roadmap.p${p}.items`)}</span>
            <span className="mod-phase-route">{p === "1" ? "/quality/*" : "/issues/*"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BucketA() {
  const t = useT("modules");
  return (
    <section id="bucket-a" aria-labelledby="mod-a-h">
      <h2 className="mod-h" id="mod-a-h">
        <span className="mod-k">{t("bucket.a.k")}</span> {t("bucket.a.title")}
      </h2>
      <p className="mod-lead">{t("bucket.a.lead")}</p>
      <ul className="mod-cols">
        {PIPELINE_COLUMNS.map((c) => (
          <li key={c.id} className="mod-col" data-status={c.status} data-core={c.core ? "" : undefined}>
            {c.core ? <span className="mod-col-core">{t("col.core")}</span> : null}
            <code>{c.id}</code>
            {NOTE_COLS.has(c.id) ? <small>{t.dynamic(`col.note.${c.id}`)}</small> : null}
            {c.id === "failure_reason" ? (
              <span className="mod-codes" aria-label={t("col.codes", { n: FAILURE_CODES.length })}>
                {FAILURE_CODES.map((x) => (
                  <code key={x}>{x}</code>
                ))}
              </span>
            ) : null}
            <span className="mod-col-st">{t(`col.status.${c.status}`)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BucketB() {
  const t = useT("modules");
  return (
    <section id="bucket-b" aria-labelledby="mod-b-h">
      <h2 className="mod-h" id="mod-b-h">
        <span className="mod-k">{t("bucket.b.k")}</span> {t("bucket.b.title")}
      </h2>
      <p className="mod-lead">{t("bucket.b.lead")}</p>
      <div className="mod-tbl-wrap">
        <table className="mod-tbl">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">{t("card.refs")}</th>
              <th scope="col">Key → value</th>
              <th scope="col">{t("ref.owner")}</th>
              <th scope="col">{t("ref.mock")}</th>
              <th scope="col">{t("card.upstream")}</th>
            </tr>
          </thead>
          <tbody>
            {REFERENCE_TABLES.map((r) => (
              <tr key={r.id} id={r.id}>
                <td className="mod-id">{r.id}</td>
                <td>{t(`ref.${r.id}.name`)}</td>
                <td>
                  <code>{r.key}</code>
                </td>
                <td>{t(`ref.${r.id}.owner`)}</td>
                <td>
                  <code>{r.mock}</code>
                </td>
                <td>
                  <span className="mod-deps">
                    {ANALYSIS_MODULES.filter((m) => m.refs.includes(r.id)).map((m) => (
                      <a key={m.id} href={`#${m.id}`} aria-label={m.id}>
                        <ModuleChip id={m.id} />
                      </a>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModuleCard({ id }: { id: ModuleId }) {
  const t = useT("modules");
  const label = useFeatureLabel();
  const m = MODULES[id];
  const deps = dependantsOf(id);
  const traffic = id === "M9" ? (Object.keys(FEATURES) as FeatureId[]).filter((f) => (FEATURES[f] as FeatureDeps).traffic) : [];
  const shown = id === "M9" ? traffic : deps;
  return (
    <article className="mod-card" id={id} data-status={m.status} aria-labelledby={`mod-${id}-h`}>
      <header className="mod-card-head">
        <span className="mod-card-id">{id}</span>
        <h3 id={`mod-${id}-h`}>{t(`mod.${id}.name`)}</h3>
        <span className="mod-card-tags">
          <span className="mod-tag" data-tier={m.tier}>
            {t(`tier.${m.tier}`)}
          </span>
          <span className="mod-tag" data-status={m.status} title={t(`status.help.${m.status}`)}>
            {t(`status.${m.status}`)}
          </span>
          <span className="mod-card-slug">{m.slug}</span>
        </span>
      </header>
      <p>{t(`mod.${id}.purpose`)}</p>
      <div className="mod-method">
        <div data-k="now">
          <b>{t("card.now")}</b>
          {t(`mod.${id}.now`)}
        </div>
        <span aria-hidden>→</span>
        <div data-k="target">
          <b>{t("card.target")}</b>
          {t(`mod.${id}.target`)}
        </div>
      </div>
      <dl className="mod-dl">
        <dt>{t("card.inputs")}</dt>
        <dd>
          <span className="mod-codes-inline">
            {m.columns.map((c) => (
              <code key={c}>{c}</code>
            ))}
            {m.refs.map((r) => (
              <a key={r} href={`#${r}`}>
                <code>{r}</code>
              </a>
            ))}
            {m.upstream.map((u) => (
              <a key={u} href={`#${u}`} aria-label={`${t("card.upstream")} ${u}`}>
                <ModuleChip id={u} />
              </a>
            ))}
            {(m.upstreamOptional ?? []).map((u) => (
              <a key={u} href={`#${u}`} className="mod-up-opt" aria-label={`${t("card.upstream")} ${u} (${t("card.optional")})`} title={t("card.optional")}>
                (<ModuleChip id={u} />)
              </a>
            ))}
            {!m.columns.length && !m.refs.length && !m.upstream.length && !m.upstreamOptional?.length ? t("card.none") : null}
          </span>
        </dd>
        <dt>{t("card.outputs")}</dt>
        <dd>
          <span className="mod-codes-inline">
            {m.outputs.map((o) => (
              <code key={o}>{o}</code>
            ))}
          </span>
        </dd>
        <dt>{t("card.storage")}</dt>
        <dd>{t(`mod.${id}.storage`)}</dd>
        <dt>{t("card.owner")}</dt>
        <dd>{t(`mod.${id}.owner`)}</dd>
        <dt>{t("card.mock")}</dt>
        <dd>{m.mock.length ? m.mock.map((x) => <code key={x} style={{ display: "block" }}>{x}</code>) : t("card.none")}</dd>
        <dt>{t("card.deps", { count: shown.length })}</dt>
        <dd>
          {shown.length ? (
            <span className="mod-deps">
              {shown.map((f) => (
                <span key={f} className="mod-dep">
                  <small>{t(`pages.${FEATURES[f].page}`)}</small> {label(f)}
                </span>
              ))}
            </span>
          ) : (
            t("card.noDeps")
          )}
        </dd>
      </dl>
    </article>
  );
}

function BucketC() {
  const t = useT("modules");
  return (
    <section id="bucket-c" aria-labelledby="mod-c-h">
      <h2 className="mod-h" id="mod-c-h">
        <span className="mod-k">{t("bucket.c.k")}</span> {t("bucket.c.title")}
      </h2>
      <p className="mod-lead">{t("bucket.c.lead")}</p>
      <div className="mod-cards">
        {MODULE_IDS.map((id) => (
          <ModuleCard key={id} id={id} />
        ))}
      </div>
      <h3 className="mod-h" style={{ fontSize: "var(--t-md)", marginTop: 18 }}>
        {t("card.future")}
      </h3>
      <div className="mod-future">
        {FUTURE_MODULES.map((m) => (
          <article key={m.id} className="mod-card" id={m.id}>
            <header className="mod-card-head">
              <span className="mod-card-id">{m.id}</span>
              <h3>{t(`mod.${m.id}.name`)}</h3>
              <span className="mod-card-tags">
                <span className="mb-chip" data-status="planned">
                  {t("status.planned")}
                </span>
                <span className="mod-card-slug">{m.slug}</span>
              </span>
            </header>
            <p>{t(`mod.${m.id}.purpose`)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Matrix() {
  const t = useT("modules");
  const label = useFeatureLabel();
  return (
    <section id="matrix" aria-labelledby="mod-mx-h">
      <h2 className="mod-h" id="mod-mx-h">
        {t("matrix.title")}
      </h2>
      <p className="mod-lead">{t("matrix.lead")}</p>
      <div className="mod-mx-wrap" tabIndex={0} role="region" aria-label={`${t("matrix.title")} — ${t("matrix.scroll")}`}>
        <table className="mod-mx">
          <thead>
            <tr>
              <th scope="col" className="mod-mx-f">
                {t("matrix.feature")}
              </th>
              {MODULE_IDS.map((m) => (
                <th key={m} scope="col">
                  <a href={`#${m}`} title={t(`mod.${m}.name`)}>
                    <ModuleChip id={m} />
                    <small>{t(`tier.${MODULES[m].tier}`)}</small>
                  </a>
                </th>
              ))}
              <th scope="col" style={{ textAlign: "left" }}>
                {t("matrix.needs")}
              </th>
            </tr>
          </thead>
          <tbody>
            {FEATURE_PAGES.map((p) => (
              <Fragment key={p}>
                <tr className="grp">
                  <th scope="rowgroup" colSpan={MODULE_IDS.length + 2}>
                    {t(`pages.${p}`)} <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>{ROUTE[p]}</span>
                  </th>
                </tr>
                {featuresOf(p).map((f) => {
                  const d = FEATURES[f] as FeatureDeps;
                  const on = new Set<ModuleId>(d.modules);
                  return (
                    <tr key={f}>
                      <th scope="row" className="mod-mx-f">
                        {label(f)}
                        <code>{f}</code>
                      </th>
                      {MODULE_IDS.map((m) => {
                        const need = on.has(m);
                        const m9 = m === "M9" && d.traffic;
                        return (
                          <td key={m} className="c" data-on={need || undefined} data-m9={m9 || undefined}>
                            {need || m9 ? <i aria-hidden /> : null}
                            <span className="sr">{need ? `${m} ${t("matrix.needs")}` : m9 ? t("matrix.traffic") : ""}</span>
                          </td>
                        );
                      })}
                      <td className="n">
                        {d.modules.length ? null : (
                          <span className="mb-chip" data-status="free">
                            {t("matrix.none")}
                          </span>
                        )}
                        {d.traffic ? (
                          <span className="mb-chip" data-status="none">
                            {t("matrix.traffic")}
                          </span>
                        ) : null}
                        {d.quality ? <span>{t("matrix.quality")}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mod-mx-legend">
        <span>{t("matrix.legend")}</span>
      </p>
    </section>
  );
}

export function IssuesModules() {
  const t = useT("modules");
  return (
    <div className="iss-mod iss-view">
      <nav className="mod-jump" aria-label={t("page.toc")}>
        <a href="#layers">{t("layers.title")}</a>
        <a href="#roadmap">{t("roadmap.title")}</a>
        <a href="#bucket-a">A · {t("bucket.a.title")}</a>
        <a href="#bucket-b">B · {t("bucket.b.title")}</a>
        <a href="#bucket-c">C · {t("bucket.c.title")}</a>
        <a href="#matrix">{t("matrix.title")}</a>
      </nav>
      <DocsLink className="mod-docs mod-docs-top" />
      <Layers />
      <M9Callout />
      <Roadmap />
      <BucketA />
      <BucketB />
      <BucketC />
      <Matrix />
      <DocsLink />
    </div>
  );
}
