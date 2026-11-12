"use client";
/**
 * Shared bits for file-name search (canvas toolbar + /files): match highlighting from
 * `match_ranges`, stage helpers, deep links and a 401/403 guard. The period itself is the shell's
 * global RangePicker (../time-range); links carry it via useRangeHref().
 */
import { useEffect, useMemo } from "react";
import { ApiClientError } from "@/lib/client";
import { STAGES } from "@/lib/catalog";
import type { FileSearchHit, StageId } from "@/lib/types";
import { redirectToLogin } from "../ui";
import "@/styles/atlas-files.css";

export const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);
export const stageNo = (s: StageId) => String(STAGE_ORDER.indexOf(s) + 1).padStart(2, "0");

/* ───────────── highlight ───────────── */
export function Hl({ text, hit, field, className }: { text: string; hit: Pick<FileSearchHit, "match_ranges">; field: "object" | "workflow_id" | "batch_id"; className?: string }) {
  const parts = useMemo(() => {
    const rs = hit.match_ranges
      .filter((m) => m.field === field && m.start < text.length && m.end > 0)
      .map((m) => ({ start: Math.max(0, m.start), end: Math.min(text.length, m.end) }))
      .sort((a, b) => a.start - b.start);
    const out: { s: string; m: boolean }[] = [];
    let i = 0;
    for (const r of rs) {
      if (r.start < i) continue;
      if (r.start > i) out.push({ s: text.slice(i, r.start), m: false });
      out.push({ s: text.slice(r.start, r.end), m: true });
      i = r.end;
    }
    if (i < text.length) out.push({ s: text.slice(i), m: false });
    return out;
  }, [text, hit.match_ranges, field]);
  return (
    <span className={className}>
      {parts.map((p, i) => (p.m ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}
    </span>
  );
}

/** Split an object path into "dir/" + "basename" (the basename is what people search for). */
export function splitPath(object: string): [string, string] {
  const i = object.lastIndexOf("/");
  return i < 0 ? ["", object] : [object.slice(0, i + 1), object.slice(i + 1)];
}

/* ───────────── auth guard ───────────── */
/** For screens without an inline <ErrorNote>: 401 → /login?next=<current url>. */
export function useAuthGuard(error: unknown) {
  const status = error instanceof ApiClientError ? error.status : null;
  useEffect(() => {
    if (status === 401) redirectToLogin();
  }, [status]);
}

/** Canvas URL with the stage inspector opened on its GCS tab, filtered to `q` (wrap with useRangeHref). */
export function inspectorHref(stage: StageId, q: string) {
  const p = new URLSearchParams({ stage, tab: "gcs" });
  if (q) p.set("q", q);
  return `/?${p.toString()}`;
}

/** Root PipelineJob id → workflow detail link with the attempt selected. */
export function jobHref(workflowId: string, jobId: string) {
  const m = /-attempt-(\d+)/.exec(jobId.split(".")[0]);
  return `/workflows/${encodeURIComponent(workflowId)}${m ? `?attempt=${m[1]}` : ""}`;
}
