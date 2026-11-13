import { V, badRequest, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { assignOne } from "@/server/services/dlq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dead-letters/[id]/assign  body { operator_id: string | null, reason? } → DeadLetter */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requirePermission(op, "dlq:replay");
    const body = await readJson(req);
    if (!("operator_id" in body)) throw badRequest({ key: "domain.operatorIdRequired" }, { field: "operator_id" });
    const assignee = body.operator_id === null ? null : V.str(body, "operator_id", { required: true })!;
    return ok(assignOne(decodeURIComponent(id), op.id, assignee, V.str(body, "reason") ?? null));
  }),
);
