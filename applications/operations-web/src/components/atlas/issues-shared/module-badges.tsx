"use client";
/**
 * <ModuleBadges feature="triage.cards" />   — compact "M1 M3 M8" chips (Atlas mono) for one feature
 * <ModuleBadges features={[...]} view />    — the union for a whole view (frame header)
 *
 * Chips are coloured by module status (Mock-simulated / not implemented). Hover, focus or click opens a popover
 * (portalled into the Atlas root, fixed-positioned, so overflow-hidden panels never clip it) listing each module's
 * name, tier and status with a link to /issues/modules#M3. Traffic-sensitive features add an "M9 미구현" chip:
 * their ranking is eval-set based. Features that need no module show "모듈 불필요".
 * Registry: src/config/analysis-modules.ts · copy: the `modules` namespace · styles: atlas-issues-modules.css.
 */
import clsx from "clsx";
import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { FEATURES, MODULES, modulesOf, type FeatureDeps, type FeatureId, type ModuleId } from "@/config/analysis-modules";
import { useT } from "@/i18n/client";
import "@/styles/atlas-issues-modules.css";

export const MODULES_PATH = "/issues/modules";
export const moduleHref = (m: ModuleId | string) => `${MODULES_PATH}#${m}`;

/** one chip, also used by the modules page */
export function ModuleChip({ id, className }: { id: ModuleId; className?: string }) {
  const m = MODULES[id];
  return (
    <span className={clsx("mb-chip", className)} data-status={m.status} data-tier={m.tier}>
      {id}
    </span>
  );
}

const OPEN_DELAY = 90;
const CLOSE_DELAY = 160;

export function ModuleBadges({ feature, features, view, className }: { feature?: FeatureId; features?: readonly FeatureId[]; view?: boolean; className?: string }) {
  const t = useT("modules");
  const ids = useMemo<readonly FeatureId[]>(() => (features ?? (feature ? [feature] : [])), [feature, features]);
  const deps = ids.map((f) => FEATURES[f] as FeatureDeps);
  const mods = useMemo(() => modulesOf(ids), [ids]);
  const traffic = deps.some((d) => d.traffic);
  const quality = !view && deps.some((d) => d.quality);
  const notes = view ? [] : ids.filter((f) => (FEATURES[f] as FeatureDeps).note);
  const none = mods.length === 0;

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const trig = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popId = useId();

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  }, []);
  const hide = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      setOpen(false);
      setPinned(false);
    }, CLOSE_DELAY);
  }, []);
  const close = useCallback((refocus = false) => {
    clear();
    setOpen(false);
    setPinned(false);
    if (refocus) trig.current?.focus();
  }, []);
  useEffect(() => clear, []);

  const place = useCallback(() => {
    const el = trig.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(340, vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const h = pop.current?.offsetHeight ?? 0;
    let top = r.bottom + 6;
    if (h && top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    setPos({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    setHost(trig.current?.closest('[data-variant="atlas"]') ?? document.body);
    place();
  }, [open, place]);
  // re-measure once the popover has rendered (its height decides above / below)
  useLayoutEffect(() => {
    if (open && host) place();
  }, [open, host, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (trig.current?.contains(n) || pop.current?.contains(n)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place, close]);

  const list = [...mods, ...(traffic ? ["M9"] : [])].join(", ") || t("badge.none");
  const label = t("badge.aria", { list });
  const title = view ? t("badge.view") : ids.length === 1 ? t.dynamic(`feature.${ids[0]}`, undefined, ids[0]) : t("badge.title");

  const popover =
    open && host
      ? createPortal(
          <div
            ref={pop}
            id={popId}
            role="dialog"
            aria-label={title}
            className="mb-pop"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width } as CSSProperties}
            onMouseEnter={clear}
            onMouseLeave={() => !pinned && hide()}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (!next || (!pop.current?.contains(next) && !trig.current?.contains(next))) close();
            }}
          >
            <div className="mb-pop-head">
              <span className="mb-pop-k">{view ? t("badge.view") : t("badge.title")}</span>
              {!view && ids.length === 1 ? <b>{title}</b> : null}
            </div>
            {none ? (
              <p className="mb-pop-none">
                <span className="mb-chip" data-status="free">
                  {t("badge.none")}
                </span>{" "}
                {t("badge.noneHelp")}
              </p>
            ) : (
              <ul className="mb-pop-list">
                {mods.map((m) => {
                  const mm = MODULES[m];
                  return (
                    <li key={m}>
                      <Link href={moduleHref(m)} className="mb-pop-row" onClick={() => close()}>
                        <ModuleChip id={m} />
                        <span className="mb-pop-name">{t.dynamic(`mod.${m}.name`, undefined, m)}</span>
                        <span className="mb-pop-meta">
                          <span className="mb-tier" data-tier={mm.tier}>
                            {t(`tier.${mm.tier}`)}
                          </span>
                          <span className="mb-st" data-status={mm.status}>
                            {t(`status.${mm.status}`)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {traffic ? (
              <Link href={moduleHref("M9")} className="mb-pop-traffic" onClick={() => close()}>
                <TriangleAlert aria-hidden />
                <span>
                  <b>M9 · {t("status.none")}</b> {t("badge.trafficHelp")}
                </span>
              </Link>
            ) : null}
            {notes.map((f) => (
              <p key={f} className="mb-pop-note">
                {t.dynamic(`featureNote.${f}`)}
              </p>
            ))}
            {quality && !notes.length ? <p className="mb-pop-note">{t("badge.quality")}</p> : null}
            <Link href={`${MODULES_PATH}#matrix`} className="mb-pop-all" onClick={() => close()}>
              {t("badge.all")} <ArrowRight aria-hidden />
            </Link>
          </div>,
          host,
        )
      : null;

  return (
    <span className={clsx("mb", view && "mb-view", className)} data-open={open || undefined}>
      <button
        ref={trig}
        type="button"
        className="mb-trig"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        onMouseEnter={() => !pinned && show()}
        onMouseLeave={() => !pinned && hide()}
        onFocus={() => !pinned && show()}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!(next && pop.current?.contains(next))) close();
        }}
        onClick={(e) => {
          clear();
          if (pinned) return close();
          setOpen(true);
          setPinned(true);
          // keyboard activation (detail 0): move into the popover so its links are reachable
          if (e.detail === 0) requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>("a")?.focus());
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            pop.current?.querySelector<HTMLElement>("a")?.focus();
          }
        }}
      >
        {none ? (
          <span className="mb-chip" data-status="free" aria-hidden>
            {t("badge.none")}
          </span>
        ) : (
          mods.map((m) => (
            <span key={m} aria-hidden className="mb-chip" data-status={MODULES[m].status}>
              {m}
            </span>
          ))
        )}
        {traffic ? (
          <span className="mb-chip" data-status="none" aria-hidden>
            {t("badge.traffic")}
          </span>
        ) : null}
      </button>
      {popover}
    </span>
  );
}
