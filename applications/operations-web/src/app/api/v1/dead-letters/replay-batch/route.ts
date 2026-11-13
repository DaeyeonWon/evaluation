import { V, badRequest, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { replayBatch, validateVersion } from "@/server/services/dlq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dead-letters/replay-batch  body { ids: string[], reason, pipeline_version? } → BatchReplayResult (per-id ok/error) */
export const POST = handle(async (req) =>
  idempotent(req, async () => {
    const op = resolveOperator(req);
    requirePermission(op, "dlq:replay");
    const body = await readJson(req);
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.some((x) => typeof x !== "string"))
      throw badRequest({ key: "domain.idsRequired" }, { field: "ids" });
    if (ids.length > 100) throw badRequest({ key: "domain.replayBatchLimit", vars: { max: 100 } }, { field: "ids" });
    const reason = V.reason(body);
    const version = validateVersion(V.str(body, "pipeline_version"));
    return ok(replayBatch([...new Set(ids as string[])], op.id, reason, version));
  }),
);
