"use client";
/**
 * I-01 · Issue Report chooser (/issues). Presents design candidates A/B/C with a live headline from
 * /api/v1/issues/summary. Owned by the data/platform engineer (candidates live in issues-a|b|c/).
 */
import { ArrowUpRight, ShieldAlert, Siren, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { motion } from "motion/react";
import { useTween } from "@/components/shared";
import { useFmt, useT } from "@/i18n/client";
import { useIssueFilters, useIssueFormat, useIssueSummary } from "./issues-shared";
import { useRangeHref } from "./time-range";
import { ErrorNote, Sheet, SheetHead, useReducedMotionSafe } from "./ui";
import "@/styles/atlas-issues.css";

const CANDIDATES = ["a", "b", "c"] as const;

function Thumb({ id }: { id: (typeof CANDIDATES)[number] }) {
  // schematic previews in the blueprint idiom (no data, purely illustrative)
  if (id === "a")
    return (
      <svg viewBox="0 0 160 90" aria-hidden="true">
        {[0, 1, 2].map((c) =>
          [0, 1, 2].map((r) => (
            <g key={`${c}${r}`}>
              <rect x={6 + c * 51} y={8 + r * 26} width={46} height={21} className={r === 0 && c === 0 ? "th-hot" : "th-card"} />
              <rect x={10 + c * 51} y={22 + r * 26} width={[30, 22, 14][r] - c * 3} height={3} className="th-bar" />
            </g>
          )),
        )}
      </svg>
    );
  if (id === "c")
    return (
      <svg viewBox="0 0 160 90" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, r) =>
          Array.from({ length: 8 }).map((__, c) => {
            const v = (Math.sin(r * 1.7 + c * 0.9) + 1) / 2;
            return <rect key={`${r}${c}`} x={8 + c * 18} y={6 + r * 13} width={16} height={11} className="th-cell" style={{ opacity: Math.round((0.12 + v * (r === 1 && c === 5 ? 1 : 0.55)) * 100) / 100 }} />;
          }),
        )}
        <circle cx={107} cy={25} r={9} className="th-ring" />
      </svg>
    );
  return (
    <svg viewBox="0 0 160 90" aria-hidden="true">
      <rect x={8} y={8} width={92} height={6} className="th-ink" />
      {[22, 32, 42, 52, 62].map((y, i) => (
        <rect key={y} x={8} y={y} width={[88, 74, 82, 60, 70][i]} height={3} className="th-bar" />
      ))}
      <rect x={110} y={8} width={42} height={36} className="th-card" />
      <path d="M114 38 L122 30 L130 34 L138 20 L148 24" className="th-line" />
      <rect x={110} y={50} width={42} height={32} className="th-hot" />
    </svg>
  );
}

function Num({ v, fmt }: { v: number | null | undefined; fmt: (n: number) => string }) {
  const tv = useTween(v ?? 0, { duration: 700 });
  return <>{v == null ? "—" : fmt(tv)}</>;
}

export function IssuesIndex() {
  const t = useT("issues");
  const nav = useT("nav");
  const f = useFmt();
  const fx = useIssueFormat();
  const rh = useRangeHref();
  const filters = useIssueFilters();
  const sum = useIssueSummary(filters);
  const rm = useReducedMotionSafe();
  const k = sum.data?.kpis;
  const top = sum.data?.top_issues.slice(0, 3) ?? [];
  const int = (n: number) => f.number(Math.round(n));

  return (
    <Sheet className="iss-index">
      <SheetHead dwg={t("chooser.dwg")} title={nav("issues.title")} desc={t("subtitle")} />
      {sum.error ? <ErrorNote error={sum.error} /> : null}

      <section className="iss-headline" aria-label={t("chooser.live")}>
        <div className="iss-hl-tag">
          <span className="iss-pulse" aria-hidden="true" />
          {t("chooser.live")}
        </div>
        <dl className="iss-hl-grid">
          <div data-tone="p0">
            <dt>
              <Siren aria-hidden /> {t("kpi.criticalOpen")}
            </dt>
            <dd>
              <Num v={k?.critical_open} fmt={int} />
            </dd>
          </div>
          <div data-tone="safety">
            <dt>
              <ShieldAlert aria-hidden /> {t("kpi.safety")}
            </dt>
            <dd>
              <Num v={k?.safety_issues} fmt={int} />
            </dd>
          </div>
          <div>
            <dt>
              <TrendingUp aria-hidden /> {t("kpi.failRate")}
            </dt>
            <dd>
              <Num v={k?.fail_rate} fmt={(n) => n.toFixed(1)} />
              <small>%</small>
              <span className="iss-delta" data-dir={(k?.fail_rate_delta ?? 0) > 0 ? "up" : "down"}>
                {fx.pp(k?.fail_rate_delta)}
              </span>
            </dd>
          </div>
          <div>
            <dt>
              <Sparkles aria-hidden /> {t("kpi.newPatterns")}
            </dt>
            <dd>
              <Num v={k?.new_patterns} fmt={int} />
            </dd>
          </div>
          <div>
            <dt>{t("kpi.issues")}</dt>
            <dd>
              <Num v={k?.issues} fmt={int} />
              <small>
                P0 {k?.by_severity.P0 ?? "—"} · P1 {k?.by_severity.P1 ?? "—"}
              </small>
            </dd>
          </div>
        </dl>
        <ol className="iss-hl-top">
          {top.map((i) => (
            <li key={i.id}>
              <span className="iss-sev" data-sev={i.severity}>
                {i.severity}
              </span>
              <span className="iss-hl-title">{fx.text(i.title)}</span>
              <span className="iss-hl-score">{fx.score(i.score)}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="iss-lead">{t("chooser.lead")}</p>
      <div className="iss-cands">
        {CANDIDATES.map((id, n) => (
          <motion.div
            key={id}
            initial={rm ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, delay: rm ? 0 : 0.06 * n, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <Link className="iss-cand" href={rh(`/issues/${id}`)}>
              <div className="iss-cand-no">{t("chooser.candidate", { id: id.toUpperCase() })}</div>
              <div className="iss-cand-thumb">
                <Thumb id={id} />
              </div>
              <h2>{t(`chooser.${id}.name`)}</h2>
              <p>{t(`chooser.${id}.concept`)}</p>
              <span className="iss-cand-open">
                {t("chooser.open")} <ArrowUpRight aria-hidden />
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
      <p className="iss-foot">{t("chooser.footnote")}</p>
    </Sheet>
  );
}
