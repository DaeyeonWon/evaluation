"use client";
/**
 * CSV download helpers. The server streams text/csv with a UTF-8 BOM (Excel-safe Korean) and a
 * Content-Disposition filename, so a plain navigation is enough — no Blob juggling needed.
 *
 *   <a href={csvUrl({ language: "ko", result: "FAIL" })} download>CSV</a>
 *   downloadCsv({ ids: selectedIds })                       // selected rows only
 *   downloadCsv(filters, { filename: "ko-fail.csv" })
 */
import { API_BASE, qs, type ResultQuery } from "./api";

export function csvUrl(filters: ResultQuery = {}, opts: { filename?: string; columns?: string[] } = {}): string {
  const { page: _p, pageSize: _ps, ...rest } = filters;
  void _p;
  void _ps;
  return API_BASE + "/results/csv" + qs({ ...rest, filename: opts.filename, columns: opts.columns });
}

/** Trigger a browser download of the (filtered) results CSV. */
export function downloadCsv(filters: ResultQuery = {}, opts: { filename?: string; columns?: string[] } = {}): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = csvUrl(filters, opts);
  a.rel = "noopener";
  a.download = opts.filename ?? "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download arbitrary text as a file (e.g. exported logs as .jsonl). */
export function downloadText(text: string, filename: string, mime = "text/plain;charset=utf-8"): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
