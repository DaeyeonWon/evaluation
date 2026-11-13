import { V, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { cancelWorkflow } from "@/server/services/workflows";
import { DEFAULT_CANCEL_REASON } from "@/lib/reason";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/workflows/[id]/cancel  body { reason } → WorkflowSummary   (409 if already terminal) */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requirePermission(op, "workflow:cancel");
    const body = await readJson(req);
    // no reason given → a locale-neutral code (rendered localized by the UI, see src/lib/reason.ts)
    const reason = V.str(body, "reason", { max: 500 }) ?? DEFAULT_CANCEL_REASON;
    return ok(cancelWorkflow(decodeURIComponent(id), op.id, reason));
  }),
);
