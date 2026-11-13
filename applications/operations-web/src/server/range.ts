/**
 * Server-side time-range reader. Every list/aggregate endpoint calls readRange(req) and echoes
 * the resolved range in its response (`range`). Detail-by-id endpoints do not.
 */
import type { NextRequest } from "next/server";
import { MAX_LAST_HOURS, RangeParseError, overlaps, parseRangeParams, resolveRange, inRange } from "@/lib/time-range";
import type { RangedList, ResolvedRange } from "@/lib/types";
import { badRequest, type ErrorText } from "./http";
import { localeFromRequest } from "@/i18n/request";
import { getEngine } from "./mock/runtime";

export { overlaps, inRange };

/** Parse ?range= / ?from=&to= against the virtual clock. Invalid → 400 (localized). `label` is in the request locale. */
export function readRange(req: NextRequest | URLSearchParams, now = getEngine().now()): ResolvedRange {
  const sp = req instanceof URLSearchParams ? req : req.nextUrl.searchParams;
  const locale = req instanceof URLSearchParams ? "ko" : localeFromRequest(req);
  try {
    return resolveRange(parseRangeParams(sp), now, locale);
  } catch (e) {
    if (e instanceof RangeParseError) throw badRequest(rangeErrorText(e, sp), { field: e.field, allowed: ["today", "yesterday", "1h", "6h", "24h", "7d", "30d", "<N>h", "<N>d", "from=<ISO|ms>&to=<ISO|ms>"] });
    throw e;
  }
}

/** RangeParseError (its `reason` code; the message text is not parsed) → an `errors.validation.*` key. */
function rangeErrorText(e: RangeParseError, sp: URLSearchParams): ErrorText {
  const value = sp.get(e.field) ?? "";
  switch (e.reason) {
    case "order":
      return { key: "validation.rangeOrder" };
    case "timestamp":
      return { key: "validation.timestamp", vars: { name: e.field } };
    case "span":
      return { key: "validation.rangeSpan", vars: { value, max: MAX_LAST_HOURS / 24 } };
    default:
      return { key: "validation.rangeInvalid", vars: { value } };
  }
}

export function rangedList<T>(items: T[], range: ResolvedRange): RangedList<T> {
  return { items, total: items.length, range };
}
