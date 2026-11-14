/**
 * Quality dashboard — row-dim registry and row filter (server-only).
 *
 * Every dim reads ONE result column (ResultRow); division / region / agent_function are the reference-table
 * columns the result CSV already carries (R1 device → division, R2 market → region, R3 intent → agent_function;
 * src/config/domain.ts). Nothing here imports the Issue Report engine (src/server/services/issues*.ts): the
 * quality service is plain GROUP BY / window aggregation and must stay that way.
 */
import { BIXBY_VERSIONS, DIVISIONS, FAILURE_REASON_META, LANG_CODES, MARKET_REGION, MODEL_VERSIONS, PIPELINE_VERSIONS, REGIONS } from "@/lib/catalog";
import type { AgentFunction, FailureReason, Market, QualityDim, ResultRow } from "@/lib/types";
import type { Query } from "../../http";

export const AGENT_FUNCTIONS: AgentFunction[] = [
  "device_control",
  "smartthings_routine",
  "alarm_timer",
  "call_message",
  "media_play",
  "weather",
  "navigation",
  "settings",
  "calendar",
  "general_qa",
  "camera",
  "galaxy_ai_feature",
];
export const MARKETS = Object.keys(MARKET_REGION) as Market[];
export const FAILURE_REASONS = Object.keys(FAILURE_REASON_META) as FailureReason[];

export const QUALITY_DIMS: QualityDim[] = [
  "agent_function",
  "capsule",
  "intent",
  "language",
  "market",
  "region",
  "device",
  "division",
  "bixby_version",
  "one_ui_version",
  "model_version",
  "pipeline",
  "pipeline_version",
  "failure_reason",
];

/** dim → the result column it reads (capsule: capsule_id; intent: intent_expected; device: device_type; pipeline: pipeline_id) */
export const DIM_GET: Record<QualityDim, (r: ResultRow) => string> = {
  agent_function: (r) => r.agent_function,
  capsule: (r) => r.capsule_id,
  intent: (r) => r.intent_expected,
  language: (r) => r.language,
  market: (r) => r.market,
  region: (r) => r.region,
  device: (r) => r.device_type,
  division: (r) => r.division,
  bixby_version: (r) => r.bixby_version,
  one_ui_version: (r) => r.one_ui_version,
  model_version: (r) => r.model_version,
  pipeline: (r) => r.pipeline_id,
  pipeline_version: (r) => r.pipeline_version,
  failure_reason: (r) => r.failure_reason,
};

/** semver-ish compare: numeric parts, a pre-release tag sorts before its release */
export function compareVersion(a: string, b: string): number {
  const [ma, pa] = a.replace(/^v/, "").split("-", 2);
  const [mb, pb] = b.replace(/^v/, "").split("-", 2);
  const na = ma.split(".").map(Number);
  const nb = mb.split(".").map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d;
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return pa && pb ? (pa < pb ? -1 : pa > pb ? 1 : 0) : 0;
}

/** fixed value order of enumerated dims (reference tables); others → null (ordered by volume) */
export function naturalOrder(d: QualityDim, seen: Iterable<string> = []): string[] | null {
  const withSeen = (base: readonly string[], cmp?: (a: string, b: string) => number) => {
    const s = new Set(base);
    for (const v of seen) if (v) s.add(v);
    return cmp ? [...s].sort(cmp) : [...s];
  };
  switch (d) {
    case "division":
      return [...DIVISIONS];
    case "region":
      return [...REGIONS];
    case "market":
      return MARKETS;
    case "language":
      return [...LANG_CODES];
    case "agent_function":
      return AGENT_FUNCTIONS;
    case "failure_reason":
      return FAILURE_REASONS;
    case "bixby_version":
      return withSeen(BIXBY_VERSIONS, compareVersion);
    case "pipeline_version":
      return withSeen(PIPELINE_VERSIONS, compareVersion);
    case "model_version":
      return withSeen(MODEL_VERSIONS);
    default:
      return null;
  }
}

type Pred = (r: ResultRow) => boolean;

/**
 * Row filter from the query string (comma-separated and/or repeated params). Enumerated params are validated
 * (unknown value → localized 400 `validation.enumInvalid`). Same semantics as GET /results.
 *   agent_function capsule intent language market region device division bixby_version one_ui_version
 *   model_version pipeline (= pipeline_id) pipeline_version (alias version) failure_reason result
 */
export function rowFilter(q: Query): Pred {
  const preds: Pred[] = [];
  const add = (vals: readonly string[] | undefined, get: (r: ResultRow) => string) => {
    if (!vals) return;
    const s = new Set(vals);
    preds.push((r) => s.has(get(r)));
  };
  add(q.enumList("agent_function", AGENT_FUNCTIONS), DIM_GET.agent_function);
  const caps = q.list("capsule");
  if (caps) {
    const s = new Set(caps);
    preds.push((r) => s.has(r.capsule_id) || s.has(r.capsule));
  }
  add(q.list("intent"), DIM_GET.intent);
  add(q.enumList("language", LANG_CODES), DIM_GET.language);
  add(q.enumList("market", MARKETS), DIM_GET.market);
  add(q.enumList("region", REGIONS), DIM_GET.region);
  add(q.list("device"), DIM_GET.device);
  add(q.enumList("division", DIVISIONS), DIM_GET.division);
  add(q.list("bixby_version"), DIM_GET.bixby_version);
  add(q.list("one_ui_version"), DIM_GET.one_ui_version);
  add(q.list("model_version"), DIM_GET.model_version);
  add(q.list("pipeline") ?? q.list("pipeline_id"), DIM_GET.pipeline);
  add(q.list("pipeline_version") ?? q.list("version"), DIM_GET.pipeline_version);
  add(q.enumList("failure_reason", FAILURE_REASONS), DIM_GET.failure_reason);
  const result = q.enumOne("result", ["PASS", "FAIL"] as const);
  if (result) preds.push((r) => r.result === result);
  if (!preds.length) return () => true;
  return (r) => {
    for (const p of preds) if (!p(r)) return false;
    return true;
  };
}
