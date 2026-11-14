"use client";
/**
 * Quality dashboard — row-dim FilterBar. Each dim is a dropdown of its values (count · pass rate · Δ, fetched
 * lazily from /quality/breakdown with every OTHER filter applied); selections write the URL (useQualityFilters),
 * so every view re-queries. ≤ 720px: dims wrap; the "more" row toggles the secondary dims.
 */
import clsx from "clsx";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useFmt, useT } from "@/i18n/client";
import { useApi, qualityApi } from "@/lib/client";
import type { QualityDim } from "@/lib/types";
import { useReducedMotionSafe } from "../ui";
import { MORE_KEYS, PRIMARY_KEYS, fmtPp, fmtRate, useQLabel, type FilterKey, type QualityFiltersApi } from "./model";

type Opt = {
  value: string;
  total: number;
  pass_rate: number | null;
  delta: number | null;
};

function useOptions(dim: FilterKey, f: QualityFiltersApi, open: boolean): { opts: Opt[]; loading: boolean } {
  const q = useMemo(() => {
    const x = { ...f.query } as Record<string, unknown>;
    delete x[dim];
    return x;
  }, [f.query, dim]);
  const res = useApi(
    open && dim !== "result" ? ["quality", "opts", dim, q] : null,
    () =>
      qualityApi.breakdown({
        ...q,
        dim: dim as QualityDim,
        sort: "natural",
        limit: 300,
      }),
    { throttleMs: 4000 },
  );
  return useMemo(() => {
    if (dim === "result")
      return {
        opts: ["PASS", "FAIL"].map((value) => ({
          value,
          total: 0,
          pass_rate: null,
          delta: null,
        })),
        loading: false,
      };
    const items = res.data?.items ?? [];
    const opts: Opt[] = items.map((i) => ({
      value: i.value,
      total: dim === "failure_reason" ? i.fail : i.total,
      pass_rate: dim === "failure_reason" ? null : i.pass_rate,
      delta: dim === "failure_reason" ? null : i.delta_pp,
    }));
    for (const v of f.values[dim]) if (!opts.some((o) => o.value === v)) opts.push({ value: v, total: 0, pass_rate: null, delta: null });
    return { opts, loading: !res.data };
  }, [dim, res.data, f.values]);
}

function DimMenu({ dim, f, alignRight }: { dim: FilterKey; f: QualityFiltersApi; alignRight?: boolean }) {
  const t = useT("quality");
  const fm = useFmt();
  const L = useQLabel();
  const rm = useReducedMotionSafe();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const { opts, loading } = useOptions(dim, f, open);
  const sel = f.values[dim];
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const ql = query.trim().toLowerCase();
  const shown = ql ? opts.filter((o) => (o.value + " " + L.value(dim, o.value)).toLowerCase().includes(ql)) : opts;
  const max = Math.max(1, ...opts.map((o) => o.total));
  const summary = sel.length === 0 ? t("filter.all") : sel.length === 1 ? L.value(dim, sel[0]) : t("filter.nSelected", { count: sel.length });
  return (
    <div className="qd-dimw" ref={ref}>
      <button type="button" className={clsx("qd-dim", sel.length && "on")} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="qd-dim-k">{L.dim(dim)}</span>
        <span className={sel.length ? "qd-dim-v" : "qd-dim-all"}>{summary}</span>
        <ChevronDown aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={id}
            className={clsx("qd-pop", alignRight && "right")}
            role="dialog"
            aria-label={L.dim(dim)}
            initial={rm ? false : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={rm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: rm ? 0 : 0.14 }}
          >
            <div className="qd-pop-head">
              <b>{L.dim(dim)}</b>
              <span className="mono muted">{dim === "failure_reason" ? t("filter.colFails") : t("filter.colRows")}</span>
            </div>
            {opts.length > 8 ? (
              <input className="in" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("filter.search")} aria-label={t("filter.search")} autoFocus />
            ) : null}
            {loading ? (
              <p className="qd-empty muted">{t("state.loading")}</p>
            ) : (
              <ul className="qd-vals" role="group" aria-label={L.dim(dim)}>
                {shown.map((o) => {
                  const on = sel.includes(o.value);
                  return (
                    <li key={o.value}>
                      <button
                        type="button"
                        className={clsx("qd-val", on && "on")}
                        aria-pressed={on}
                        onClick={() => f.toggle(dim, o.value)}
                        style={
                          {
                            ["--w" as string]: `${(o.total / max) * 100}%`,
                          } as CSSProperties
                        }
                      >
                        <span className="qd-box" aria-hidden>
                          {on ? <Check /> : null}
                        </span>
                        <span className="qd-vl">{L.value(dim, o.value)}</span>
                        <span className="qd-n mono">{o.total ? fm.number(o.total) : ""}</span>
                        <span className="qd-r mono">{o.pass_rate != null ? fmtRate(o.pass_rate) : ""}</span>
                        <span className="qd-d mono" data-dir={o.delta == null ? undefined : o.delta > 0.05 ? "up" : o.delta < -0.05 ? "down" : "flat"}>
                          {o.delta != null ? fmtPp(o.delta) : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!shown.length ? <li className="qd-empty muted">{t("filter.noValues")}</li> : null}
              </ul>
            )}
            <div className="qd-pop-foot">
              <button type="button" className="btn sm ghost" onClick={() => f.set(dim, [])} disabled={!sel.length}>
                {t("filter.reset")}
              </button>
              <button type="button" className="btn sm" onClick={() => setOpen(false)}>
                {t("filter.done")}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function FilterBar({ f }: { f: QualityFiltersApi }) {
  const t = useT("quality");
  const L = useQLabel();
  const moreActive = MORE_KEYS.some((k) => f.values[k].length);
  const [more, setMore] = useState(moreActive);
  const showMore = more || moreActive;
  return (
    <section className="qd-fb" aria-label={t("filter.label")}>
      <div className="qd-fb-row">
        <span className="qd-fb-label">
          <SlidersHorizontal aria-hidden />
          {t("filter.label")}
        </span>
        <div className="qd-dims">
          {PRIMARY_KEYS.map((k, i) => (
            <DimMenu key={k} dim={k} f={f} alignRight={i >= PRIMARY_KEYS.length - 2} />
          ))}
          <button type="button" className={clsx("btn sm ghost qd-more", showMore && "on")} aria-expanded={showMore} onClick={() => setMore((m) => !m)}>
            {showMore ? t("filter.less") : t("filter.more", { count: MORE_KEYS.length })}
            <ChevronDown aria-hidden data-open={showMore || undefined} />
          </button>
        </div>
      </div>
      {showMore ? (
        <div className="qd-fb-row qd-fb-more">
          <div className="qd-dims">
            {MORE_KEYS.map((k, i) => (
              <DimMenu key={k} dim={k} f={f} alignRight={i >= MORE_KEYS.length - 2} />
            ))}
          </div>
        </div>
      ) : null}
      {f.active.length ? (
        <div className="qd-chips">
          <span className="qd-chips-k mono">{t("filter.active")}</span>
          <ul>
            {f.active.map((a) => (
              <li key={a.key + ":" + a.value}>
                <button
                  type="button"
                  className="qd-chip"
                  onClick={() => f.toggle(a.key, a.value)}
                  aria-label={t("filter.remove", {
                    dim: L.dim(a.key),
                    value: L.value(a.key, a.value),
                  })}
                >
                  <span className="muted">{L.dim(a.key)}</span>
                  <span className="qd-chip-v">{L.value(a.key, a.value)}</span>
                  <X aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="qd-clear" onClick={f.clear}>
            {t("filter.clear")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
