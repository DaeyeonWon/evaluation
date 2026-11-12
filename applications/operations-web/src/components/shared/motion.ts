"use client";
/**
 * Motion helpers.
 *
 *   const reduced = usePrefersReducedMotion();
 *   const shown = useTween(kpi.running, { duration: 600 });   // animated number (no tween when reduced motion)
 *   <span>{fmt.number(useTween(value))}</span>
 *
 * For component animation use `motion` (Framer Motion): `import { motion, AnimatePresence } from "motion/react"`
 * and its own `useReducedMotion()`.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const RM_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeRM(cb: () => void) {
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeRM, () => window.matchMedia(RM_QUERY).matches, () => false);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export interface TweenOpts {
  /** ms (default 600) */
  duration?: number;
  /** round to N decimals each frame (default: integers if target is an integer, else 2) */
  decimals?: number;
  /** start from 0 on first mount (default false → starts at the value) */
  fromZero?: boolean;
  easing?: (t: number) => number;
}

/** Animated number that eases toward `value` whenever it changes. Respects prefers-reduced-motion. */
export function useTween(value: number, opts: TweenOpts = {}): number {
  const { duration = 600, fromZero = false, easing = easeOutCubic } = opts;
  const decimals = opts.decimals ?? (Number.isInteger(value) ? 0 : 2);
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(fromZero ? 0 : value);
  const fromRef = useRef(fromZero ? 0 : value);
  const shownRef = useRef(display);

  useEffect(() => {
    if (reduced || !Number.isFinite(value)) return;
    const from = shownRef.current;
    if (from === value) return;
    fromRef.current = from;
    const start = performance.now();
    const m = Math.pow(10, decimals);
    let raf = requestAnimationFrame(function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = Math.round((from + (value - from) * easing(t)) * m) / m;
      shownRef.current = v;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, duration, decimals, easing, reduced]);

  if (reduced || !Number.isFinite(value)) return value;
  return display;
}
