import { handle, ok } from "@/server/http";
import { qualityMatrix } from "@/server/services/quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/quality/matrix?x=<QualityDim>&y=<QualityDim>&metric=pass_rate|fail_count|delta&max_x=12&max_y=12&range=&<row filters>
 *   → QualityMatrix { items (cells, y-major), total, range, previous, x, y, metric, x_values, y_values, x_totals, y_totals, domain, folded }
 *   Free-valued axes keep the top (max−1) values by FAILs and fold the rest into "__other__".
 *   Row filters: agent_function, capsule, intent, language, market, region, device, division, bixby_version, one_ui_version,
 *   model_version, pipeline, pipeline_version, failure_reason, result (comma-separated or repeated; enums validated → localized 400)
 *
 * BigQuery sketch (x = division, y = agent_function):
 *   SELECT division AS x, agent_function AS y,
 *          COUNTIF(eval_ts >= @from) AS total, COUNTIF(eval_ts >= @from AND result='FAIL') AS fail,
 *          SAFE_DIVIDE(COUNTIF(eval_ts >= @from AND result='PASS'), COUNTIF(eval_ts >= @from)) * 100 AS pass_rate,
 *          SAFE_DIVIDE(COUNTIF(eval_ts < @from AND result='PASS'), COUNTIF(eval_ts < @from)) * 100 AS prev_pass_rate
 *   FROM `bixby-eval-prod.bixby_eval.utterance_results`
 *   WHERE eval_ts >= @pfrom AND eval_ts <= @to  -- AND <row filters>
 *   GROUP BY x, y;   -- delta = pass_rate − prev_pass_rate (pp)
 */
export const GET = handle(async (req) => ok(qualityMatrix(req)));
