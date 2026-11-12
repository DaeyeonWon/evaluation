import { getConsoleConfig, PERMISSION_LABELS, BUILTIN_PERMISSIONS } from "@/config";
import { handle, ok, requireSession } from "@/server/http";
import { getEngine } from "@/server/mock/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/operators → {
 *   operators: Operator[]              (the engine's operator roster — assignees for DLQ etc.)
 *   rolePermissions: RolePermission[]  (legacy catalog table, kept for existing UI)
 *   roles: { name, label?, description?, permissions[] }[]   (console.config.ts role map, resolved)
 *   permissions: { key, label }[]
 * }
 * Requires a session. Who-is-who for identity comes from GET /api/v1/auth/session, not from here.
 */
export const GET = handle((req) => {
  requireSession(req);
  const e = getEngine();
  const cfg = getConsoleConfig().auth;
  return ok({
    operators: e.operators,
    rolePermissions: e.config.rolePermissions,
    roles: Object.entries(cfg.roles).map(([name, def]) => ({
      name,
      label: def.label,
      description: def.description,
      permissions: cfg.rolePermissions[name] ?? [],
    })),
    permissions: BUILTIN_PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] })),
  });
});
