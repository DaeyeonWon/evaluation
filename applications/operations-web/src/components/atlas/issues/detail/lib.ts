/**
 * Issue detail — pure helpers: token diff (expected vs predicted), the range part of a query,
 * the /results param of a breakdown dim, and the client-side issue Markdown.
 */
import { SEVERITY_BANDS } from "@/lib/severity";
import type { IssueDetail, IssueFactorKey } from "@/lib/types";
import type { IssueFormat } from "../../issues-shared";

export const FACTOR_ORDER: IssueFactorKey[] = ["volume", "severity", "trend", "regression", "reach", "novelty"];
/** severity thresholds on the 0–100 criticality scale (shared: src/lib/severity.ts) */
export const SCORE_BANDS = SEVERITY_BANDS;

// ───────────────────────────────────────── diff ──
export type DiffPart = { text: string; op: "same" | "add" | "del" };

const tokenize = (s: string) => s.match(/\s+|[^\s\p{P}]+|\p{P}/gu) ?? [];

/** word-level LCS diff of a → b ("del" = only in a, "add" = only in b). Falls back to a whole-string swap for very long inputs. */
export function diffTokens(a: string, b: string): DiffPart[] {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 40_000) return [{ text: a, op: "del" }, { text: b, op: "add" }];
  const n = x.length;
  const m = y.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, op: DiffPart["op"]) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ text, op });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push(x[i], "same");
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) push(x[i++], "del");
    else push(y[j++], "add");
  }
  while (i < n) push(x[i++], "del");
  while (j < m) push(y[j++], "add");
  return out;
}

/** share of tokens (non-space) that differ, 0..1 */
export function diffRatio(parts: DiffPart[]) {
  let same = 0;
  let all = 0;
  for (const p of parts) {
    const w = p.text.trim() ? p.text.length : 0;
    all += w;
    if (p.op === "same") same += w;
  }
  return all ? 1 - same / all : 0;
}

// ───────────────────────────────────────── queries ──
const RANGE_KEYS = ["range", "from", "to"] as const;
/** the global time range part of an IssueQuery */
export function rangeOf(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of RANGE_KEYS) if (q[k] != null && q[k] !== "") out[k] = String(q[k]);
  return out;
}

/** detail breakdown dim → /results query param */
export const RESULTS_PARAM: Record<string, string> = {
  division: "division",
  region: "region",
  market: "market",
  device: "device",
  bixby_version: "bixby_version",
  model_version: "model_version",
  language: "language",
};

export const sevKey = (s: string) => s.toLowerCase();

// ───────────────────────────────────────── markdown ──
type MdText = {
  t: (k: string, v?: Record<string, string | number>) => string;
  fx: IssueFormat;
  dim: (d: string) => string;
  val: (d: string, v: string) => string;
  date: (ts: number) => string;
  num: (n: number) => string;
  url: string;
};

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The issue as Markdown, built from the detail response (no server round trip). */
export function issueMarkdown(d: IssueDetail, breakdowns: { dim: string; stats: IssueDetail["breakdown"]["market"] }[], x: MdText): string {
  const { t, fx } = x;
  const L: string[] = [];
  const s = d.signature;
  L.push(`# ${d.severity} · ${fx.text(d.title)}`);
  L.push("");
  L.push(`- ${t("md.id")}: \`${d.id}\` · ${t("md.link")}: ${x.url}`);
  L.push(`- ${t("md.impact")}: ${d.severity} ${fx.t.dynamic(`impactLevel.${d.severity}`, undefined, d.severity)} · ${t("md.status")}: ${fx.status(d.state.status)} · Criticality ${fx.score(d.score)}/100`);
  L.push(`- ${t("md.signature")}: ${fx.fn(s.agent_function)} · \`${s.intent_expected}\`${s.intent_predicted !== s.intent_expected ? ` → \`${s.intent_predicted}\`` : ""} · ${fx.reason(s.failure_reason)}`);
  L.push(`- ${t("md.category")}: ${fx.value("category", d.category)} — ${fx.text(d.category_reason)}`);
  L.push(`- ${t("md.userImpact")}: ${fx.value("user_impact", d.user_impact_type)} — ${fx.text(d.type_reason.user_impact)}`);
  L.push(`- ${t("md.devMiss")}: ${fx.value("dev_miss", d.dev_miss_type)} — ${fx.text(d.type_reason.dev_miss)}`);
  L.push(`- Must-handle: ${fx.t.dynamic(`mustHandleValue.${d.must_handle}`, undefined, String(d.must_handle))} — ${fx.text(d.must_handle_reason)}`);
  L.push(`- ${t("md.volume")}: FAIL ${x.num(d.count)} · ${t("md.rate")} ${fx.pct(d.fail_rate)} (Baseline ${fx.pct(d.baseline_rate)}, ${fx.pp(d.delta)}) · ${t("md.share")} ${fx.pct(d.share)}`);
  L.push(`- ${t("md.seen")}: ${x.date(d.first_seen)} ~ ${x.date(d.last_seen)}`);
  if (d.state.owner_name || d.state.ticket_id) L.push(`- ${t("md.owner")}: ${d.state.owner_name ?? "—"} · ${t("md.ticket")}: ${d.state.ticket_id ?? "—"}`);
  if (d.state.note) L.push(`- ${t("md.note")}: ${d.state.note}`);
  L.push("");
  L.push(`## ${t("md.why")}`);
  for (const r of d.reasons) L.push(`1. ${fx.text(r)}`);
  if (d.bixby_regression) {
    const b = d.bixby_regression;
    L.push("");
    L.push(`> ${t("trend.bixbyLine", { division: x.val("division", b.division), previous: b.previous, prevRate: fx.pct(b.previousRate), current: b.current, curRate: fx.pct(b.currentRate), z: b.z.toFixed(1) })}`);
  }
  L.push("");
  L.push(`## ${t("md.anatomy")}`);
  L.push(`| ${t("md.factor")} | ${t("md.weight")} | ${t("md.value")} | ${t("md.points")} |`);
  L.push("|---|---:|---:|---:|");
  for (const k of FACTOR_ORDER) {
    const f = d.factors.find((y) => y.key === k);
    if (f) L.push(`| ${fx.factor(k)} | ${f.weight} | ${(f.value * 100).toFixed(0)}% | ${f.contribution.toFixed(1)} |`);
  }
  L.push(`| **${t("md.total")}** | 100 | | **${d.score.toFixed(1)}** |`);
  for (const b of breakdowns) {
    if (!b.stats.length) continue;
    L.push("");
    L.push(`### ${x.dim(b.dim)}`);
    L.push(`| ${x.dim(b.dim)} | FAIL | ${t("md.rate")} | Δ |`);
    L.push("|---|---:|---:|---:|");
    for (const r of b.stats.slice(0, 8)) L.push(`| ${esc(x.val(b.dim, r.value))} | ${x.num(r.fails)} | ${fx.pct(r.fail_rate)} | ${fx.pp(r.delta)} |`);
  }
  if (d.patterns.length) {
    L.push("");
    L.push(`## ${t("md.patterns")}`);
    for (const p of d.patterns.slice(0, 8)) L.push(`- ${p.novel ? `**${t("patterns.new")}** ` : ""}"${esc(p.template)}" (${p.language}) · ${x.num(p.count)}`);
  }
  if (d.utterances.items.length) {
    L.push("");
    L.push(`## ${t("md.examples")}`);
    for (const u of d.utterances.items.slice(0, 5)) {
      L.push(`- "${esc(u.utterance_text)}"${u.asr_text !== u.utterance_text ? ` (ASR: "${esc(u.asr_text)}")` : ""} — \`${u.intent_expected}\` → \`${u.intent_predicted}\`, judge ${u.judge_score.toFixed(2)}: ${esc(u.judge_reason)}`);
    }
  }
  L.push("");
  return L.join("\n");
}
