"use client";
/**
 * Issue Report — 분해 보기 / Breakdown view (/issues/categories). OWNED BY THE CATEGORIES VIEW ENGINEER.
 * The page header, view switcher, export buttons and the unified FilterBar come from the frame (../frame).
 *
 *   dim switch (?dim=, default category) → useIssueBreakdown(f, dim) → summary strip, ordered chart
 *   (bixby_version / severity), cards (?cview=cards, default) or ranking table (?cview=table), sorted by ?csort=.
 *   Card / row click → V.drillHref(dim, value) (Triage filtered to the value, other filters kept).
 *   dim / csort / cview are view-local (links.ts VIEW_STATE_PARAMS.categories).
 */
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { FeatureId } from "@/config/analysis-modules";
import { ModuleBadges, useIssueBreakdown, useIssueFilters, useIssueViewLinks } from "../../issues-shared";
import { Empty, ErrorNote, Skeleton, useReducedMotionSafe } from "../../ui";
import { CategoryCard } from "./card";
import { useValueText } from "./labels";
import { OrderedChart } from "./ordered";
import { RankingTable } from "./table";
import { ORDERED_DIMS, TAG_DIMS, sortItems, useCategoriesState } from "./state";
import { SummaryStrip } from "./summary";
import { DimSwitch, ViewControls } from "./switcher";
import "@/styles/atlas-issues-categories.css";

/** module badge of the current breakdown dim (issue-level dims need the module that produces them) */
function catFeature(dim: string): FeatureId {
  if (dim === "category" || dim === "user_impact" || dim === "dev_miss") return "categories.dim.category";
  if (dim === "severity") return "categories.dim.severity";
  if (dim === "status") return "categories.dim.status";
  if (dim === "novelty") return "categories.dim.novelty";
  if (dim === "must_handle") return "categories.dim.mustHandle";
  return "categories.dim.row";
}

export function IssuesCategories() {
  const t = useT("issuesCategories");
  const fm = useFmt();
  const f = useIssueFilters();
  const V = useIssueViewLinks();
  const vt = useValueText();
  const st = useCategoriesState();
  const reduced = useReducedMotionSafe();
  const bd = useIssueBreakdown(f, st.dim);
  // keep the previous dim's data on screen only when it belongs to the same dim
  const data = bd.data && bd.data.dim === st.dim ? bd.data : null;
  const items = useMemo(() => (data ? sortItems(data.items, st.csort) : []), [data, st.csort]);
  const bucketLabels = useMemo(() => (data ? data.t.map((ts) => (data.bucket === "hour" ? fm.dateTimeLabel(ts) : fm.dateLabel(ts))) : []), [data, fm]);
  const maxShare = Math.max(1, ...items.map((i) => i.share));
  const tag = TAG_DIMS.has(st.dim);
  const notDeployed = !bd.isLoading && !bd.error && bd.data === null;

  const fade = reduced ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 } } : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } };

  return (
    <div className="iss-cat iss-view">
      <div className="cat-bar">
        <DimSwitch dim={st.dim} setDim={st.setDim} vt={vt} />
        <ViewControls csort={st.csort} setSort={st.setSort} cview={st.cview} setView={st.setView} />
      </div>
      <div className="mb-row cat-mods">
        <span className="mb-row-k">{vt.dim(st.dim)}</span>
        <ModuleBadges feature={catFeature(st.dim)} />
      </div>

      <div id="cat-panel" role="tabpanel" aria-label={vt.dim(st.dim)} aria-busy={bd.isLoading || undefined}>
        {bd.error ? <ErrorNote error={bd.error} /> : null}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={st.dim} className="cat-stage" {...fade} transition={{ duration: reduced ? 0 : 0.22, ease: [0.2, 0.7, 0.2, 1] }}>
            {!data ? (
              notDeployed ? (
                <Empty title={t("empty.notDeployed")} />
              ) : bd.error ? null : (
                <div className="cat-skel">
                  <Skeleton rows={2} />
                  <div className="cat-grid">
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="cat-card skel-card">
                        <Skeleton rows={5} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : !items.length ? (
              <Empty title={t("empty.title")}>
                <p>{t("empty.body")}</p>
              </Empty>
            ) : (
              <>
                <SummaryStrip dim={st.dim} data={data} vt={vt} V={V} />
                {ORDERED_DIMS.has(st.dim) ? <OrderedChart dim={st.dim} data={data} f={f} vt={vt} V={V} /> : null}
                {st.cview === "table" ? (
                  <RankingTable dim={st.dim} items={items} tag={tag} vt={vt} V={V} bucketLabels={bucketLabels} maxShare={maxShare} />
                ) : (
                  <motion.div className="cat-grid" layout={!reduced} transition={{ duration: 0.3 }}>
                    {items.map((i, k) => (
                      <motion.div key={i.value} layout={reduced ? false : "position"} transition={{ type: "spring", stiffness: 420, damping: 38 }} className="cat-cell">
                        <CategoryCard dim={st.dim} item={i} tag={tag} vt={vt} V={V} bucketLabels={bucketLabels} maxShare={maxShare} order={k} />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
                {data.truncated > 0 ? <p className="cat-trunc muted">{t("truncated", { count: data.truncated })}</p> : null}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
