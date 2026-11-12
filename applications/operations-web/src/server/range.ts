/**
 * Server-side time-range reader. Every list/aggregate endpoint calls readRange(req) and echoes
 * the resolved range in its response (`range`). Detail-by-id endpoints do not.
 */
import type { NextRequest } from "next/server";
import { RangeParseError, overlaps, parseRangeParams, resolveRange, inRange } from "@/lib/time-range";
import type { RangedList, ResolvedRange } from "@/lib/types";
import { badRequest } from "./http";
import { getEngine } from "./mock/runtime";

export { overlaps, inRange };

/** Parse ?range= / ?from=&to= against the virtual clock. Invalid → 400 (Korean). */
export function readRange(req: NextRequest | URLSearchParams, now = getEngine().now()): ResolvedRange {
  const sp = req instanceof URLSearchParams ? req : req.nextUrl.searchParams;
  try {
    return resolveRange(parseRangeParams(sp), now);
  } catch (e) {
    if (e instanceof RangeParseError) throw badRequest(e.message, { field: e.field, allowed: ["today", "yesterday", "1h", "6h", "24h", "7d", "30d", "<N>h", "<N>d", "from=<ISO|ms>&to=<ISO|ms>"] });
    throw e;
  }
}

export function rangedList<T>(items: T[], range: ResolvedRange): RangedList<T> {
  return { items, total: items.length, range };
}
