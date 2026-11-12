import { handle, ok } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/operators → { operators: Operator[]; rolePermissions: RolePermission[] } */
export const GET = handle(() => {
  const e = getEngine();
  return ok({ operators: e.operators, rolePermissions: e.config.rolePermissions });
});
