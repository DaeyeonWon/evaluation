"use client";
/**
 * Triage — impact swimlanes over the server grouped listing (GET /issues?group=&subgroup=, useIssueGroups).
 * Group (default severity = 영향도 P0→P3) → optional subgroup (default: the lens type) → cards, with
 * "load more" per group / subgroup (group_key + subgroup_key, growing group_size).
 */
import clsx from "clsx";
import { ChevronDown, Layers } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { useFmt, useT } from "@/i18n/client";
import type { Issue, IssueSeverity } from "@/lib/types";
import { GROUP_DIMS, useDimLabel, useIssueGroups, type GroupDim, type IssueFiltersApi, type IssueFormat, type IssueGroup } from "../../issues-shared";
import { ErrorNote, Skeleton, useReducedMotionSafe } from "../../ui";
import { IssueCard, type CardActions } from "./card";
import { TypeBadge, TypeBar, typeOrder, typeVar, type TriageState, type TypeDim } from "./lens";

const SEVS: IssueSeverity[] = ["P0", "P1", "P2", "P3"];
/** first page per group without a subgroup / per subgroup */
const SIZE = 6;
const SIZE_SUB = 3;
const STEP = 12;
const MAX = 200;

const isType = (d: GroupDim | null): d is TypeDim => d === "user_impact" || d === "dev_miss";

/** Group / Then-by pickers (view-local, not filters). */
export function GroupPicker({ ts }: { ts: TriageState }) {
  const t = useT("issuesTriage");
  const dl = useDimLabel();
  const label = (d: GroupDim) => (d === "severity" ? `${dl.dim(d)} (P0–P3)` : dl.dim(d)) + (d === ts.typeDim ? ` · ${t("group.lensType")}` : "");
  return (
    <div className="ia-grp" role="group" aria-label={t("group.aria")}>
      <Layers aria-hidden />
      <label>
        <span>{t("group.by")}</span>
        <select className="in" value={ts.group} onChange={(e) => ts.setGroup(e.target.value as GroupDim)}>
          {GROUP_DIMS.map((d) => (
            <option key={d} value={d}>
              {label(d)}
            </option>
          ))}
        </select>
      </label>
      <span className="ia-grp-sep" aria-hidden>
        →
      </span>
      <label>
        <span>{t("group.then")}</span>
        <select className="in" value={ts.subgroup ?? ""} onChange={(e) => ts.setSubgroup((e.target.value || null) as GroupDim | null)}>
          <option value="">{t("group.none")}</option>
          {GROUP_DIMS.filter((d) => d !== ts.group).map((d) => (
            <option key={d} value={d}>
              {label(d)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function GroupLabel({ dim, k, fx }: { dim: GroupDim; k: string; fx: IssueFormat }) {
  const s = useT("issues");
  const dl = useDimLabel();
  if (dim === "severity")
    return (
      <>
        <span className="iss-sev" data-sev={k} title={fx.severityHelp(k)}>
          {k}
        </span>
        <b>{s.dynamic(`impactLevel.${k}`, undefined, k)}</b>
      </>
    );
  if (isType(dim)) return <TypeBadge dim={dim} value={k} fx={fx} />;
  if (dim === "status") return <b>{fx.status(k as never)}</b>;
  return <b>{dl.value(dim, k)}</b>;
}
const laneTone = (dim: GroupDim, key: string) => (dim === "severity" ? `var(--sev-${key.toLowerCase()})` : isType(dim) ? typeVar(dim, key) : "var(--accent)");

function Cards({ items, ctx }: { items: Issue[]; ctx: LaneCtx }) {
  const rm = useReducedMotionSafe();
  return (
    <div className="ia-grid">
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((i, n) => (
          <motion.div
            key={i.id}
            className="ia-cell"
            layout={!rm}
            initial={rm ? false : { opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={rm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.34, delay: rm ? 0 : Math.min(n, 8) * 0.03, ease: [0.2, 0.75, 0.2, 1] }}
          >
            <IssueCard issue={i} labels={ctx.labels} fx={ctx.fx} onOpen={ctx.onOpen} act={ctx.act} ts={ctx.ts} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

interface LaneCtx {
  f: Pick<IssueFiltersApi, "query" | "filterQuery" | "page">;
  ts: TriageState;
  fx: IssueFormat;
  act: CardActions;
  labels: string[];
  onOpen: (id: string) => void;
}

/** the items of one group / subgroup at a larger page size (mounted only after "load more") */
function MoreCards({ ctx, size, groupKey, subKey, fallback }: { ctx: LaneCtx; size: number; groupKey: string; subKey: string | null; fallback: Issue[] }) {
  const q = useIssueGroups(ctx.f, { group: ctx.ts.group, subgroup: subKey != null ? ctx.ts.subgroup : null, lens: ctx.ts.lens }, { groupSize: size, groupKey, subgroupKey: subKey, pageSize: 1, page: 1 });
  const g = q.data?.groups?.find((x) => x.key === groupKey);
  const items = subKey != null ? g?.subgroups?.find((x) => x.key === subKey)?.items : g?.items;
  return (
    <>
      <Cards items={items ?? fallback} ctx={ctx} />
      {!items ? <p className="ia-more-busy mono muted">…</p> : null}
    </>
  );
}

function Paged({ ctx, base, items, count, groupKey, subKey }: { ctx: LaneCtx; base: number; items: Issue[]; count: number; groupKey: string; subKey: string | null }) {
  const t = useT("issuesTriage");
  const fm = useFmt();
  const [size, setSize] = useState(base);
  const shown = Math.min(size, count);
  return (
    <>
      {size > base ? <MoreCards ctx={ctx} size={size} groupKey={groupKey} subKey={subKey} fallback={items} /> : <Cards items={items} ctx={ctx} />}
      {count > base ? (
        <div className="ia-more">
          <span className="mono muted">{t("group.shown", { shown: fm.number(shown), total: fm.number(count) })}</span>
          {shown < count ? (
            <button type="button" className="btn sm" onClick={() => setSize((s) => Math.min(MAX, s + STEP))} disabled={size >= MAX}>
              {t("group.more", { n: fm.number(Math.min(STEP, count - shown)) })}
            </button>
          ) : null}
          {size > base ? (
            <button type="button" className="btn sm ghost" onClick={() => setSize(base)}>
              {t("group.less")}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Lane({ g, ctx, typeCounts, collapsed, onToggle }: { g: IssueGroup; ctx: LaneCtx; typeCounts: Record<string, number> | null; collapsed: boolean; onToggle: () => void }) {
  const t = useT("issuesTriage");
  const fm = useFmt();
  const rm = useReducedMotionSafe();
  const { ts, fx } = ctx;
  const id = `ia-lane-${ts.group}-${g.key}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const subs = ts.subgroup ? (g.subgroups ?? []) : null;
  const sevMix = ts.group !== "severity" ? SEVS.filter((s) => g.by_severity[s]) : [];
  return (
    <section className={clsx("ia-lane", collapsed && "closed", !g.count && "empty")} data-dim={ts.group} data-k={g.key} style={{ ["--lc" as string]: laneTone(ts.group, g.key) } as CSSProperties} aria-labelledby={`${id}-h`}>
      <header className="ia-lane-h">
        <button type="button" className="ia-lane-tg" aria-expanded={!collapsed} aria-controls={`${id}-b`} onClick={onToggle} disabled={!g.count}>
          <ChevronDown aria-hidden className="ia-lane-chev" />
          <span className="ia-lane-l" id={`${id}-h`}>
            <GroupLabel dim={ts.group} k={g.key} fx={fx} />
          </span>
        </button>
        <span className="ia-lane-kv">
          <span>
            <b className="mono">{fm.number(g.count)}</b>
            <small>{t("group.issues")}</small>
          </span>
          <span>
            <b className="mono">{fm.number(g.fails)}</b>
            <small>FAIL</small>
          </span>
          {g.count ? (
            <span>
              <b className="mono">{fx.score(g.max_score)}</b>
              <small>{t("group.maxScore")}</small>
            </span>
          ) : null}
        </span>
        {sevMix.length ? (
          <span className="ia-lane-sev" aria-label={t("group.sevMix")}>
            {sevMix.map((s) => (
              <span key={s} className="iss-sev" data-sev={s} title={`${s} · ${g.by_severity[s]}`}>
                {s} <b className="mono">{g.by_severity[s]}</b>
              </span>
            ))}
          </span>
        ) : null}
        {typeCounts ? (
          <span className="ia-lane-mix">
            <TypeBar dim={ts.typeDim} counts={typeCounts} fx={fx} label={fx.t.dynamic(`frame.dim.${ts.typeDim}`, undefined, ts.typeDim)} />
          </span>
        ) : null}
      </header>
      {!g.count ? (
        <p className="ia-lane-none muted">{t("group.emptyLevel")}</p>
      ) : (
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.div
              key="b"
              id={`${id}-b`}
              className="ia-lane-b"
              initial={rm ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={rm ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="ia-lane-in">
                {subs ? (
                  subs.map((sg) => (
                    <div key={sg.key} className="ia-sub" style={{ ["--lc2" as string]: laneTone(ts.subgroup!, sg.key), ["--n" as string]: Math.max(1, Math.min(SIZE_SUB, sg.items.length)) } as CSSProperties}>
                      <h4 className="ia-sub-h">
                        <GroupLabel dim={ts.subgroup!} k={sg.key} fx={fx} />
                        <span className="mono muted">
                          {t("group.subStat", { n: fm.number(sg.count), fails: fm.number(sg.fails) })}
                        </span>
                        {isType(ts.subgroup) ? <span className="ia-sub-why">{fx.t.dynamic(`${ts.subgroup === "user_impact" ? "userImpactHelp" : "devMissHelp"}.${sg.key}`, undefined, "")}</span> : null}
                      </h4>
                      <Paged ctx={ctx} base={SIZE_SUB} items={sg.items} count={sg.count} groupKey={g.key} subKey={sg.key} />
                    </div>
                  ))
                ) : (
                  <Paged ctx={ctx} base={SIZE} items={g.items} count={g.count} groupKey={g.key} subKey={null} />
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
    </section>
  );
}

export function Lanes({ f, ts, fx, act, labels, onOpen, onIds }: LaneCtx & { f: IssueFiltersApi; onIds?: (ids: string[]) => void }) {
  const t = useT("issuesTriage");
  const fm = useFmt();
  const sub = ts.subgroup;
  const base = sub ? SIZE_SUB : SIZE;
  const main = useIssueGroups(f, { group: ts.group, subgroup: sub, lens: ts.lens }, { groupSize: base, pageSize: 1, page: 1 });
  // type mix per group: reuse the main response when it is already split by the lens type, else a tiny side request
  const needMix = sub !== ts.typeDim && ts.group !== ts.typeDim;
  const mix = useIssueGroups(f, { group: ts.group, subgroup: needMix ? ts.typeDim : sub, lens: ts.lens }, { groupSize: needMix ? 1 : base, pageSize: 1, page: 1 });
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const d = main.data;
  const groups = d?.groups ?? null;
  const mixSrc = needMix ? mix.data?.groups : groups;
  const typeCounts = (key: string): Record<string, number> | null => {
    if (ts.group === ts.typeDim) return null;
    const g = mixSrc?.find((x) => x.key === key);
    if (!g?.subgroups) return null;
    return Object.fromEntries(g.subgroups.map((s) => [s.key, s.count]));
  };
  // impact levels always show all four lanes (an empty level is information too)
  const lanes: IssueGroup[] | null =
    groups && ts.group === "severity"
      ? SEVS.map((s) => groups.find((g) => g.key === s) ?? { key: s, label: null, count: 0, fails: 0, by_severity: { P0: 0, P1: 0, P2: 0, P3: 0 }, max_score: 0, items: [], page: 1, pageSize: base })
      : groups;

  const ids = (lanes ?? []).flatMap((g) => (sub ? (g.subgroups ?? []).flatMap((s) => s.items) : g.items).map((i) => i.id));
  const idsKey = ids.join(",");
  useEffect(() => {
    onIds?.(idsKey ? idsKey.split(",") : []);
  }, [idsKey, onIds]);

  const ctx: LaneCtx = { f, ts, fx, act, labels, onOpen };
  const allKeys = (lanes ?? []).filter((g) => g.count).map((g) => g.key);
  const anyOpen = allKeys.some((k) => !closed[k]);
  const legendCounts: Record<string, number> = {};
  for (const g of mixSrc ?? []) for (const s of g.subgroups ?? []) legendCounts[s.key] = (legendCounts[s.key] ?? 0) + s.count;
  const showLegend = ts.group !== ts.typeDim && Object.keys(legendCounts).length > 0 && typeOrder(ts.typeDim).length > 0;

  if (main.error) return <ErrorNote error={main.error} />;
  if (!lanes) return <Skeleton rows={6} />;
  if (!d?.total) {
    return (
      <div className="empty">
        <b>{fx.t("empty.issues")}</b>
      </div>
    );
  }
  return (
    <div className="ia-lanes" aria-busy={main.isValidating || undefined}>
      <div className="ia-lanes-bar">
        {showLegend ? (
          <div className="ia-lanes-leg">
            <span className="mono">{t("group.legend", { dim: fx.t.dynamic(`frame.dim.${ts.typeDim}`, undefined, ts.typeDim) })}</span>
            <TypeBar dim={ts.typeDim} counts={legendCounts} fx={fx} legend label={t("group.legend", { dim: ts.typeDim })} />
          </div>
        ) : (
          <span />
        )}
        <span className="ia-lanes-acts">
          <span className="mono muted">{t("group.count", { groups: fm.number(lanes.filter((g) => g.count).length), issues: fm.number(d.total) })}</span>
          <button type="button" className="btn sm ghost" onClick={() => setClosed(anyOpen ? Object.fromEntries(allKeys.map((k) => [k, true])) : {})}>
            {anyOpen ? t("group.collapseAll") : t("group.expandAll")}
          </button>
        </span>
      </div>
      {lanes.map((g) => (
        <Lane key={`${ts.group}:${g.key}`} g={g} ctx={ctx} typeCounts={typeCounts(g.key)} collapsed={!!closed[g.key]} onToggle={() => setClosed((c) => ({ ...c, [g.key]: !c[g.key] }))} />
      ))}
    </div>
  );
}
