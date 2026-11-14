"use client";
/**
 * Quality dashboard frame — persistent chrome of /quality/** (mounted once by app/(console)/quality/layout.tsx):
 *
 *   header    Q-01 title · view description · "no analysis module" marker · Δ window tag · link to Deep Analysis (/issues)
 *   tabs      개요 · 분해 · 매트릭스 · 버전 비교 · 분포 (links carry the filters + range; animated indicator)
 *   FilterBar row-dim filters (./filter-bar.tsx)
 *   {children} the view
 */
import clsx from "clsx";
import { ArrowUpRight, BarChart3, Database, Grid3x3, GitCompare, LayoutDashboard, Rows3 } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useFmt, useT } from "@/i18n/client";
import { Sheet, useReducedMotionSafe } from "../ui";
import { useRangeHref } from "../time-range";
import { useRangeInfo } from "../analytics/kit";
import { FilterBar } from "./filter-bar";
import { VIEWS, useQualityFilters, useQualityView, viewPath, type QualityView } from "./model";
import "@/styles/atlas-quality.css";

const ICON: Record<QualityView, typeof Rows3> = {
  overview: LayoutDashboard,
  breakdown: Rows3,
  matrix: Grid3x3,
  versions: GitCompare,
  distributions: BarChart3,
};

function Tabs({ current, qs }: { current: QualityView; qs: string }) {
  const t = useT("quality");
  const rm = useReducedMotionSafe();
  const [pending, setPending] = useState<QualityView | null>(null);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPending(null);
  }
  const active = pending ?? current;
  return (
    <nav className="qd-tabs" aria-label={t("frame.switcher")}>
      <LayoutGroup id="qd-tabs">
        {VIEWS.map((v) => {
          const Icon = ICON[v];
          const on = v === active;
          return (
            <Link
              key={v}
              href={viewPath(v) + (qs ? "?" + qs : "")}
              className={clsx("qd-tab", on && "on")}
              aria-current={v === current ? "page" : undefined}
              onClick={() => setPending(v)}
              scroll={false}
            >
              <Icon aria-hidden />
              <span>{t(`view.${v}.tab`)}</span>
              {on ? <motion.span className="qd-tab-ind" layoutId="qd-tab-ind" transition={rm ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }} aria-hidden /> : null}
            </Link>
          );
        })}
      </LayoutGroup>
    </nav>
  );
}

/** "Δ vs <previous equal window>" tag (client-side resolution of the same rule the API applies) */
function WindowTag() {
  const t = useT("quality");
  const fm = useFmt();
  const tr = useRangeInfo();
  const span = tr.range.to - tr.range.from;
  const from = tr.range.from - span;
  const to = tr.range.from;
  return (
    <span className="qd-win" title={t("frame.windowTip")}>
      <span className="qd-win-k">Δ</span>
      {t("frame.window", {
        from: fm.dateTimeLabel(from, { tz: false }),
        to: fm.dateTimeLabel(to, { tz: false }),
      })}
    </span>
  );
}

export function QualityFrame({ children }: { children: ReactNode }) {
  const t = useT("quality");
  const nav = useT("nav");
  const view = useQualityView();
  const f = useQualityFilters();
  const rh = useRangeHref();
  return (
    <Sheet className="qd">
      <header className="qd-head">
        <div className="qd-title">
          <span className="dwg">
            {t("frame.dwg")} · {t(`view.${view}.tab`).toUpperCase()}
            <span className="phase-tag" data-phase="1" title={t("frame.phaseTip")}>
              {t("frame.phase")}
            </span>
          </span>
          <h1>
            {nav("quality.title")}
            <span className="qd-h-view">{t(`view.${view}.tab`)}</span>
          </h1>
          <p>{t(`view.${view}.desc`)}</p>
        </div>
        <div className="qd-acts">
          <span className="qd-marker" title={t("frame.markerTip")} tabIndex={0}>
            <Database aria-hidden />
            <span>{t("frame.marker")}</span>
          </span>
          <WindowTag />
          <Link className="btn sm qd-deep" href={rh("/issues")} title={t("frame.deepTip")}>
            <span>{t("frame.deep")}</span>
            <ArrowUpRight aria-hidden />
          </Link>
        </div>
      </header>
      <Tabs current={view} qs={f.qs} />
      <FilterBar f={f} />
      <div className="qd-body">{children}</div>
    </Sheet>
  );
}
