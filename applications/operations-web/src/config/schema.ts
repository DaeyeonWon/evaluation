/**
 * Console config schema — the typed shape of `console.config.ts` (app root).
 *
 * Isomorphic and dependency-free: it holds only types, constants and `defineConsoleConfig()`, so
 * client code may import the permission constants from here. The *values* in `console.config.ts`
 * (email allowlists, env overrides) are server-only. Load them through `@/config` (src/config/index.ts),
 * and expose only what the browser needs through GET /api/v1/auth/session.
 */

// ───────────────────────────────────────── permissions ──
/** Built-in permissions. Projects may add their own (any string) in `auth.roles`. */
export const BUILTIN_PERMISSIONS = [
  "view",
  "capacity:write",
  "config:write",
  "dlq:replay",
  "workflow:cancel",
  "sim:control",
  "hermes:access",
  "admin",
] as const;
export type BuiltinPermission = (typeof BUILTIN_PERMISSIONS)[number];
/** A permission key. Built-ins autocomplete; custom strings are allowed. */
export type Permission = BuiltinPermission | (string & {});

/** Korean labels for UI (role tables, 403 messages). */
export const PERMISSION_LABELS: Record<BuiltinPermission, string> = {
  view: "대시보드·로그 조회",
  "capacity:write": "언어별/전역 용량 변경",
  "config:write": "런타임 설정·버전 변경",
  "dlq:replay": "DLQ Replay·종결·배정",
  "workflow:cancel": "Workflow 취소",
  "sim:control": "시뮬레이터 제어",
  "hermes:access": "Hermes 대시보드 접근",
  admin: "관리자(전체 권한)",
};

/**
 * Legacy catalog permission keys (ROLE_PERMISSIONS in src/lib/catalog.ts, still used by existing route
 * handlers and the UI's PermNote) → console permission. `requirePermission(op, key)` and `can(key)`
 * accept both spellings, so route handlers can migrate at their own pace.
 */
export const LEGACY_PERMISSION_ALIASES: Record<string, Permission> = {
  read: "view",
  export: "view",
  cancel: "workflow:cancel",
  "replay.request": "dlq:replay",
  "replay.approve": "dlq:replay",
  "language.pause": "capacity:write",
  "config.write": "config:write",
  "version.promote": "config:write",
  iam: "admin",
};

/** Normalize a legacy key to its console permission (identity for console keys). */
export function canonicalPermission(key: string): Permission {
  return LEGACY_PERMISSION_ALIASES[key] ?? key;
}

/** Permission check over a resolved permission list. `admin` implies everything. */
export function hasPermission(permissions: readonly string[], key: string): boolean {
  if (permissions.includes("admin")) return true;
  return permissions.includes(canonicalPermission(key));
}

// ───────────────────────────────────────── config shape ──
export type AuthMode = "mock" | "iap" | "oidc-header";
export type ApiMode = "mock" | "proxy";

/** A role grants permissions. `"*"` grants every built-in permission (plus `admin`). */
export type RoleDefinition = {
  label?: string;
  description?: string;
  permissions: readonly Permission[] | "*";
};

/** Assign roles to users by exact email or by email domain. Every matching rule contributes roles. */
export type RoleRule = {
  /** exact emails (case-insensitive) */
  emails?: readonly string[];
  /** email domains, e.g. "samsung.com" (matches user@samsung.com and user@sub.samsung.com) */
  domains?: readonly string[];
  roles: readonly string[];
};

export type MockUser = {
  id: string;
  name: string;
  email: string;
  team?: string;
  /** base roles of this demo user (rules/env overrides still add on top) */
  roles: readonly string[];
};

export type AuthConfig = {
  mode: AuthMode;
  /** role name → permissions */
  roles: Record<string, RoleDefinition>;
  /** user → role rules (email allowlists, domain rules) */
  rules?: readonly RoleRule[];
  /**
   * Env-var overrides: env var name → roles granted to the comma-separated emails in that var.
   * e.g. { CONSOLE_ADMINS: ["Admin"] } + CONSOLE_ADMINS="a@x.com,b@x.com".
   */
  envOverrides?: Record<string, readonly string[]>;
  /** roles for an authenticated user no rule matched; [] = authenticated but no access */
  defaultRoles?: readonly string[];
  /** require a session for GET /api/v1/** too (recommended: true) */
  protectReadApi?: boolean;
  session?: {
    cookieName?: string;
    /** session lifetime in seconds (mock mode) */
    maxAgeSec?: number;
  };
  mock?: {
    /** demo users offered on /login */
    users: readonly MockUser[];
  };
  iap?: {
    /** `/projects/<PROJECT_NUMBER>/global/backendServices/<SERVICE_ID>` or `/projects/<N>/apps/<PROJECT_ID>` */
    audience?: string;
  };
  oidcHeader?: {
    /** header carrying the authenticated email (set by the auth proxy, e.g. oauth2-proxy) */
    emailHeader: string;
    /** optional display-name header */
    nameHeader?: string;
    /** optional prefix to strip from the email header value */
    stripPrefix?: string;
  };
};

export type ExternalLink = {
  /** absolute URL; undefined/empty → the page shows a "not configured" placeholder */
  url?: string;
  label?: string;
  requiredPermission: Permission;
  /** roles that are additionally granted `requiredPermission` (merged into the role map) */
  allowedRoles?: readonly string[];
};

export type ConsoleConfig<D = unknown> = {
  branding: {
    productName: string;
    subtitle: string;
    /** e.g. "DEV" / "STG" / "PROD" — shown as a badge */
    envLabel?: string;
  };
  auth: AuthConfig;
  externalLinks: {
    hermes: ExternalLink;
    [key: string]: ExternalLink;
  };
  api: {
    mode: ApiMode;
    /** OPERATIONS_API_URL — next.config.ts rewrites /api/v1/* there at build time when set */
    upstreamUrl?: string;
  };
  /** project domain model (languages, stages, …) — see src/config/domain.ts */
  domain?: D;
};

/** Identity helper giving `console.config.ts` full type-checking and autocomplete. */
export function defineConsoleConfig<D = unknown>(config: ConsoleConfig<D>): ConsoleConfig<D> {
  return config;
}

/** Parse a comma/whitespace-separated email list from an env var. */
export function envList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// ───────────────────────────────────────── session (wire format) ──
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  team?: string;
};

/** GET /api/v1/auth/session */
export type SessionInfo = {
  authenticated: boolean;
  mode: AuthMode;
  user: SessionUser | null;
  roles: string[];
  permissions: string[];
  branding: ConsoleConfig["branding"];
  /** which external links this user may open (url itself is not exposed) */
  links: Record<string, { label?: string; allowed: boolean; configured: boolean }>;
};

/** Coerce console permissions to the legacy 3-level role the mock engine, audit log and UI understand. */
export function legacyRoleOf(permissions: readonly string[]): "Admin" | "Operator" | "Viewer" {
  if (hasPermission(permissions, "admin")) return "Admin";
  if (permissions.some((p) => p !== "view" && p !== "hermes:access")) return "Operator";
  return "Viewer";
}
