"use client";
/**
 * URL-synced state (search params) — keeps filters shareable and survives back/forward.
 *
 *   const [q, setQ] = useQueryState("q");                                   // string | null
 *   const [langs, setLangs] = useQueryState("language", parseAsList);       // string[]
 *   const [page, setPage] = useQueryState("page", parseAsInt.withDefault(1));
 *   const [filters, setFilters] = useQueryStates({ status: parseAsList, sort: parseAsString.withDefault("created_desc") });
 *
 * Setting a value equal to its default (or null / [] / "") removes the param. Updates use
 * router.replace (no history entry) unless { history: "push" }; scroll is preserved.
 *
 * NOTE: uses useSearchParams() → wrap the component in <Suspense> (Next requires it for pages that
 * are statically prerendered) — see FOUNDATION.md "Gotchas".
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { RangeSpec, ResolvedRange } from "@/lib/time-range";
import { DEFAULT_RANGE, applyRangeToSearchParams, parseRange, rangeKey, resolveRange, serializeRange } from "@/lib/time-range";
import { useSimNow } from "./live-stream";

export interface Parser<T> {
  parse(raw: string | null): T;
  serialize(v: T): string | null;
  defaultValue: T;
  withDefault(d: T): Parser<T>;
}

function make<T>(parse: (raw: string) => T, serialize: (v: T) => string | null, defaultValue: T): Parser<T> {
  const p: Parser<T> = {
    parse: (raw) => (raw == null || raw === "" ? defaultValue : parse(raw)),
    serialize,
    defaultValue,
    withDefault: (d) => make(parse, serialize, d),
  };
  return p;
}

export const parseAsString = make<string | null>(
  (r) => r,
  (v) => (v == null || v === "" ? null : v),
  null,
) as Parser<string | null> & { withDefault(d: string): Parser<string> };
export const parseAsInt = make<number | null>(
  (r) => (Number.isFinite(parseInt(r, 10)) ? parseInt(r, 10) : null),
  (v) => (v == null ? null : String(v)),
  null,
) as Parser<number | null> & { withDefault(d: number): Parser<number> };
export const parseAsBool = make<boolean>(
  (r) => r === "1" || r === "true",
  (v) => (v ? "1" : null),
  false,
);
/** comma-separated list */
export const parseAsList = make<string[]>(
  (r) => r.split(",").map((s) => s.trim()).filter(Boolean),
  (v) => (v.length ? v.join(",") : null),
  [],
);

type History = { history?: "replace" | "push" };

function useWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return useCallback(
    (entries: [string, string | null][], opts?: History) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of entries) {
        if (v == null) next.delete(k);
        else next.set(k, v);
      }
      const s = next.toString();
      const url = pathname + (s ? "?" + s : "") + (typeof window !== "undefined" ? window.location.hash : "");
      if (opts?.history === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [router, pathname, sp],
  );
}

export function useQueryState<T = string | null>(
  key: string,
  parser: Parser<T> = parseAsString as unknown as Parser<T>,
): [T, (v: T | ((prev: T) => T), opts?: History) => void] {
  const sp = useSearchParams();
  const raw = sp.get(key);
  const value = useMemo(() => parser.parse(raw), [raw, parser]);
  const write = useWriter();
  const set = useCallback(
    (v: T | ((prev: T) => T), opts?: History) => {
      const nv = typeof v === "function" ? (v as (p: T) => T)(value) : v;
      const s = parser.serialize(nv);
      const d = parser.serialize(parser.defaultValue);
      write([[key, s === d ? null : s]], opts);
    },
    [key, parser, value, write],
  );
  return [value, set];
}

export function useQueryStates<P extends Record<string, Parser<unknown>>>(
  parsers: P,
): [{ [K in keyof P]: P[K]["defaultValue"] }, (patch: Partial<{ [K in keyof P]: P[K]["defaultValue"] }>, opts?: History) => void] {
  const sp = useSearchParams();
  const spStr = sp.toString();
  const values = useMemo(() => {
    const cur = new URLSearchParams(spStr);
    return Object.fromEntries(Object.entries(parsers).map(([k, p]) => [k, p.parse(cur.get(k))])) as {
      [K in keyof P]: P[K]["defaultValue"];
    };
  }, [spStr, parsers]);
  const write = useWriter();
  const set = useCallback(
    (patch: Partial<{ [K in keyof P]: P[K]["defaultValue"] }>, opts?: History) => {
      const entries: [string, string | null][] = Object.entries(patch).map(([k, v]) => {
        const p = parsers[k];
        const s = p.serialize(v);
        return [k, s === p.serialize(p.defaultValue) ? null : s];
      });
      write(entries, opts);
    },
    [parsers, write],
  );
  return [values, set];
}

// ───────────────────────────────────────── time range (URL: ?range= | ?from=&to=) ──

/**
 * Page-level period selector state, synced to the URL (`?range=7d` or `?from=…&to=…`; default
 * "today" is omitted from the URL).
 *
 *   const tr = useTimeRange();
 *   useApi(["results", tr.key, q], () => api.results({ ...tr.params, ...q }));
 *   <RangePicker value={tr.spec} onChange={tr.setSpec} label={tr.resolved.label} />
 *
 * - `spec`: parsed RangeSpec (invalid URL values fall back to today)
 * - `params`: query params to spread into any api.* call (server resolves against the virtual clock)
 * - `resolved`: client-side resolution against useSimNow() — for labels only; the server's
 *   `response.range` is authoritative.
 * - `key`: stable string for useApi keys ("today", "7d", "custom:…")
 */
export function useTimeRange(): {
  spec: RangeSpec;
  setSpec: (s: RangeSpec, opts?: History) => void;
  params: Record<string, string>;
  resolved: ResolvedRange;
  key: string;
  isDefault: boolean;
} {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const spStr = sp.toString();
  const spec = useMemo(() => parseRange(new URLSearchParams(spStr)), [spStr]);
  const now = useSimNow();
  const resolved = useMemo(() => resolveRange(spec, now), [spec, now]);
  const setSpec = useCallback(
    (s: RangeSpec, opts?: History) => {
      const next = applyRangeToSearchParams(new URLSearchParams(spStr), s);
      next.delete("page");
      const str = next.toString();
      const url = pathname + (str ? "?" + str : "") + (typeof window !== "undefined" ? window.location.hash : "");
      if (opts?.history === "push") router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [spStr, pathname, router],
  );
  const key = rangeKey(spec);
  const params = useMemo(() => serializeRange(spec), [spec]);
  return { spec, setSpec, params, resolved, key, isDefault: key === rangeKey(DEFAULT_RANGE) };
}
