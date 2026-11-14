/**
 * Judge-model confound — pipeline_version releases can switch the LLM judge (domain.ts `releases[].judgeModel`),
 * so a pass-rate / judge-score delta between two pipeline versions mixes the model change with the judge change.
 * Isomorphic (catalog data only); used by the Quality versions view and the Deep Analysis regression sections.
 *
 * Usage: judgeConfound(["v1.1", "v1.2-rc"]) // [{ version: "v1.1", judge: "gemini-2.5-flash" }, { version: "v1.2-rc", judge: "gemini-2.5-pro" }]
 */
import { JUDGE_MODEL_BY_PIPELINE_VERSION, PIPELINE_RELEASES } from "./catalog";

export interface JudgeOfVersion {
  version: string;
  judge: string;
}

export const judgeOf = (pipelineVersion: string): string | null => JUDGE_MODEL_BY_PIPELINE_VERSION[pipelineVersion] ?? null;

/** the compared pipeline versions with their judge models when they do NOT all share one judge; null otherwise */
export function judgeConfound(pipelineVersions: Iterable<string>): JudgeOfVersion[] | null {
  const out: JudgeOfVersion[] = [];
  const seen = new Set<string>();
  for (const v of pipelineVersions) {
    const judge = judgeOf(v);
    if (!judge || seen.has(v)) continue;
    seen.add(v);
    out.push({ version: v, judge });
  }
  const order = (v: string) => PIPELINE_RELEASES.findIndex((r) => r.version === v);
  out.sort((a, b) => order(a.version) - order(b.version));
  return new Set(out.map((x) => x.judge)).size > 1 ? out : null;
}

/** "v1.1: gemini-2.5-flash · v1.2-rc: gemini-2.5-pro" (release order) */
export const judgeList = (xs: JudgeOfVersion[]) => xs.map((x) => `${x.version}: ${x.judge}`).join(" · ");
