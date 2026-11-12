/**
 * Time range — isomorphic (client + server). The ONE convention for every page's period selector.
 *
 * URL convention (also the API convention):
 *   ?range=today|yesterday|1h|6h|24h|7d|30d      preset (default: today → param omitted)
 *   ?range=12h | 48h | 3d …                       "last N hours/days" (N ≤ 2160h / 90d; legacy 12h/48h)
 *   ?from=<ISO|epoch ms>&to=<ISO|epoch ms>         custom (wins over `range`); `to` defaults to now
 *
 * Resolution uses the VIRTUAL clock (engine.now() / useSimNow()), never Date.now():
 *   today     = [KST midnight of now, now]
 *   yesterday = [KST midnight − 24h, KST midnight − 1 ms]
 *   Nh / Nd   = [now − N, now]
 * Bounds are inclusive (from ≤ ts ≤ to). Serialize custom bounds as ISO-8601 with `Z` (no "+09:00",
 * which needs URL-encoding).
 */
import type { EpochMs, RangePreset, RangePresetInfo, RangeSpec, ResolvedRange } from "./types";

export type { RangePreset, RangeSpec, ResolvedRange, RangePresetInfo } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;

export const RANGE_PRESETS: RangePresetInfo[] = [
  { id: "today", label: "오늘", labelEn: "Today" },
  { id: "yesterday", label: "어제", labelEn: "Yesterday" },
  { id: "1h", label: "최근 1시간", labelEn: "Last 1 hour" },
  { id: "6h", label: "최근 6시간", labelEn: "Last 6 hours" },
  { id: "24h", label: "최근 24시간", labelEn: "Last 24 hours" },
  { id: "7d", label: "최근 7일", labelEn: "Last 7 days" },
  { id: "30d", label: "최근 30일", labelEn: "Last 30 days" },
];
export const PRESET_IDS = RANGE_PRESETS.map((p) => p.id);
export const DEFAULT_RANGE: RangeSpec = { kind: "preset", preset: "today" };
/** Max span of a "last N" range. */
export const MAX_LAST_HOURS = 90 * 24;

export class RangeParseError extends Error {
  constructor(
    message: string,
    public field: "range" | "from" | "to",
  ) {
    super(message);
    this.name = "RangeParseError";
  }
}

// ───────────────────────────────────────── KST helpers ──
export function kstDayStart(ts: EpochMs): EpochMs {
  return Math.floor((ts + KST) / DAY) * DAY - KST;
}
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function kstParts(ts: EpochMs) {
  const d = new Date(ts + KST);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
export function kstDateLabel(ts: EpochMs): string {
  const p = kstParts(ts);
  return `${p.mo}월 ${p.d}일 (${DOW[p.dow]})`;
}
export function kstDateTime(ts: EpochMs): string {
  const p = kstParts(ts);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}
export function isoKst(ts: EpochMs): string {
  const p = kstParts(ts);
  const d = new Date(ts + KST);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, "0")}+09:00`;
}

// ───────────────────────────────────────── parse ──
/** Parse a time token: epoch ms digits or ISO-8601. */
export function parseTime(v: string): EpochMs | null {
  const s = v.trim();
  if (!s) return null;
  const n = /^\d+$/.test(s) ? Number(s) : Date.parse(s.replace(/ (\d\d:\d\d)$/, "T$1"));
  return Number.isFinite(n) ? n : null;
}

/** Parse "today" | "7d" | "12h" … → RangeSpec (throws RangeParseError). */
export function parseRangeToken(token: string): RangeSpec {
  const t = token.trim().toLowerCase();
  if ((PRESET_IDS as string[]).includes(t)) return { kind: "preset", preset: t as RangePreset };
  const m = /^(\d{1,4})(h|d)$/.exec(t);
  if (m) {
    const amount = Number(m[1]);
    const hours = m[2] === "d" ? amount * 24 : amount;
    if (amount < 1 || hours > MAX_LAST_HOURS) throw new RangeParseError(`range는 1h~${MAX_LAST_HOURS / 24}d 사이여야 합니다: ${token}`, "range");
    return { kind: "last", amount, unit: m[2] as "h" | "d" };
  }
  throw new RangeParseError(`range 값이 올바르지 않습니다: ${token} (today, yesterday, 1h, 6h, 24h, 7d, 30d 또는 from/to)`, "range");
}

type ParamSource = URLSearchParams | Record<string, string | string[] | null | undefined>;
function getParam(src: ParamSource, k: string): string | null {
  if (src instanceof URLSearchParams) return src.get(k);
  const v = src[k];
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Strict parse of range params (server uses this; throws RangeParseError).
 * `from`/`to` take precedence over `range`. Missing both → DEFAULT_RANGE (today).
 * When only `from` is given, `to` = now (encoded as Infinity until resolved).
 */
export function parseRangeParams(src: ParamSource): RangeSpec {
  const fromRaw = getParam(src, "from");
  const toRaw = getParam(src, "to");
  if ((fromRaw && fromRaw.trim()) || (toRaw && toRaw.trim())) {
    const from = fromRaw && fromRaw.trim() ? parseTime(fromRaw) : null;
    const to = toRaw && toRaw.trim() ? parseTime(toRaw) : null;
    if (fromRaw && fromRaw.trim() && from == null) throw new RangeParseError("from은 epoch ms 또는 ISO-8601 시각이어야 합니다.", "from");
    if (toRaw && toRaw.trim() && to == null) throw new RangeParseError("to는 epoch ms 또는 ISO-8601 시각이어야 합니다.", "to");
    const f = from ?? 0;
    const tt = to ?? Number.POSITIVE_INFINITY;
    if (f > tt) throw new RangeParseError("from이 to보다 늦을 수 없습니다.", "from");
    return { kind: "custom", from: f, to: tt };
  }
  const r = getParam(src, "range");
  if (r && r.trim()) return parseRangeToken(r);
  return DEFAULT_RANGE;
}

/** Lenient parse for the UI (invalid → default). */
export function parseRange(src: ParamSource): RangeSpec {
  try {
    return parseRangeParams(src);
  } catch {
    return DEFAULT_RANGE;
  }
}

// ───────────────────────────────────────── serialize ──
/**
 * RangeSpec → query params. Default (today) → {} so it disappears from the URL.
 * Custom → { from, to } as ISO-8601 UTC strings (open `to` is omitted).
 */
export function serializeRange(spec: RangeSpec, opts: { keepDefault?: boolean } = {}): Record<string, string> {
  if (spec.kind === "preset") return spec.preset === "today" && !opts.keepDefault ? {} : { range: spec.preset };
  if (spec.kind === "last") return { range: `${spec.amount}${spec.unit}` };
  const out: Record<string, string> = { from: new Date(spec.from).toISOString() };
  if (Number.isFinite(spec.to)) out.to = new Date(spec.to).toISOString();
  return out;
}
/** Merge into URLSearchParams, removing stale range/from/to. */
export function applyRangeToSearchParams(sp: URLSearchParams, spec: RangeSpec): URLSearchParams {
  const next = new URLSearchParams(sp.toString());
  next.delete("range");
  next.delete("from");
  next.delete("to");
  for (const [k, v] of Object.entries(serializeRange(spec))) next.set(k, v);
  return next;
}
/** Stable string key, e.g. "today", "7d", "custom:1731..-1731..". Use in useApi keys. */
export function rangeKey(spec: RangeSpec): string {
  if (spec.kind === "preset") return spec.preset;
  if (spec.kind === "last") return `${spec.amount}${spec.unit}`;
  return `custom:${spec.from}-${Number.isFinite(spec.to) ? spec.to : "now"}`;
}
export function sameRange(a: RangeSpec, b: RangeSpec): boolean {
  return rangeKey(a) === rangeKey(b);
}

// ───────────────────────────────────────── resolve ──
export function resolveRange(spec: RangeSpec, virtualNow: EpochMs): ResolvedRange {
  const now = virtualNow;
  let from: number;
  let to: number;
  let label: string;
  let preset: string;
  if (spec.kind === "preset") {
    preset = spec.preset;
    const today = kstDayStart(now);
    switch (spec.preset) {
      case "today":
        from = today;
        to = now;
        label = `오늘 · ${kstDateLabel(now)}`;
        break;
      case "yesterday":
        from = today - DAY;
        to = today - 1;
        label = `어제 · ${kstDateLabel(today - DAY)}`;
        break;
      default: {
        const info = RANGE_PRESETS.find((p) => p.id === spec.preset)!;
        const hours = spec.preset === "1h" ? 1 : spec.preset === "6h" ? 6 : spec.preset === "24h" ? 24 : spec.preset === "7d" ? 168 : 720;
        from = now - hours * HOUR;
        to = now;
        label = info.label;
      }
    }
  } else if (spec.kind === "last") {
    preset = `${spec.amount}${spec.unit}`;
    from = now - spec.amount * (spec.unit === "d" ? DAY : HOUR);
    to = now;
    label = `최근 ${spec.amount}${spec.unit === "d" ? "일" : "시간"}`;
  } else {
    preset = "custom";
    from = spec.from;
    to = Number.isFinite(spec.to) ? spec.to : now;
    label = `${kstDateTime(from)} ~ ${Number.isFinite(spec.to) ? kstDateTime(to) : "현재"}`;
  }
  return { from, to, label, preset, fromIso: isoKst(from), toIso: isoKst(to) };
}

/** Does [a, b] (b null = still open) overlap the range? */
export function overlaps(r: { from: number; to: number }, a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null) return false;
  return a <= r.to && (b == null ? Number.POSITIVE_INFINITY : b) >= r.from;
}
export function inRange(r: { from: number; to: number }, ts: number | null | undefined): boolean {
  return ts != null && ts >= r.from && ts <= r.to;
}
/** Span in ms. */
export function spanMs(r: { from: number; to: number }): number {
  return Math.max(0, r.to - r.from);
}
