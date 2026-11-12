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
