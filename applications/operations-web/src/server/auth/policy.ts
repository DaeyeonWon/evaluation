/**
 * Coarse API authorization table enforced by src/proxy.ts BEFORE any route runs. This is what keeps
 * `api.mode = "proxy"` (OPERATIONS_API_URL → real FastAPI, where our route handlers never execute)
 * gated too. Route handlers still do their own fine-grained checks via src/server/http.ts.
 *
 * First match wins. `anyOf`: the user needs at least one of the listed permissions.
 * Unknown mutating endpoints default to `admin` (deny-by-default) — add a row when adding one.
 */
export type ApiRule = { methods: readonly string[]; path: RegExp; anyOf: readonly string[] };

const OPERATIONAL = ["capacity:write", "dlq:replay", "workflow:cancel"] as const;
const WRITE = ["POST", "PATCH", "PUT", "DELETE"] as const;

export const API_RULES: readonly ApiRule[] = [
  { methods: ["PATCH"], path: /^\/api\/v1\/languages\/[^/]+\/capacity$/, anyOf: ["capacity:write"] },
  { methods: ["PATCH"], path: /^\/api\/v1\/capacity\/global$/, anyOf: ["capacity:write"] },
  { methods: ["PATCH"], path: /^\/api\/v1\/config$/, anyOf: ["config:write"] },
  { methods: WRITE, path: /^\/api\/v1\/dead-letters(\/.*)?$/, anyOf: ["dlq:replay"] },
  { methods: ["POST"], path: /^\/api\/v1\/workflows\/[^/]+\/cancel$/, anyOf: ["workflow:cancel"] },
  { methods: ["POST"], path: /^\/api\/v1\/sim$/, anyOf: ["sim:control"] },
  { methods: ["POST"], path: /^\/api\/v1\/alerts\/[^/]+\/(ack|resolve)$/, anyOf: OPERATIONAL },
];

/** Permissions required for an API request (null = public). */
export function requiredFor(method: string, pathname: string, protectReads: boolean): readonly string[] | null {
  if (pathname.startsWith("/api/v1/auth/")) return null;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return protectReads ? ["view"] : null;
  for (const r of API_RULES) if (r.methods.includes(m) && r.path.test(pathname)) return r.anyOf;
  return ["admin"];
}

/** Any-of permission used by legacy `requireOperatorRole()` (alert ack/resolve). */
export const OPERATIONAL_PERMISSIONS = OPERATIONAL;
