"use client";
/**
 * Remembers the last opened workflow (for the "상세" rail item) and where the operator came from
 * (breadcrumb context). sessionStorage-backed, read through useSyncExternalStore (SSR → null).
 */
import { useSyncExternalStore } from "react";

const KEY = "flowline.lastWorkflow";
const listeners = new Set<() => void>();
let cache: string | null | undefined;

function read(): string | null {
  if (cache !== undefined) return cache;
  try {
    cache = window.sessionStorage.getItem(KEY);
  } catch {
    cache = null;
  }
  return cache;
}

export function setLastWorkflow(id: string) {
  if (cache === id) return;
  cache = id;
  try {
    window.sessionStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useLastWorkflow(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
}

/** Build a workflow-detail href that carries its origin for breadcrumbs. */
export function wfHref(id: string, from?: { screen: string; stage?: string; fq?: string }): string {
  const sp = new URLSearchParams();
  if (from?.screen) sp.set("from", from.screen);
  if (from?.stage) sp.set("stage", from.stage);
  if (from?.fq) sp.set("fq", from.fq);
  const s = sp.toString();
  return `/flowline/workflows/${encodeURIComponent(id)}${s ? "?" + s : ""}`;
}
