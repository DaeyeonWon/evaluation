import { handle, ok } from "@/server/http";
import { qualityBreakdown } from "@/server/services/quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/quality/breakdown?dim=<QualityDim>&range=&sort=fail_count|pass_rate|delta|volume|natural&limit=100&<row filters>
 *   → QualityBreakdown { items, total, range, previous, dim, totals, trend, truncated } (docs/data-contract.md §9)
 *   One item per value of `dim`: pass rate, FAILs, Δ vs the previous equal window, share of FAILs, per-bucket trend.
 *   Row filters: agent_function, capsule, intent, language, market, region, device, division, bixby_version, one_ui_version,
 *   model_version, pipeline, pipeline_version, failure_reason, result (comma-separated or repeated; enums validated → localized 400)
 *
 * BigQuery sketch (dim = division; failure_reason uses every row as the denominator):
 *   WITH w AS (
 *     SELECT division AS v, result, eval_ts, IF(eval_ts >= @from, 'cur', 'prev') AS win
 *     FROM `bixby-eval-prod.bixby_eval.utterance_results`
 *     WHERE eval_ts >= @pfrom AND eval_ts <= @to  -- AND <row filters>
 *   )
 *   SELECT v,
 *          COUNTIF(win='cur') AS total, COUNTIF(win='cur' AND result='FAIL') AS fail,
 *          SAFE_DIVIDE(COUNTIF(win='cur' AND result='PASS'), COUNTIF(win='cur')) * 100 AS pass_rate,
 *          SAFE_DIVIDE(COUNTIF(win='prev' AND result='PASS'), COUNTIF(win='prev')) * 100 AS prev_pass_rate,
 *          SAFE_DIVIDE(COUNTIF(win='cur' AND result='FAIL'), SUM(COUNTIF(win='cur' AND result='FAIL')) OVER ()) * 100 AS share
 *   FROM w GROUP BY v ORDER BY fail DESC LIMIT @limit;
 *   -- trend: … GROUP BY v, TIMESTAMP_TRUNC(eval_ts, HOUR|DAY, 'Asia/Seoul')
 */
export const GET = handle(async (req) => ok(qualityBreakdown(req)));
