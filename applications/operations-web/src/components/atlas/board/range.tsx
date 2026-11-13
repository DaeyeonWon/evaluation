"use client";
/**
 * Board range helpers (the period itself is picked in the shell's global RangePicker):
 * - useRangeLabel(): localized label for the active range (the server's `range.label` is Korean-only).
 * - useRangeHref(): re-export of the shell helper (../time-range) — keeps the period on internal links.
 * - <RangeTag />: read-only label for the sheet head / inspector.
 */
import { useMemo } from "react";
import { useFmt, useLocale, useT } from "@/i18n/client";
import {
  RANGE_PRESETS,
  type RangeSpec,
  type ResolvedRange,
} from "@/lib/time-range";

export function useRangeLabel(
  spec: RangeSpec,
  resolved: ResolvedRange,
): string {
  const locale = useLocale();
  const f = useFmt();
  const t = useT("board");
  return useMemo(() => {
    if (spec.kind === "preset") {
      const info = RANGE_PRESETS.find((p) => p.id === spec.preset);
      const name = info
        ? locale === "en"
          ? info.labelEn
          : info.label
        : spec.preset;
      if (spec.preset === "today" || spec.preset === "yesterday")
        return `${name} · ${f.dateLabel(resolved.from)}`;
      return name;
    }
    if (spec.kind === "last")
      return t(spec.unit === "d" ? "range.lastDays" : "range.lastHours", {
        count: spec.amount,
      });
    const open = !Number.isFinite(spec.to);
    return `${f.dateTimeLabel(resolved.from, { tz: false })} – ${open ? t("range.now") : f.dateTimeLabel(resolved.to)}`;
  }, [spec, resolved.from, resolved.to, locale, f, t]);
}

/** href + current range params — the shell helper (keeps range/from/to, replaces stale ones, preserves #hash). */
export { useRangeHref } from "../time-range";

/** Read-only period label for sheet heads (the period is chosen in the shell's global RangePicker). */
export function RangeTag({ label }: { label: string }) {
  const t = useT("board");
  return (
    <span className="bd-range-lbl" aria-live="polite">
      <span className="k">{t("range.label")}</span> {label}
    </span>
  );
}
