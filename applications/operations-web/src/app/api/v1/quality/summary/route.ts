import { handle, ok } from "@/server/http";
import { qualitySummary } from "@/server/services/quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/quality/summary?range=&<row filters> → QualitySummary (docs/data-contract.md §9)
 *   KPIs (pass rate, FAILs, Δ vs the previous equal window, avg judge_score, p50/p95 latency), pass-rate trend,
 *   by division / region, failure_reason distribution, top failing intents.
 *   Row filters: agent_function, capsule, intent, language, market, region, device, division, bixby_version, one_ui_version,
 *   model_version, pipeline, pipeline_version, failure_reason, result (comma-separated or repeated; enums validated → localized 400)
 *
 * BigQuery sketch (@from/@to = range, @pfrom = @from − (@to − @from); filters become AND-ed WHERE clauses):
 *   WITH w AS (
 *     SELECT *, IF(eval_ts >= @from, 'cur', 'prev') AS win
 *     FROM `bixby-eval-prod.bixby_eval.utterance_results`
 *     WHERE eval_ts >= @pfrom AND eval_ts <= @to  -- AND division IN UNNEST(@division) …
 *   )
 *   SELECT win, COUNT(*) AS total, COUNTIF(result = 'FAIL') AS fail,
 *          SAFE_DIVIDE(COUNTIF(result = 'PASS'), COUNT(*)) * 100 AS pass_rate,
 *          AVG(judge_score) AS avg_judge_score,
 *          APPROX_QUANTILES(latency_ms, 100)[OFFSET(50)] AS p50, APPROX_QUANTILES(latency_ms, 100)[OFFSET(95)] AS p95
 *   FROM w GROUP BY win;
 *   -- trend:    SELECT TIMESTAMP_TRUNC(eval_ts, DAY, 'Asia/Seoul') AS t, COUNT(*), COUNTIF(result='FAIL') FROM w WHERE win='cur' GROUP BY t
 *   -- by dims:  SELECT division, win, COUNT(*), COUNTIF(result='FAIL') FROM w GROUP BY division, win   (same for region, intent)
 *   -- reasons:  SELECT failure_reason, win, COUNT(*) FROM w WHERE result='FAIL' GROUP BY failure_reason, win
 */
export const GET = handle(async (req) => ok(qualitySummary(req)));
