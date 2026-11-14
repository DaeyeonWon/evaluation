"use client";
/** Market Brief — section heading (§ number, title, standfirst, optional right-hand controls). */
import type { ReactNode } from "react";
import { useT } from "@/i18n/client";

export function SecHead({ id, no, title, lead, right }: { id: string; no: number; title: string; lead?: string; right?: ReactNode }) {
  const t = useT("issuesReport");
  return (
    <header className="issb-sec-head">
      <span className="issb-sec-no">{t("section.no", { n: no })}</span>
      <h2 id={`${id}-h`}>{title}</h2>
      {lead ? <p>{lead}</p> : null}
      {right ? <div className="issb-sec-right">{right}</div> : null}
    </header>
  );
}
