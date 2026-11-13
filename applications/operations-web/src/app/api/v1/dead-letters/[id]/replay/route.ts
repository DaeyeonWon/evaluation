import { V, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { replayOne, validateVersion } from "@/server/services/dlq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dead-letters/[id]/replay  body { reason, pipeline_version?, priority? } → ReplayResult (201) */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requirePermission(op, "dlq:replay");
    const body = await readJson(req);
    const reason = V.reason(body);
    const version = validateVersion(V.str(body, "pipeline_version"));
    const priority = V.int(body, "priority", 1, 10, "priority");
    return ok(replayOne(decodeURIComponent(id), op.id, reason, version, priority), 201);
  }),
);
