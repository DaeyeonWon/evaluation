"use client";
/**
 * Triage — the two lenses (사용자 영향 / Bixby 미처리) and the view-local grouping state.
 *
 * Both lenses share the impact grouping (group, default severity = 영향도). The lens only picks the type
 * taxonomy shown on cards (user_impact_type vs dev_miss_type), the KPI emphasis and the default subgroup.
 * URL (view-local, registered in VIEW_STATE_PARAMS.triage): lens · group · subgroup (+ view deck|kanban).
 * `subgroup` unset → the lens type; `subgroup=none` → no secondary grouping.
 */
import clsx from "clsx";
import {
  AudioLines,
  Ban,
  Braces,
  CircleSlash,
  CircleX,
  Code2,
  GitCompareArrows,
  Hourglass,
  Languages,
  MessageCircleQuestion,
  MessageSquareWarning,
  PenLine,
  Route,
  ShieldAlert,
  ShieldOff,
  Shuffle,
  Sparkles,
  Timer,
  UserRound,
} from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { useCallback, useId, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import { parseAsString, useQueryStates } from "@/lib/client";
import type { DevMissType, Issue, IssueFacets, UserImpactType } from "@/lib/types";
import { useTriageLens, type GroupDim, type IssueFiltersApi, type IssueFormat, type TriageLens } from "../../issues-shared";
import { useReducedMotionSafe } from "../../ui";

type Facets = IssueFacets | undefined;

// ───────────────────────────────────────── type taxonomies ──
export const USER_IMPACT_ORDER: UserImpactType[] = ["safety_privacy", "wrong_action", "task_blocked", "misunderstood", "inappropriate_content", "degraded", "minor"];
/** must-handle misses first (by how directly they are a Bixby defect), out_of_scope last */
export const DEV_MISS_ORDER: DevMissType[] = [
  "guardrail_miss",
  "regression",
  "new_feature_gap",
  "locale_gap",
  "supported_intent_failed",
  "routing",
  "slot_extraction",
  "asr_robustness",
  "performance",
  "out_of_scope",
];
export const TYPE_ICON: Record<UserImpactType | DevMissType, ReactNode> = {
  safety_privacy: <ShieldAlert aria-hidden />,
  wrong_action: <Shuffle aria-hidden />,
  task_blocked: <Ban aria-hidden />,
  misunderstood: <MessageCircleQuestion aria-hidden />,
  inappropriate_content: <MessageSquareWarning aria-hidden />,
  degraded: <Hourglass aria-hidden />,
  minor: <PenLine aria-hidden />,
  guardrail_miss: <ShieldOff aria-hidden />,
  regression: <GitCompareArrows aria-hidden />,
  new_feature_gap: <Sparkles aria-hidden />,
  locale_gap: <Languages aria-hidden />,
  supported_intent_failed: <CircleX aria-hidden />,
  routing: <Route aria-hidden />,
  slot_extraction: <Braces aria-hidden />,
  asr_robustness: <AudioLines aria-hidden />,
  performance: <Timer aria-hidden />,
  out_of_scope: <CircleSlash aria-hidden />,
};
export type TypeDim = "user_impact" | "dev_miss";
export const typeOrder = (d: TypeDim): string[] => (d === "user_impact" ? USER_IMPACT_ORDER : DEV_MISS_ORDER);
export const typeOf = (i: Pick<Issue, "user_impact_type" | "dev_miss_type">, d: TypeDim) => (d === "user_impact" ? i.user_impact_type : i.dev_miss_type);
/** CSS colour of a type value (categorical slot; dev_miss folds the tail to neutrals — see atlas-issues-triage.css) */
export const typeVar = (d: TypeDim, v: string) => `var(--${d === "user_impact" ? "ut" : "dm"}-${v})`;

export function TypeBadge({ dim, value, fx, size }: { dim: TypeDim; value: string; fx: IssueFormat; size?: "sm" }) {
  return (
    <span className={clsx("ia-type", size)} data-dim={dim} data-v={value} style={{ ["--tyc" as string]: typeVar(dim, value) }} title={fx.t.dynamic(`${dim === "user_impact" ? "userImpactHelp" : "devMissHelp"}.${value}`, undefined, "")}>
      {TYPE_ICON[value as UserImpactType]}
      {fx.value(dim, value)}
    </span>
  );
}

/** Stacked type share bar (+ optional legend). `counts` = value → issues. */
export function TypeBar({ dim, counts, fx, legend, label }: { dim: TypeDim; counts: Record<string, number>; fx: IssueFormat; legend?: boolean; label: string }) {
  const fm = useFmt();
  const order = typeOrder(dim).filter((v) => (counts[v] ?? 0) > 0);
  const total = order.reduce((a, v) => a + counts[v], 0);
  if (!total) return null;
  return (
    <span className="ia-tybar">
      <span className="ia-tybar-bar" role="img" aria-label={`${label}: ${order.map((v) => `${fx.value(dim, v)} ${counts[v]}`).join(", ")}`}>
        {order.map((v) => (
          <i key={v} data-v={v} style={{ flexGrow: counts[v], ["--tyc" as string]: typeVar(dim, v) }} title={`${fx.value(dim, v)} · ${fm.number(counts[v])} (${Math.round((counts[v] / total) * 100)}%)`} />
        ))}
      </span>
      {legend ? (
        <span className="ia-tybar-l">
          {order.map((v) => (
            <span key={v} data-v={v} style={{ ["--tyc" as string]: typeVar(dim, v) }}>
              <i />
              {fx.value(dim, v)} <b className="mono">{fm.number(counts[v])}</b>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

// ───────────────────────────────────────── view state ──
const RAW = { subgroup: parseAsString, lens: parseAsString, must_handle: parseAsString, page: parseAsString };

/** useTriageLens + the effective subgroup (lens type by default, `none` = off) and lens switching that keeps must_handle sane. */
export function useTriageState() {
  const tl = useTriageLens();
  const [raw, setRaw] = useQueryStates(RAW);
  const subNone = raw.subgroup === "none";
  const subgroup: GroupDim | null = subNone ? null : (tl.subgroup ?? (raw.subgroup ? null : tl.typeDim !== tl.group ? tl.typeDim : null));
  const setLens = useCallback(
    (l: TriageLens) => {
      if (l === "dev") tl.setLens("dev");
      // leaving the dev lens drops its must_handle=true default (an explicit "false" stays)
      else setRaw({ lens: null, page: null, ...(raw.must_handle === "true" ? { must_handle: null } : {}) }, { history: "push" });
    },
    [tl, setRaw, raw.must_handle],
  );
  const setSubgroup = useCallback(
    (g: GroupDim | null) => {
      if (g === null) setRaw({ subgroup: "none", page: null });
      else if (g === tl.typeDim) setRaw({ subgroup: null, page: null });
      else tl.setSubgroup(g);
    },
    [setRaw, tl],
  );
  return { ...tl, subgroup, setLens, setSubgroup };
}
export type TriageState = ReturnType<typeof useTriageState>;

// ───────────────────────────────────────── lens switch ──
export function LensSwitch({ ts, f, facets, fx }: { ts: TriageState; f: IssueFiltersApi; facets: Facets; fx: IssueFormat }) {
  const t = useT("issuesTriage");
  const fm = useFmt();
  const rm = useReducedMotionSafe();
  const lid = useId();
  const fc = facets?.facets;
  const issuesTotal = (fc?.severity ?? []).reduce((a, x) => a + (x.count ?? 0), 0);
  const ui = fc?.user_impact ?? [];
  const harm = ui.filter((x) => x.value === "safety_privacy" || x.value === "wrong_action").reduce((a, x) => a + x.count, 0);
  const mh = fc?.must_handle ?? [];
  const must = mh.find((x) => x.value === "true")?.count ?? 0;
  const oos = mh.find((x) => x.value === "false")?.count ?? 0;
  const lenses: { id: TriageLens; icon: ReactNode; stat: string }[] = [
    { id: "user", icon: <UserRound aria-hidden />, stat: fc ? t("lens.user.stat", { n: fm.number(harm), total: fm.number(issuesTotal) }) : "" },
    { id: "dev", icon: <Code2 aria-hidden />, stat: fc ? t("lens.dev.stat", { n: fm.number(must) }) : "" },
  ];
  const showOos = f.values.must_handle !== "true";
  return (
    <section className="ia-lens" data-lens={ts.lens} aria-label={t("lens.aria")}>
      <LayoutGroup id={lid}>
        <div className="ia-lens-seg" role="radiogroup" aria-label={t("lens.aria")}>
          {lenses.map((l) => {
            const on = ts.lens === l.id;
            return (
              <button key={l.id} type="button" role="radio" aria-checked={on} className={clsx("ia-lens-opt", on && "on")} data-l={l.id} onClick={() => !on && ts.setLens(l.id)}>
                {on ? <motion.span layoutId="ia-lens-ind" className="ia-lens-ind" aria-hidden transition={rm ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }} /> : null}
                <span className="ia-lens-ic">{l.icon}</span>
                <span className="ia-lens-tx">
                  <b>{t(`lens.${l.id}.title`)}</b>
                  <small>{t(`lens.${l.id}.sub`)}</small>
                </span>
                {l.stat ? <span className="ia-lens-st mono">{l.stat}</span> : null}
              </button>
            );
          })}
        </div>
      </LayoutGroup>
      <div className="ia-lens-aside">
        <p className="ia-lens-note">
          <span className="mono">{t("lens.shared")}</span> {t(`lens.${ts.lens}.note`)}
        </p>
        {ts.lens === "dev" ? (
          <label className="ia-oos">
            <input type="checkbox" role="switch" checked={showOos} onChange={(e) => f.set({ must_handle: e.target.checked ? null : "true" })} />
            <span className="ia-oos-track" aria-hidden>
              <i />
            </span>
            <span>
              {t("lens.dev.showOos")}
              <small className="mono">
                {f.values.must_handle === "false" ? t("lens.dev.onlyOos") : showOos ? t("lens.dev.oosShown", { n: fm.number(oos) }) : t("lens.dev.oosHidden", { n: fm.number(oos) })}
              </small>
            </span>
          </label>
        ) : null}
      </div>
      <span className="sr" aria-live="polite">
        {t("lens.announce", { lens: t(`lens.${ts.lens}.title`), type: fx.t.dynamic(`frame.dim.${ts.typeDim}`, undefined, ts.typeDim) })}
      </span>
    </section>
  );
}
