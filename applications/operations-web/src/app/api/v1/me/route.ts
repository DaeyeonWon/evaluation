import { handle, ok, permissionsOf, requireSession, resolveOperator } from "@/server/http";
import type { MeInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/me → MeInfo + { roles, user } — the operator resolved from the server-side session
 * (401 without one). `permissions` carries both legacy catalog keys (read, cancel, config.write, …)
 * and console permissions (view, capacity:write, hermes:access, …).
 */
export const GET = handle((req) => {
  const session = requireSession(req);
  const operator = resolveOperator(req);
  return ok<MeInfo & { roles: string[]; user: typeof session.user }>({
    operator,
    permissions: permissionsOf(operator),
    roles: session.roles,
    user: session.user,
  });
});
