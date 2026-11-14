"use client";
/** Market Brief — section heading (§ number, title, standfirst, optional right-hand controls). */
import type { ReactNode } from "react";
import type { FeatureId } from "@/config/analysis-modules";
import { useT } from "@/i18n/client";
import { ModuleBadges } from "../../issues-shared";

/** section id (issb-<section>) → its analysis-module feature */
const SEC_FEATURE: Record<string, FeatureId> = {
  "issb-exec": "report.exec",
  "issb-critical": "report.dossiers",
  "issb-user": "report.userImpact",
  "issb-dev": "report.devMiss",
  "issb-division": "report.division",
  "issb-region": "report.region",
  "issb-bixby": "report.bixby",
  "issb-regression": "report.regression",
  "issb-patterns": "report.patterns",
  "issb-markets": "report.markets",
  "issb-appendix": "report.appendix",
  "issb-notes": "report.notes",
};

export function SecHead({ id, no, title, lead, right }: { id: string; no: number; title: string; lead?: string; right?: ReactNode }) {
  const t = useT("issuesReport");
  return (
    <header className="issb-sec-head">
      <span className="issb-sec-no">{t("section.no", { n: no })}</span>
      <h2 id={`${id}-h`}>{title}</h2>
      {lead ? <p>{lead}</p> : null}
      {SEC_FEATURE[id] ? (
        <div className="issb-sec-mods">
          <ModuleBadges feature={SEC_FEATURE[id]} />
        </div>
      ) : null}
      {right ? <div className="issb-sec-right">{right}</div> : null}
    </header>
  );
}
