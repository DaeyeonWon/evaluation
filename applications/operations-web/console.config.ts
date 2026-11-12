/**
 * console.config.ts — the ONE file to edit when adopting this console in another project.
 *
 * SERVER-ONLY: this file reads env vars (email allowlists etc.). Never import it from a client
 * component. Server code reads it through `@/config` (src/config/index.ts); the browser gets the
 * safe subset from GET /api/v1/auth/session (branding, roles, permissions, link visibility).
 *
 * Env vars are read at server start (runtime), except OPERATIONS_API_URL which next.config.ts
 * bakes into the rewrite at build time. See .env.example and docs/auth.md.
 */
import { defineConsoleConfig, envList, type AuthMode } from "./src/config/schema";
import { OPERATORS } from "./src/lib/catalog";
// Domain model (languages, stages, pipelines, …) — owned by src/config/domain.ts.
import { domain } from "./src/config/domain";

const env = process.env;

export default defineConsoleConfig({
  branding: {
    productName: "AIPO",
    subtitle: "빅스비 실발화 평가",
    envLabel: env.CONSOLE_ENV_LABEL || (env.NODE_ENV === "production" ? "PROD" : "DEV"),
  },

  auth: {
    /** mock (demo login page) | iap (Google Cloud IAP headers) | oidc-header (trusted auth-proxy header) */
    mode: (env.CONSOLE_AUTH_MODE as AuthMode | undefined) || "mock",

    /** role → permissions. `admin` (or "*") implies every permission. */
    roles: {
      Viewer: { label: "Viewer", description: "조회·내보내기", permissions: ["view"] },
      Operator: {
        label: "Operator",
        description: "용량 조정, DLQ Replay, Workflow 취소, Hermes",
        permissions: ["view", "capacity:write", "dlq:replay", "workflow:cancel", "hermes:access"],
      },
      Admin: { label: "Admin", description: "전체 권한", permissions: "*" },
      /** granted by CONSOLE_HERMES_USERS: read-only console + Hermes link */
      HermesUser: { label: "Hermes", description: "조회 + Hermes 대시보드", permissions: ["view", "hermes:access"] },
    },

    /** user → role rules; every matching rule adds its roles */
    rules: [
      // Example: everyone in the company domain may look but not touch.
      { domains: envList(env.CONSOLE_VIEWER_DOMAINS), roles: ["Viewer"] },
      // Example of a static allowlist:
      // { emails: ["lead@example.com"], roles: ["Admin"] },
    ],

    /** comma-separated email lists in env → roles */
    envOverrides: {
      CONSOLE_ADMINS: ["Admin"],
      CONSOLE_OPERATORS: ["Operator"],
      CONSOLE_VIEWERS: ["Viewer"],
      CONSOLE_HERMES_USERS: ["HermesUser"],
    },

    /** authenticated (IAP/OIDC) but matched no rule → no roles → 403 everywhere */
    defaultRoles: [],

    protectReadApi: true,

    session: { cookieName: "aipo_session", maxAgeSec: 60 * 60 * 12 },

    /** demo users for /login in mock mode — the mock engine's operators, with their mock roles */
    mock: {
      users: OPERATORS.map((o) => ({ id: o.id, name: o.name, email: o.email, team: o.team, roles: [o.role] })),
    },

    iap: { audience: env.IAP_AUDIENCE || undefined },

    oidcHeader: {
      emailHeader: env.CONSOLE_AUTH_EMAIL_HEADER || "x-forwarded-email",
      nameHeader: env.CONSOLE_AUTH_NAME_HEADER || "x-forwarded-user",
    },
  },

  externalLinks: {
    hermes: {
      label: "Hermes",
      url: env.HERMES_DASHBOARD_URL || undefined,
      requiredPermission: "hermes:access",
      allowedRoles: ["Operator", "Admin", "HermesUser"],
    },
  },

  api: {
    mode: env.OPERATIONS_API_URL ? "proxy" : "mock",
    upstreamUrl: env.OPERATIONS_API_URL || undefined,
  },

  domain,
});
