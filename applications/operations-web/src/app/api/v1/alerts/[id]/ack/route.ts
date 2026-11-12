import { V, handle, idempotent, ok, readJson, requireOperatorRole, resolveOperator } from "@/server/http";
import { ackAlert } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/alerts/[id]/ack  body { note? } → Alert */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requireOperatorRole(op, "알림 확인");
    const body = await readJson(req);
    return ok(ackAlert(decodeURIComponent(id), op.id, V.str(body, "note") ?? null));
  }),
);
