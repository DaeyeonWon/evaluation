"use client";
/** Market Brief — sticky table of contents with scroll-spy (rail on desktop, chip strip on narrow screens). */
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { useReducedMotionSafe } from "../ui";

export interface TocItem {
  id: string;
  label: string;
  no: number;
}

export function Toc({ items }: { items: TocItem[] }) {
  const t = useT("issuesB");
  const [active, setActive] = useState(items[0]?.id);
  const reduced = useReducedMotionSafe();
  const stripRef = useRef<HTMLOListElement>(null);
  const ids = items.map((i) => i.id).join(",");

  useEffect(() => {
    const els = ids
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-h")) || 92;
    // the last section (document order) whose top has crossed the reading line; the first one above it.
    // A scroll listener (rAF-throttled) instead of an IntersectionObserver band, so jumping back to the top
    // (scrollTo(0, 0), Home key) always resets the highlight.
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = top + 96;
      let on = els[0];
      for (const el of els) if (el.getBoundingClientRect().top <= line) on = el;
      // at the very bottom the last section may never reach the line: highlight it once the page is fully scrolled
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && window.scrollY > 0) on = els[els.length - 1];
      setActive(on.id);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ids]);

  // keep the active chip visible inside the narrow strip (its own scroller, never the page)
  useEffect(() => {
    const strip = stripRef.current;
    const a = strip?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!strip || !a || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: a.offsetLeft - 16, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-h")) || 92;
    const strip = window.matchMedia("(max-width: 1099px)").matches ? 48 : 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - top - strip - 14, behavior: reduced ? "auto" : "smooth" });
    setActive(id);
    history.replaceState(history.state, "", `${location.pathname}${location.search}#${id}`);
  };

  return (
    <nav className="issb-toc" aria-label={t("toc.title")}>
      <div className="issb-toc-h">{t("toc.title")}</div>
      <ol ref={stripRef}>
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              data-id={i.id}
              className={clsx(active === i.id && "on")}
              aria-current={active === i.id ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(i.id);
              }}
            >
              <span className="issb-toc-no">{String(i.no).padStart(2, "0")}</span>
              <span className="issb-toc-l">{i.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
