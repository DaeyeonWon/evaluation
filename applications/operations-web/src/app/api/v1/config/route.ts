import { handle, idempotent, ok, readJson, requirePermission, resolveOperator } from "@/server/http";
import { getConfig, patchConfig } from "@/server/services/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/config → AppConfig (incl. terraformDefaults, runtimeConfig, drift[]) */
export const GET = handle(() => ok(getConfig()));

/** PATCH /api/v1/config  body ConfigPatch (+ reason) → ConfigUpdateResult */
export const PATCH = handle(async (req) =>
  idempotent(req, async () => {
    const op = resolveOperator(req);
    const body = await readJson(req);
    requirePermission(op, body.defaultPipelineVersion || body.versionTraffic ? "version.promote" : "config.write");
    return ok(patchConfig(body, op.id));
  }),
);
