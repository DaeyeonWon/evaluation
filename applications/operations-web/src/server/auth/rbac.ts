/**
 * Role mapping + permission resolution (pure; config only).
 *   roles = identity.baseRoles ∪ every matching rule (console.config rules + CONSOLE_* env overrides)
 *           (∅ → auth.defaultRoles)
 *   permissions = ∪ rolePermissions[role]   (admin ⇒ every built-in permission)
 */
import { BUILTIN_PERMISSIONS, getConsoleConfig, hasPermission, type RoleRule } from "@/config";
import type { Identity, Session } from "./types";

function ruleMatches(rule: RoleRule, email: string): boolean {
  if (rule.emails?.includes(email)) return true;
  const domain = email.split("@")[1] ?? "";
  return !!rule.domains?.some((d) => domain === d || domain.endsWith("." + d));
}

export function rolesFor(identity: Identity): string[] {
  const cfg = getConsoleConfig().auth;
  const email = identity.email.toLowerCase();
  const roles = new Set<string>(identity.baseRoles ?? []);
  for (const r of cfg.resolvedRules) if (ruleMatches(r, email)) r.roles.forEach((x) => roles.add(x));
  if (!roles.size) cfg.defaultRoles.forEach((x) => roles.add(x));
  return [...roles].filter((r) => cfg.rolePermissions[r]);
}

export function permissionsFor(roles: readonly string[]): string[] {
  const map = getConsoleConfig().auth.rolePermissions;
  const out = new Set<string>();
  for (const r of roles) (map[r] ?? []).forEach((p) => out.add(p));
  if (out.has("admin")) BUILTIN_PERMISSIONS.forEach((p) => out.add(p));
  return [...out];
}

export function toSession(identity: Identity): Session {
  const roles = rolesFor(identity);
  return {
    mode: identity.source,
    user: { id: identity.id, email: identity.email, name: identity.name, ...(identity.team ? { team: identity.team } : {}) },
    roles,
    permissions: permissionsFor(roles),
  };
}

export function can(session: Session | null | undefined, permission: string): boolean {
  return !!session && hasPermission(session.permissions, permission);
}
