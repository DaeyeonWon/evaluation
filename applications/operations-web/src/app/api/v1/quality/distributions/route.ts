import { handle, ok } from "@/server/http";
import { qualityDistributions } from "@/server/services/quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/quality/distributions?by=<QualityDim>&max_by=12&examples=3&range=&<row filters>
 *   → QualityDistributions { judge_score / latency histograms (PASS vs FAIL), failure_reason × by counts,
 *     FAILs per failure_reason per bucket, latest FAIL example rows per failure_reason (verbatim judge_reason) }
 *   judge_reason is shown per row only; nothing aggregates its text (that is M1 / M4).
 *   Row filters: agent_function, capsule, intent, language, market, region, device, division, bixby_version, one_ui_version,
 *   model_version, pipeline, pipeline_version, failure_reason, result (comma-separated or repeated; enums validated → localized 400)
 *
 * BigQuery sketch:
 *   SELECT RANGE_BUCKET(judge_score, GENERATE_ARRAY(0, 0.9, 0.1)) AS bin, result, COUNT(*)
 *   FROM `bixby-eval-prod.bixby_eval.utterance_results` WHERE eval_ts BETWEEN @from AND @to GROUP BY bin, result;
 *   SELECT RANGE_BUCKET(latency_ms, [0,250,…,3000,4000,6000,8000,10000,12000]) AS bin, result, COUNT(*) … GROUP BY bin, result;
 *   SELECT failure_reason, division, COUNT(*) … WHERE result='FAIL' GROUP BY 1, 2;
 *   SELECT failure_reason, TIMESTAMP_TRUNC(eval_ts, DAY, 'Asia/Seoul') AS t, COUNT(*) … WHERE result='FAIL' GROUP BY 1, 2;
 *   SELECT * EXCEPT(rn) FROM (SELECT utterance_id, failure_reason, judge_reason, …,
 *          ROW_NUMBER() OVER (PARTITION BY failure_reason ORDER BY eval_ts DESC) AS rn … WHERE result='FAIL') WHERE rn <= @examples;
 */
export const GET = handle(async (req) => ok(qualityDistributions(req)));
