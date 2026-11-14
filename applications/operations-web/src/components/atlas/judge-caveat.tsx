"use client";
/**
 * Judge-model confound caveat — shown wherever versions are compared and the LLM judge differs between the
 * pipeline versions behind the numbers (data: catalog JUDGE_MODEL_BY_PIPELINE_VERSION ← domain.ts releases).
 * Neutral location: used by both the Quality dashboard and Deep Analysis (imports neither).
 *
 *   mode "direct": the comparison IS between these pipeline versions (e.g. v1.1 vs v1.2-rc)
 *   mode "mixed":  another axis is compared (model / Bixby version) over rows that span these pipeline versions
 *
 * Usage: <JudgeCaveat versions={["v1.1", "v1.2-rc"]} mode="direct" />   (renders nothing when the judges agree)
 */
import { Scale } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/i18n/client";
import { judgeConfound, judgeList } from "@/lib/judge";

export function JudgeCaveat({ versions, mode, className }: { versions: Iterable<string>; mode: "direct" | "mixed"; className?: string }) {
  const t = useT("common");
  const c = judgeConfound(versions);
  if (!c) return null;
  const list = judgeList(c);
  return (
    <p className={clsx("note warn judge-caveat", className)} role="note" data-judge-caveat={mode} title={t("judge.source")}>
      <Scale aria-hidden />
      <b>{t("judge.title")}</b> · {t(`judge.${mode}`, { list })}
    </p>
  );
}
