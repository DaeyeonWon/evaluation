import { Query, handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { globalCapacity, patchGlobalCapacity } from "@/server/services/capacity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/capacity/global → GlobalCapacity */
export const GET = handle(() => ok(globalCapacity()));

/** PATCH /api/v1/capacity/global?dry_run=1  body { max_concurrent?, max_starts_per_minute?, reason } → GlobalCapacityChangeResult */
export const PATCH = handle(async (req) =>
  idempotent(req, async () => {
    const op = resolveOperator(req);
    requirePermission(op, "config.write");
    const body = await readJson(req);
    const dryRun = Query.of(req).bool("dry_run") ?? false;
    return ok(patchGlobalCapacity(body, op.id, dryRun));
  }),
);
