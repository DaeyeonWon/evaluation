import { handle, ok } from "@/server/http";
import { qualityVersions } from "@/server/services/quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/quality/versions?dim=model_version|bixby_version|pipeline_version&by=division|region|agent_function&range=&<row filters>
 *   → QualityVersions { items (per version), total, range, previous, dim, by, versions, groups (by × version), trend }
 *   A plain delta table: each version vs the version before it (same window) and vs the previous equal window, plus its
 *   failure_reason mix. NO significance testing / regression detection — that is module M2 (baseline-anomaly).
 *   Row filters: agent_function, capsule, intent, language, market, region, device, division, bixby_version, one_ui_version,
 *   model_version, pipeline, pipeline_version, failure_reason, result (comma-separated or repeated; enums validated → localized 400)
 *
 * BigQuery sketch (dim = model_version, by = division):
 *   WITH v AS (
 *     SELECT model_version AS ver, division AS grp,
 *            COUNT(*) AS total, COUNTIF(result='FAIL') AS fail,
 *            SAFE_DIVIDE(COUNTIF(result='PASS'), COUNT(*)) * 100 AS pass_rate
 *     FROM `bixby-eval-prod.bixby_eval.utterance_results`
 *     WHERE eval_ts BETWEEN @from AND @to  -- AND <row filters>
 *     GROUP BY ROLLUP(grp, ver)
 *   )
 *   SELECT *, pass_rate - LAG(pass_rate) OVER (PARTITION BY grp ORDER BY ver_order) AS vs_prev_version_pp FROM v;
 *   -- failure mix: SELECT model_version, failure_reason, COUNT(*) … WHERE result='FAIL' GROUP BY 1, 2
 */
export const GET = handle(async (req) => ok(qualityVersions(req)));
