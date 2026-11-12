import { V, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { closeOne } from "@/server/services/dlq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/dead-letters/[id]/close  body { resolution } (or { reason }) → DeadLetter */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requirePermission(op, "replay.request");
    const body = await readJson(req);
    const resolution = V.str(body, "resolution", { max: 500 }) ?? V.str(body, "reason", { max: 500, required: true, label: "종료 사유(resolution)" })!;
    return ok(closeOne(decodeURIComponent(id), op.id, resolution));
  }),
);
