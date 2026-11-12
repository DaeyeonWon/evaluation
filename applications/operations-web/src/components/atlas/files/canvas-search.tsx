"use client";
/**
 * File-name search for the orchestration canvas toolbar. Pure UI: the canvas owns the query (URL
 * `?q=`), the request and what happens on pick (pan/zoom + open the stage inspector on its GCS tab).
 * Results are grouped by stage in pipeline order; the combobox is keyboard-driven (↑↓ Enter Esc).
 */
import clsx from "clsx";
import { ArrowUpRight, Crosshair, Search, X } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CatalogIcon, StatusPill } from "@/components/shared";
import { stageLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { STAGE_BY_ID } from "@/lib/catalog";
import { useSimNow } from "@/lib/client";
import type { FileSearchHit, FileSearchResult, StageId } from "@/lib/types";
import { useReducedMotionSafe } from "../ui";
import { Hl, STAGE_ORDER, splitPath, stageNo } from "./common";

const PER_STAGE = 4;

export interface CanvasSearchHandle {
  focus(): void;
}

export const CanvasSearch = forwardRef<
  CanvasSearchHandle,
  {
    value: string;
    onChange: (v: string) => void;
    result: FileSearchResult | undefined;
    loading: boolean;
    error: boolean;
    onPick: (hit: FileSearchHit) => void;
    onPickStage: (stage: StageId) => void;
    filesHref: (stage?: StageId) => string;
  }
>(function CanvasSearch({ value, onChange, result, loading, error, onPick, onPickStage, filesHref }, ref) {
  const t = useT("orchestration");
  const tf = useT("files");
  const locale = useLocale();
  const f = useFmt();
  const now = useSimNow();
  const reduced = useReducedMotionSafe();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // the active option resets whenever a new result arrives (state keyed by the result object)
  const [act, setAct] = useState<{ r: FileSearchResult | undefined; i: number }>({ r: undefined, i: 0 });
  const lid = useId();
  useImperativeHandle(ref, () => ({
    focus: () => {
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    },
  }));

  const q = value.trim();
  const groups = useMemo(() => {
    if (!result || !q) return [];
    const by = new Map<StageId, FileSearchHit[]>();
    for (const h of result.items) (by.get(h.stage) ?? by.set(h.stage, []).get(h.stage)!).push(h);
    return STAGE_ORDER.filter((s) => (result.byStage[s] ?? 0) > 0).map((s) => ({ stage: s, total: result.byStage[s] ?? 0, items: (by.get(s) ?? []).slice(0, PER_STAGE) }));
  }, [result, q]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = act.r === result ? act.i : 0;
  const setActive = (fn: number | ((a: number) => number)) => setAct({ r: result, i: typeof fn === "function" ? fn(active) : fn });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const pick = (h: FileSearchHit) => {
    setOpen(false);
    onPick(h);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (open && q) setOpen(false);
      else {
        onChange("");
        input.current?.blur();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (!flat.length) return;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
      return;
    }
    if (e.key === "Enter" && flat.length) {
      e.preventDefault();
      pick(flat[Math.min(active, flat.length - 1)]);
    }
  };
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${lid}-o${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, lid]);

  const show = open && !!q;
  const stagesN = groups.length;
  const shownTotal = result?.total ?? 0;
  let idx = -1;
  return (
    <div className={clsx("cvs-search", show && "open")} ref={box}>
      <div className="cvs-field">
        <Search aria-hidden className="ic" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label={t("search.label")}
          aria-expanded={show}
          aria-controls={`${lid}-lb`}
          aria-autocomplete="list"
          aria-activedescendant={show && flat.length ? `${lid}-o${active}` : undefined}
          placeholder={t("search.placeholder")}
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {loading && q ? <span className="spin" aria-label={t("search.searching")} /> : null}
        {value ? (
          <button type="button" className="x" aria-label={t("search.clear")} onClick={() => (onChange(""), input.current?.focus())}>
            <X />
          </button>
        ) : (
          <kbd className="kbd" title={t("search.shortcutHint")}>
            {t("search.shortcut")}
          </kbd>
        )}
      </div>
      <AnimatePresence>
        {show ? (
          <motion.div
            className="cvs-drop"
            initial={reduced ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="cvs-sum" aria-live="polite">
              {error ? (
                <span className="sev-ERROR">{t("search.error")}</span>
              ) : !result ? (
                <span className="muted">{t("search.searching")}</span>
              ) : shownTotal ? (
                <span>
                  {result.total > result.items.length
                    ? t("search.summaryCapped", { total: result.total, shown: result.items.length, stages: stagesN })
                    : t("search.summary", { count: result.total, stages: stagesN })}
                </span>
              ) : null}
              <span className="kh">{t("search.keyboard")}</span>
            </div>
            {result && !shownTotal && !error ? (
              <div className="cvs-none">
                <b>{t("search.none", { q })}</b>
                <p>{t("search.noneHint")}</p>
              </div>
            ) : null}
            <div className="cvs-list" role="listbox" id={`${lid}-lb`} aria-label={t("search.resultsAria")}>
              {groups.map((g) => {
                const st = STAGE_BY_ID[g.stage];
                const more = g.total - g.items.length;
                return (
                  <div key={g.stage} role="group" aria-label={`${stageLabel(g.stage, locale)} · ${t("search.hitCount", { count: g.total })}`} className="cvs-grp">
                    <div className="gh">
                      <span className="no">{stageNo(g.stage)}</span>
                      <CatalogIcon name={st.icon} aria-hidden className="gi" />
                      <span className="gl">{stageLabel(g.stage, locale)}</span>
                      <span className="gc">{t("search.hitCount", { count: g.total })}</span>
                      <button type="button" className="gs" onClick={() => (setOpen(false), onPickStage(g.stage))} title={t("search.showStage")} aria-label={`${t("search.showStage")}: ${stageLabel(g.stage, locale)}`}>
                        <Crosshair aria-hidden />
                      </button>
                    </div>
                    {g.items.map((h) => {
                      idx++;
                      const i = idx;
                      const [dir, base] = splitPath(h.object);
                      return (
                        <div
                          key={`${h.stage}|${h.uri}|${h.ref ?? ""}|${h.updated}`}
                          id={`${lid}-o${i}`}
                          role="option"
                          aria-selected={i === active}
                          className={clsx("cvs-opt", i === active && "on")}
                          onPointerEnter={() => setActive(i)}
                          onClick={() => pick(h)}
                        >
                          <span className="p">
                            <Hl text={dir} hit={h} field="object" className="dir" />
                            <PathTail hit={h} dirLen={dir.length} base={base} />
                          </span>
                          <span className="m">
                            <span>{tf(`kinds.${h.kind}`)}</span>
                            {h.workflow_id ? <span className="mono">{h.workflow_id}</span> : null}
                            <span className="mono" suppressHydrationWarning>
                              {f.relative(h.updated, now)}
                            </span>
                          </span>
                          {h.current_status ? <StatusPill status={h.current_status} size="xs" className="s" /> : <span />}
                        </div>
                      );
                    })}
                    {more > 0 ? (
                      <Link className="cvs-more" href={filesHref(g.stage)}>
                        {t("search.moreInStage", { count: more })}
                        <ArrowUpRight aria-hidden />
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Link className="cvs-foot" href={filesHref()}>
              <span>{t("search.openAll")}</span>
              <ArrowUpRight aria-hidden />
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

/** Basename part of the path, highlighted with ranges shifted by the directory length. */
function PathTail({ hit, dirLen, base }: { hit: FileSearchHit; dirLen: number; base: string }) {
  const shifted = { match_ranges: hit.match_ranges.map((m) => (m.field === "object" ? { ...m, start: m.start - dirLen, end: m.end - dirLen } : m)) };
  return <Hl text={base} hit={shifted} field="object" className="base" />;
}
