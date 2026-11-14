"use client";
/** Value label + one-line help text for every breakdown dim (taxonomy help, division devices, region markets, version status). */
import { useMemo } from "react";
import { BIXBY_VERSION_INFO, DEVICE_DIVISION, MARKET_REGION } from "@/lib/catalog";
import { deviceLabel } from "@/i18n";
import { useLocale, useT } from "@/i18n/client";
import { useDimLabel, useIssueFormat } from "../../issues-shared";

const HELP_GROUP: Record<string, string> = { category: "categoryHelp", user_impact: "userImpactHelp", dev_miss: "devMissHelp", severity: "severityHelp", status: "statusHelp" };

export function useValueText() {
  const t = useT("issuesCategories");
  const s = useT("issues");
  const fx = useIssueFormat();
  const dl = useDimLabel();
  const locale = useLocale();
  return useMemo(() => {
    const label = (dim: string, v: string) => {
      if (v === "__other__") return s("dimValue.other");
      if (dim === "severity") return `${v} · ${s.dynamic(`impactLevel.${v}`, undefined, v)}`;
      return dl.value(dim, v);
    };
    /** short label for tight places (chart axes) */
    const short = (dim: string, v: string) => (dim === "severity" ? v : dim === "market" ? v : label(dim, v));
    const help = (dim: string, v: string): string => {
      const g = HELP_GROUP[dim];
      if (g) return s.dynamic(`${g}.${v}`, undefined, "");
      if (dim === "division") {
        const list = Object.entries(DEVICE_DIVISION)
          .filter(([, d]) => d === v)
          .map(([dev]) => deviceLabel(dev, locale));
        return list.length ? t("help.devices", { list: list.join(" · ") }) : "";
      }
      if (dim === "region") {
        const list = Object.entries(MARKET_REGION)
          .filter(([, r]) => r === v)
          .map(([m]) => `${m} ${fx.market(m)}`);
        return list.length ? t("help.markets", { list: list.join(" · ") }) : "";
      }
      if (dim === "bixby_version") {
        const info = BIXBY_VERSION_INFO.find((x) => x.version === v);
        return info ? t("help.version", { status: t.dynamic(`ordered.status.${info.status}`, undefined, info.status) }) : "";
      }
      return "";
    };
    return { label, short, help, dim: dl.dim };
  }, [t, s, fx, dl, locale]);
}
export type ValueText = ReturnType<typeof useValueText>;
