/**
 * Issue Report — rule-based taxonomy (server-only, pure). docs/data-contract.md §8.10.
 *
 * Every rule reads REAL result columns only (failure_reason, intent pair, agent_function, judge_reason,
 * utterance_pattern template, device_type → division, bixby_version) plus issue-level signals the engine
 * already computes (severity class, regression factor, Bixby-version regression). No mock-only fields.
 *
 *   category        safety > policy > new_feature > locale > timeout > asr > wrong_action > slot > misroute > response_quality
 *   user_impact     safety_privacy > inappropriate_content > degraded(timeout) > wrong_action > (slot rules) > (quality rules) > task_blocked > misunderstood
 *   dev_miss        out_of_scope (must_handle = false) > guardrail_miss > regression > new_feature_gap > locale_gap > performance
 *                   > asr_robustness > slot_extraction > routing > supported_intent_failed
 *   must_handle     POLICY_VIOLATION → always (guardrail); else ≥ 50 % of the FAIL rows run on a device / Bixby version the
 *                   capability table (domain.ts `capabilities`) supports
 *
 * The same functions classify a single row (FAIL rows outside any issue, baseline rows), so breakdown / matrix
 * deltas use the same rules on both windows.
 */
import { BIXBY_VERSIONS, CAPABILITIES } from "@/lib/catalog";
import type { AgentFunction, CapabilityRule, DevMissType, FailureReason, IssueCategory, IssueText, LangCode, ResultRow, SeverityClass, UserImpactType } from "@/lib/types";
import { getEngine } from "../mock/runtime";
import { hasProductTerm, isCodeSwitch } from "./issues-text";

export const CATEGORIES: IssueCategory[] = ["safety", "policy", "new_feature", "locale", "timeout", "asr", "wrong_action", "slot", "misroute", "response_quality"];
export const USER_IMPACTS: UserImpactType[] = ["safety_privacy", "wrong_action", "task_blocked", "misunderstood", "inappropriate_content", "degraded", "minor"];
export const DEV_MISSES: DevMissType[] = [
  "guardrail_miss",
  "regression",
  "new_feature_gap",
  "locale_gap",
  "supported_intent_failed",
  "routing",
  "slot_extraction",
  "asr_robustness",
  "performance",
  "out_of_scope",
];

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

// ───────────────────────────────────────── versions ──
/** semver compare with an optional pre-release tag ("4.1.0-beta" < "4.1.0"); unknown parts compare as 0 */
export function compareVersion(a: string, b: string): number {
  const [ma, pa] = a.split("-", 2);
  const [mb, pb] = b.split("-", 2);
  const xa = ma.split(".").map((x) => Number(x) || 0);
  const xb = mb.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    const d = (xa[i] ?? 0) - (xb[i] ?? 0);
    if (d) return d;
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return pa && pb ? (pa < pb ? -1 : pa > pb ? 1 : 0) : 0;
}
/** known Bixby versions oldest → newest (domain order, then any extra value seen) */
export function bixbyOrder(extra: Iterable<string> = []): string[] {
  const s = new Set([...BIXBY_VERSIONS]);
  for (const v of extra) if (v) s.add(v);
  return [...s].sort(compareVersion);
}

// ───────────────────────────────────────── capability ──
export function capabilityOf(intent: string): CapabilityRule | null {
  for (const c of CAPABILITIES) if (intent.startsWith(c.intent)) return c;
  return null;
}
type Support = "ok" | "device" | "version";
export function supportOf(r: Pick<ResultRow, "intent_expected" | "division" | "device_type" | "bixby_version">): Support {
  const c = capabilityOf(r.intent_expected);
  if (!c) return "ok";
  if (!c.divisions.includes(r.division) && !(c.devices ?? []).includes(r.device_type)) return "device";
  if (c.minBixby && r.bixby_version && compareVersion(r.bixby_version, c.minBixby) < 0) return "version";
  return "ok";
}

// ───────────────────────────────────────── signals ──
const PATTERN_TEMPLATE = (r: ResultRow) => getEngine().results.patterns()[r.utterance_pattern]?.template ?? r.utterance_text;
/** template with slot placeholders removed — slot VALUES (artist names, …) are not code-switching */
const bare = (r: ResultRow) => PATTERN_TEMPLATE(r).replace(/\{[^}]*\}/g, " ");
const CS_JUDGE = /code[- ]?switch/i;
/** third-party service names in PRODUCT_TERMS are not "new features" */
const SERVICE_TERMS = new Set(["spotify"]);
const featureTerm = (tpl: string) => {
  const p = hasProductTerm(tpl);
  return p && !SERVICE_TERMS.has(p) ? p : null;
};
const TZ_JUDGE = /시간대|time ?zone|timezone|UTC/i;
const FEATURE_JUDGE = /기능명|feature name/i;
const PRIVACY_JUDGE = /개인정보|privacy|personal data/i;
const MISSING_SLOT = /누락|되묻|missing|re-?ask/i;
const VERBOSE = /장황|verbose/i;
const EVASIVE = /회피|evad/i;
/** expected intents that are a task (the user wanted something done), not a lookup */
const QUERY_INTENT = /\.(status|device_status|query|read|battery|current|forecast|rain_check|air_quality|eta|traffic|nearby|factoid|chitchat|unit_convert|health|finance)$/;

export interface TagInput {
  fn: AgentFunction;
  expected: string;
  predicted: string;
  /** agent_function of the predicted intent (row column agent_function_predicted) */
  fnPredicted: AgentFunction;
  reason: FailureReason;
  cls: SeverityClass;
  rows: ResultRow[];
  /** regression factor ≥ 0.15 (model_version / pipeline_version) */
  regression: { axis: string; current: string; previous: string } | null;
  /** Bixby version regression on the issue's dominant division (see issues-engine) */
  bixby: { division: string; current: string; previous: string } | null;
}

export interface Tags {
  category: IssueCategory;
  category_reason: IssueText;
  user_impact_type: UserImpactType;
  dev_miss_type: DevMissType;
  must_handle: boolean;
  must_handle_reason: IssueText;
  type_reason: { user_impact: IssueText; dev_miss: IssueText };
}

interface Shares {
  n: number;
  feature: number;
  featureTerm: string | null;
  cs: number;
  csTerm: string | null;
  tz: number;
  privacy: number;
  missing: number;
  verbose: number;
  evasive: number;
  ok: number;
  noDevice: number;
  noVersion: number;
  versions: Map<string, number>;
  divisions: Map<string, number>;
}

function shares(rows: ResultRow[], expected: string): Shares {
  const s: Shares = { n: rows.length, feature: 0, featureTerm: null, cs: 0, csTerm: null, tz: 0, privacy: 0, missing: 0, verbose: 0, evasive: 0, ok: 0, noDevice: 0, noVersion: 0, versions: new Map(), divisions: new Map() };
  const galaxy = expected.startsWith("galaxy_ai.");
  for (const r of rows) {
    const tpl = bare(r);
    const prod = featureTerm(tpl);
    if (galaxy || prod || FEATURE_JUDGE.test(r.judge_reason)) {
      s.feature++;
      if (!s.featureTerm) s.featureTerm = prod ?? (galaxy ? expected.slice("galaxy_ai.".length) : null);
    }
    const cs = isCodeSwitch(tpl, r.language as LangCode);
    if (cs || CS_JUDGE.test(r.judge_reason)) {
      s.cs++;
      if (!s.csTerm && cs) s.csTerm = cs;
    }
    if (TZ_JUDGE.test(r.judge_reason)) s.tz++;
    if (PRIVACY_JUDGE.test(r.judge_reason)) s.privacy++;
    if (MISSING_SLOT.test(r.judge_reason)) s.missing++;
    if (VERBOSE.test(r.judge_reason)) s.verbose++;
    if (EVASIVE.test(r.judge_reason)) s.evasive++;
    const sp = supportOf(r);
    if (sp === "ok") s.ok++;
    else if (sp === "device") s.noDevice++;
    else s.noVersion++;
    s.versions.set(r.bixby_version, (s.versions.get(r.bixby_version) ?? 0) + 1);
    s.divisions.set(r.division, (s.divisions.get(r.division) ?? 0) + 1);
  }
  return s;
}

const half = (k: number, n: number) => n > 0 && k / n >= 0.5;

export function classify(x: TagInput): Tags {
  const s = shares(x.rows, x.expected);
  const n = Math.max(1, s.n);
  const isTask = !QUERY_INTENT.test(x.expected) && x.fn !== "general_qa" && x.fn !== "weather";
  const t = (key: string, vars: Record<string, string | number> = {}): IssueText => ({ key, vars });
  const base = { fn: x.fn, expected: x.expected, predicted: x.predicted, reason: x.reason };

  // ── category
  let category: IssueCategory;
  let category_reason: IssueText;
  if (x.cls === "safety") [category, category_reason] = ["safety", t("categoryReason.safety", base)];
  else if (x.cls === "policy") [category, category_reason] = ["policy", t("categoryReason.policy", base)];
  else if (half(s.feature, n)) [category, category_reason] = ["new_feature", t("categoryReason.new_feature", { ...base, share: pct(s.feature, n), term: s.featureTerm ?? x.expected })];
  else if (half(s.cs + s.tz, n) && s.cs >= s.tz) [category, category_reason] = ["locale", t("categoryReason.localeCodeSwitch", { ...base, share: pct(s.cs, n), term: s.csTerm ?? "" })];
  else if (half(s.cs + s.tz, n)) [category, category_reason] = ["locale", t("categoryReason.localeTimezone", { ...base, share: pct(s.tz, n) })];
  else if (x.reason === "TIMEOUT") [category, category_reason] = ["timeout", t("categoryReason.timeout", base)];
  else if (x.reason === "ASR_ERROR") [category, category_reason] = ["asr", t("categoryReason.asr", base)];
  else if (x.cls === "wrong_action" && x.predicted !== x.expected) [category, category_reason] = ["wrong_action", t("categoryReason.wrong_action", base)];
  else if (x.reason === "SLOT_ERROR") [category, category_reason] = ["slot", t("categoryReason.slot", base)];
  else if (x.reason === "INTENT_MISMATCH") [category, category_reason] = ["misroute", t("categoryReason.misroute", { ...base, fn2: x.fnPredicted })];
  else [category, category_reason] = ["response_quality", t("categoryReason.response_quality", base)];

  // ── must_handle
  let must_handle: boolean;
  let must_handle_reason: IssueText;
  const cap = capabilityOf(x.expected);
  if (x.reason === "POLICY_VIOLATION") [must_handle, must_handle_reason] = [true, t("mustHandle.guardrail", { intent: x.expected })];
  else if (half(s.ok, n)) [must_handle, must_handle_reason] = [true, t(cap ? "mustHandle.supported" : "mustHandle.supportedEverywhere", { intent: x.expected, share: pct(s.ok, n), divisions: (cap?.divisions ?? []).join(", "), min: cap?.minBixby ?? "" })];
  else if (s.noDevice >= s.noVersion) [must_handle, must_handle_reason] = [false, t("mustHandle.unsupportedDevice", { intent: x.expected, share: pct(s.noDevice, n), divisions: [...(cap?.divisions ?? []), ...(cap?.devices ?? [])].join(", ") })];
  else [must_handle, must_handle_reason] = [false, t("mustHandle.unsupportedVersion", { intent: x.expected, share: pct(s.noVersion, n), min: cap?.minBixby ?? "" })];

  // ── user impact
  let ui: UserImpactType;
  let uiReason: IssueText;
  if (x.cls === "safety") [ui, uiReason] = ["safety_privacy", t("userImpactReason.safety", base)];
  else if (x.reason === "POLICY_VIOLATION" && (half(s.privacy, n) || x.fn === "call_message" || x.fn === "calendar")) [ui, uiReason] = ["safety_privacy", t("userImpactReason.privacy", base)];
  else if (x.cls === "policy") [ui, uiReason] = ["inappropriate_content", t("userImpactReason.policy", base)];
  else if (x.reason === "TIMEOUT") [ui, uiReason] = ["degraded", t("userImpactReason.timeout", base)];
  else if (x.reason === "SLOT_ERROR" && half(s.missing, n)) [ui, uiReason] = ["degraded", t("userImpactReason.missingSlot", { ...base, share: pct(s.missing, n) })];
  else if (x.cls === "wrong_action" || (x.reason === "SLOT_ERROR" && isTask)) [ui, uiReason] = ["wrong_action", t(x.predicted === x.expected ? "userImpactReason.wrongValue" : "userImpactReason.wrongAction", base)];
  else if (x.reason === "RESPONSE_QUALITY" && half(s.verbose, n)) [ui, uiReason] = ["minor", t("userImpactReason.verbose", { ...base, share: pct(s.verbose, n) })];
  else if (x.reason === "RESPONSE_QUALITY" && half(s.evasive, n)) [ui, uiReason] = ["task_blocked", t("userImpactReason.evasive", { ...base, share: pct(s.evasive, n) })];
  else if (isTask && x.reason !== "RESPONSE_QUALITY") [ui, uiReason] = ["task_blocked", t("userImpactReason.blocked", base)];
  else [ui, uiReason] = ["misunderstood", t("userImpactReason.misunderstood", base)];

  // ── dev miss
  let dm: DevMissType;
  let dmReason: IssueText;
  if (!must_handle) [dm, dmReason] = ["out_of_scope", t("devMissReason.out_of_scope", { intent: x.expected })];
  else if (x.reason === "POLICY_VIOLATION") [dm, dmReason] = ["guardrail_miss", t("devMissReason.guardrail_miss", base)];
  else if (x.regression) [dm, dmReason] = ["regression", t("devMissReason.regression", { ...base, axis: x.regression.axis, current: x.regression.current, previous: x.regression.previous })];
  else if (x.bixby) [dm, dmReason] = ["regression", t("devMissReason.bixbyRegression", { ...base, division: x.bixby.division, current: x.bixby.current, previous: x.bixby.previous })];
  else if (category === "new_feature") [dm, dmReason] = ["new_feature_gap", t("devMissReason.new_feature_gap", { ...base, term: s.featureTerm ?? x.expected })];
  else if (category === "locale") [dm, dmReason] = ["locale_gap", t("devMissReason.locale_gap", base)];
  else if (x.reason === "TIMEOUT") [dm, dmReason] = ["performance", t("devMissReason.performance", base)];
  else if (x.reason === "ASR_ERROR") [dm, dmReason] = ["asr_robustness", t("devMissReason.asr_robustness", base)];
  else if (x.reason === "SLOT_ERROR") [dm, dmReason] = ["slot_extraction", t("devMissReason.slot_extraction", base)];
  else if (x.reason === "INTENT_MISMATCH" && x.fnPredicted !== x.fn) [dm, dmReason] = ["routing", t("devMissReason.routing", { ...base, fn2: x.fnPredicted })];
  else [dm, dmReason] = ["supported_intent_failed", t("devMissReason.supported_intent_failed", base)];

  return { category, category_reason, user_impact_type: ui, dev_miss_type: dm, must_handle, must_handle_reason, type_reason: { user_impact: uiReason, dev_miss: dmReason } };
}

/** Row-level tags (FAIL rows outside an issue, baseline rows). PASS rows have no tags. */
export interface RowTags {
  category: IssueCategory;
  user_impact: UserImpactType;
  dev_miss: DevMissType;
  must_handle: "true" | "false";
  severity_class: SeverityClass;
}
