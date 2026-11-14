"use client";
/** Dimension switch (primary tabs + "더보기" menu), sort select and the cards/table toggle. View state, not filters. */
import clsx from "clsx";
import { Check, ChevronDown, LayoutGrid, Rows3 } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@/i18n/client";
import { useReducedMotionSafe } from "../../ui";
import type { ValueText } from "./labels";
import { CAT_MORE, CAT_TABS, CSORTS, CVIEWS, type CatDim, type CSort, type CView } from "./state";

const SPRING = { type: "spring" as const, stiffness: 520, damping: 40 };

export function DimSwitch({ dim, setDim, vt }: { dim: CatDim; setDim: (d: CatDim) => void; vt: ValueText }) {
  const t = useT("issuesCategories");
  const reduced = useReducedMotionSafe();
  const fromMore = !(CAT_TABS as readonly string[]).includes(dim);
  const tabs: CatDim[] = fromMore ? [...CAT_TABS, dim] : [...CAT_TABS];
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.indexOf(dim);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setDim(tabs[next]);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-dim="${tabs[next]}"]`)?.focus());
  };
  return (
    <div className="cat-switch">
      <span className="cat-switch-k">{t("switcher.label")}</span>
      <div className="cat-tabs-scroll">
        <LayoutGroup id="cat-dim">
          <div className="cat-tabs" role="tablist" aria-label={t("switcher.label")} ref={ref} onKeyDown={onKey}>
            {tabs.map((d) => {
              const on = d === dim;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  data-dim={d}
                  aria-selected={on}
                  aria-controls="cat-panel"
                  tabIndex={on ? 0 : -1}
                  className={clsx("cat-tab", on && "on", d === dim && fromMore && "extra")}
                  onClick={() => setDim(d)}
                >
                  {on ? <motion.span layoutId="cat-tab-ind" className="cat-tab-ind" transition={reduced ? { duration: 0 } : SPRING} /> : null}
                  <span className="cat-tab-l">{vt.dim(d)}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>
      </div>
      <MoreMenu dim={dim} setDim={setDim} vt={vt} />
    </div>
  );
}

function MoreMenu({ dim, setDim, vt }: { dim: CatDim; setDim: (d: CatDim) => void; vt: ValueText }) {
  const t = useT("issuesCategories");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    (box.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? box.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const active = (CAT_MORE as readonly string[]).includes(dim);
  return (
    <div className="cat-more" ref={box}>
      <button ref={btn} type="button" className={clsx("cat-more-btn", active && "on")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("switcher.more")}
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="cat-more-pop" role="menu" aria-label={t("switcher.moreLabel")} onKeyDown={onMenuKey}>
          {CAT_MORE.map((d) => (
            <button
              key={d}
              type="button"
              role="menuitemradio"
              aria-checked={d === dim}
              onClick={() => {
                setDim(d);
                setOpen(false);
                btn.current?.focus();
              }}
            >
              <span>{vt.dim(d)}</span>
              {d === dim ? <Check aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ViewControls({ csort, setSort, cview, setView }: { csort: CSort; setSort: (s: CSort) => void; cview: CView; setView: (v: CView) => void }) {
  const t = useT("issuesCategories");
  return (
    <div className="cat-ctrls">
      <label className="cat-sort">
        <span>{t("sort.label")}</span>
        <select value={csort} onChange={(e) => setSort(e.target.value as CSort)}>
          {CSORTS.map((s) => (
            <option key={s} value={s}>
              {t(`sort.${s}`)}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" />
      </label>
      <div className="cat-seg" role="radiogroup" aria-label={t("cview.label")}>
        {CVIEWS.map((v) => {
          const Ico = v === "cards" ? LayoutGrid : Rows3;
          return (
            <button key={v} type="button" role="radio" aria-checked={cview === v} className={clsx(cview === v && "on")} onClick={() => setView(v)}>
              <Ico aria-hidden="true" />
              <span>{t(`cview.${v}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
