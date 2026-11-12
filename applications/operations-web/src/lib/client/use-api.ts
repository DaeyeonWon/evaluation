"use client";
/**
 * useApi — a tiny SWR-style hook.
 *
 *   const { data, error, isLoading, mutate } = useApi(["workflows", query], () => api.workflows(query), {
 *     revalidateOn: ["transition"],   // refetch (throttled) when these SSE messages arrive
 *     refreshInterval: 0,             // optional polling (ms)
 *     keepPrevious: true,             // keep showing old data while a new key loads (default true)
 *   });
 *
 * - `key`: any JSON-serializable value (or null to skip). Same key ⇒ shared cache + deduped request.
 * - Revalidates on mount, on window focus, on `revalidateOn` SSE events (throttled by
 *   `throttleMs`, default 1500 ms) and every `refreshInterval` ms.
 * - `mutate()` refetches; `mutate(data)` sets the cache optimistically; `revalidateKey(prefix)`
 *   refetches every mounted query whose key starts with prefix (e.g. after a POST).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { StreamEventType } from "@/lib/types";
import { useLiveStreamSubscribe } from "./live-stream";

type Key = unknown;

interface Entry<T = unknown> {
  data?: T;
  error?: unknown;
  loading: boolean;
  promise?: Promise<void>;
  updatedAt: number;
  listeners: Set<() => void>;
  fetcher?: () => Promise<T>;
  /** snapshot object handed to useSyncExternalStore (replaced on every change) */
  snap: ApiState<T>;
}

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isValidating: boolean;
  updatedAt: number;
}

const cache = new Map<string, Entry>();
const EMPTY: ApiState<never> = { data: undefined, error: undefined, isLoading: false, isValidating: false, updatedAt: 0 };

function keyOf(key: Key): string | null {
  if (key == null || key === false) return null;
  return typeof key === "string" ? key : JSON.stringify(key);
}

function entry<T>(k: string): Entry<T> {
  let e = cache.get(k) as Entry<T> | undefined;
  if (!e) {
    e = { loading: false, updatedAt: 0, listeners: new Set(), snap: EMPTY as ApiState<T> };
    cache.set(k, e as Entry);
  }
  return e;
}

function publish<T>(e: Entry<T>) {
  e.snap = { data: e.data, error: e.error, isLoading: e.loading && e.data === undefined, isValidating: e.loading, updatedAt: e.updatedAt };
  e.listeners.forEach((l) => l());
}

function revalidate<T>(k: string): Promise<void> {
  const e = entry<T>(k);
  if (!e.fetcher) return Promise.resolve();
  if (e.promise) return e.promise;
  e.loading = true;
  publish(e);
  const p = e
    .fetcher()
    .then(
      (d) => {
        e.data = d;
        e.error = undefined;
        e.updatedAt = Date.now();
      },
      (err) => {
        e.error = err;
      },
    )
    .finally(() => {
      e.loading = false;
      e.promise = undefined;
      publish(e);
    });
  e.promise = p;
  return p;
}

/** Refetch every cached query whose serialized key contains `match` (string) or satisfies it (fn). */
export function revalidateKey(match: string | ((key: string) => boolean)): void {
  for (const [k, e] of cache) {
    if (!e.listeners.size) continue;
    if (typeof match === "string" ? k.includes(match) : match(k)) void revalidate(k);
  }
}

/** Drop every cached entry (e.g. after switching operator). */
export function clearApiCache(): void {
  for (const [k, e] of cache) if (!e.listeners.size) cache.delete(k);
}

export interface UseApiOptions {
  revalidateOn?: StreamEventType[];
  throttleMs?: number;
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
  keepPrevious?: boolean;
}

export interface UseApiResult<T> extends ApiState<T> {
  mutate: (data?: T) => Promise<void>;
}

export function useApi<T>(key: Key, fetcher: () => Promise<T>, opts: UseApiOptions = {}): UseApiResult<T> {
  const k = keyOf(key);
  const { revalidateOn, throttleMs = 1500, refreshInterval = 0, revalidateOnFocus = true, keepPrevious = true } = opts;
  const subscribeStream = useLiveStreamSubscribe();
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!k) return () => {};
      const e = entry<T>(k);
      e.listeners.add(cb);
      return () => e.listeners.delete(cb);
    },
    [k],
  );
  const getSnap = useCallback(() => (k ? (entry<T>(k).snap as ApiState<T>) : (EMPTY as ApiState<T>)), [k]);
  const state = useSyncExternalStore(subscribe, getSnap, getSnap);

  // register fetcher + initial load
  useEffect(() => {
    if (!k) return;
    const e = entry<T>(k);
    e.fetcher = () => fetcherRef.current();
    if (e.data === undefined || Date.now() - e.updatedAt > 2000) void revalidate<T>(k);
  }, [k]);

  // SSE-driven revalidation (throttled, trailing)
  const types = revalidateOn?.join(",") ?? "";
  useEffect(() => {
    if (!k || !types) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      last = Date.now();
      timer = null;
      void revalidate<T>(k);
    };
    const onMsg = () => {
      const wait = throttleMs - (Date.now() - last);
      if (wait <= 0) fire();
      else if (!timer) timer = setTimeout(fire, wait);
    };
    const offs = types.split(",").map((t) => subscribeStream(t as StreamEventType, onMsg));
    return () => {
      offs.forEach((o) => o());
      if (timer) clearTimeout(timer);
    };
  }, [k, types, throttleMs, subscribeStream]);

  // polling
  useEffect(() => {
    if (!k || !refreshInterval) return;
    const id = setInterval(() => void revalidate<T>(k), refreshInterval);
    return () => clearInterval(id);
  }, [k, refreshInterval]);

  // focus
  useEffect(() => {
    if (!k || !revalidateOnFocus) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void revalidate<T>(k);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [k, revalidateOnFocus]);

  const mutate = useCallback(
    async (data?: T) => {
      if (!k) return;
      const e = entry<T>(k);
      if (data !== undefined) {
        e.data = data;
        e.updatedAt = Date.now();
        publish(e);
        return;
      }
      await revalidate<T>(k);
    },
    [k],
  );

  // keep previous data visible while a new key is loading ("store info from previous renders" pattern)
  const [prev, setPrev] = useState<T | undefined>(undefined);
  if (state.data !== undefined && state.data !== prev) setPrev(state.data);
  const data = state.data !== undefined ? state.data : keepPrevious ? prev : undefined;
  return { ...state, data, mutate };
}
