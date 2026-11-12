import { V, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { cancelWorkflow } from "@/server/services/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/workflows/[id]/cancel  body { reason } → WorkflowSummary   (409 if already terminal) */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requirePermission(op, "cancel");
    const body = await readJson(req);
    const reason = V.str(body, "reason", { max: 500 }) ?? "운영자 요청에 의한 취소";
    return ok(cancelWorkflow(decodeURIComponent(id), op.id, reason));
  }),
);
