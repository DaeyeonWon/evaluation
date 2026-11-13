import { V, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { OPERATIONAL_PERMISSIONS } from "@/server/auth/policy";
import { resolveAlert } from "@/server/services/misc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/alerts/[id]/resolve  body { note? } → Alert */
export const POST = handle<{ id: string }>(async (req, ctx) =>
  idempotent(req, async () => {
    const { id } = await ctx.params;
    const op = resolveOperator(req);
    requirePermission(op, OPERATIONAL_PERMISSIONS); // any operational write permission (policy.ts)
    const body = await readJson(req);
    return ok(resolveAlert(decodeURIComponent(id), op.id, V.str(body, "note") ?? null));
  }),
);
