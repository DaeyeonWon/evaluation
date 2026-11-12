import { handle, ok, permissionsOf, resolveOperator } from "@/server/http";
import type { MeInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/me → MeInfo (operator resolved from x-operator header) */
export const GET = handle((req) => {
  const operator = resolveOperator(req);
  return ok<MeInfo>({ operator, permissions: permissionsOf(operator) });
});
