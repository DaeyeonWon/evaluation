/**
 * Server-side console config loader. Validates `console.config.ts` once and returns a normalized view:
 * - role "*" expanded to every built-in permission
 * - `externalLinks.*.allowedRoles` merged into the role map (those roles get the link's permission)
 * - env-override email lists parsed (CONSOLE_ADMINS=a@x,b@x → Admin)
 *
 * Safe for route handlers, server components and src/proxy.ts (no engine / no Node-only deps).
 * Do NOT import from client components — use GET /api/v1/auth/session / useSession() instead.
 */
import rawConfig from "../../console.config";
import { BUILTIN_PERMISSIONS, envList, type AuthMode, type ConsoleConfig, type MockUser, type RoleRule } from "./schema";

export * from "./schema";

const AUTH_MODES: AuthMode[] = ["mock", "iap", "oidc-header"];

export type ResolvedConsoleConfig = ConsoleConfig & {
  auth: ConsoleConfig["auth"] & {
    /** role → concrete permission list */
    rolePermissions: Record<string, string[]>;
    /** rules incl. env overrides, with lower-cased emails/domains */
    resolvedRules: RoleRule[];
    cookieName: string;
    maxAgeSec: number;
    defaultRoles: string[];
    mockUsers: MockUser[];
  };
};

function normalize(cfg: ConsoleConfig): ResolvedConsoleConfig {
  const mode = cfg.auth.mode;
  if (!AUTH_MODES.includes(mode)) {
    throw new Error(`[console.config] auth.mode must be one of ${AUTH_MODES.join(", ")} (got "${mode}"). Check CONSOLE_AUTH_MODE.`);
  }

  const rolePermissions: Record<string, string[]> = {};
  for (const [role, def] of Object.entries(cfg.auth.roles)) {
    rolePermissions[role] = def.permissions === "*" ? [...BUILTIN_PERMISSIONS] : [...def.permissions];
  }
  for (const [name, link] of Object.entries(cfg.externalLinks)) {
    for (const role of link.allowedRoles ?? []) {
      if (!rolePermissions[role]) {
        console.warn(`[console.config] externalLinks.${name}.allowedRoles references unknown role "${role}"`);
        continue;
      }
      if (!rolePermissions[role].includes(link.requiredPermission)) rolePermissions[role].push(link.requiredPermission);
    }
  }

  const lower = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const resolvedRules: RoleRule[] = (cfg.auth.rules ?? []).map((r) => ({ emails: lower(r.emails), domains: lower(r.domains), roles: r.roles }));
  for (const [envName, roles] of Object.entries(cfg.auth.envOverrides ?? {})) {
    const emails = envList(process.env[envName]);
    if (emails.length) resolvedRules.push({ emails, roles });
  }
  for (const r of resolvedRules) {
    for (const role of r.roles) if (!rolePermissions[role]) console.warn(`[console.config] rule references unknown role "${role}"`);
  }

  return {
    ...cfg,
    auth: {
      ...cfg.auth,
      rolePermissions,
      resolvedRules,
      cookieName: cfg.auth.session?.cookieName ?? "console_session",
      maxAgeSec: cfg.auth.session?.maxAgeSec ?? 12 * 3600,
      defaultRoles: [...(cfg.auth.defaultRoles ?? [])],
      mockUsers: [...(cfg.auth.mock?.users ?? [])],
    },
  };
}

let cached: ResolvedConsoleConfig | null = null;

/** The normalized console config (memoized per server process). */
export function getConsoleConfig(): ResolvedConsoleConfig {
  if (!cached) cached = normalize(rawConfig as ConsoleConfig);
  return cached;
}
