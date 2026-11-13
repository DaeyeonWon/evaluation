/**
 * Audit helpers for entries that don't come from an engine action: auth (login/logout), Hermes access
 * attempts and permission denials (route-level requirePermission and the proxy's 403 path).
 *
 *   recordAudit({ action: "AUTH_LOGIN", actor: user.id, target: "session", req, result: "success" })
 *
 * Every entry carries `idempotency_key`, `user_agent` and `result` (see AuditEntry). Engine actions
 * triggered by a route handler get the same request metadata automatically: src/server/http.ts
 * handle() installs requestAuditMeta() as the engine's audit-meta provider.
 *
 * Audited actions added here:
 *   AUTH_LOGIN · AUTH_LOGOUT                          (result success)
 *   HERMES_ACCESS                                     (success = allowed · denied = no hermes:access)
 *   PERMISSION_DENIED  target "<METHOD> <path>"       (result denied; after = { required })
 */
import type { AuditEntry, AuditResult, Role } from "@/lib/types";
import { getRuntime } from "../mock/runtime";

type Meta = Partial<Pick<AuditEntry, "idempotency_key" | "user_agent" | "source_ip">>;

/** Idempotency-Key, User-Agent and client IP of a request (headers only; works in the proxy too). */
export function requestAuditMeta(req: { headers: Headers }): Meta {
  const h = req.headers;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  return {
    idempotency_key: h.get("idempotency-key") || null,
    user_agent: h.get("user-agent") || null,
    ...(ip ? { source_ip: ip } : {}),
  };
}

export interface AuditInput {
  action: string;
  actor: string;
  /** display name / role when the actor isn't a known engine operator (IAP / OIDC users) */
  actorName?: string;
  role?: Role | "System";
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: AuditResult;
  /** request whose headers provide idempotency_key / user_agent / source_ip */
  req?: { headers: Headers };
}

/** Push one audit entry (also broadcast on the SSE `audit` channel). Never throws. */
export function recordAudit(o: AuditInput): AuditEntry | null {
  try {
    const e = getRuntime().engine;
    const a = e._internal.audit(e.now(), o.actor, o.action, o.target, o.before ?? null, o.after ?? null, o.reason ?? null);
    if (!e._internal.OP[o.actor]) {
      if (o.actorName) a.actorName = o.actorName;
      if (o.role) a.role = o.role;
    }
    a.result = o.result ?? "success";
    if (o.req) Object.assign(a, Object.fromEntries(Object.entries(requestAuditMeta(o.req)).filter(([, v]) => v != null)));
    return e._internal.pushAudit(a);
  } catch (err) {
    console.error("[audit] failed to record", o.action, err);
    return null;
  }
}
