/**
 * Proxy (Next 16's renamed middleware; Node.js runtime). The first, coarse gate for every page and
 * /api/v1 request — runs before routes render and before the OPERATIONS_API_URL rewrite:
 *
 *  1. adapter verification (IAP JWT when IAP_AUDIENCE is set) → 401
 *  2. no session: pages → 307 /login?next=…, API → 401 JSON
 *  3. API permission table (src/server/auth/policy.ts) → 403 JSON
 *  4. pages: session without `view` → /403; /hermes without `hermes:access` → 403 (rewritten to the
 *     server-rendered /403 page with HTTP status 403, so the theme script is in the HTML)
 *     Refusals of state-changing APIs and of /hermes are written to the audit log (result "denied").
 *  5. forwards identity to upstream as x-console-user-* request headers (stripped from the client)
 *
 * Fine-grained checks stay in the routes (src/server/http.ts) and pages (hermes/page.tsx).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getConsoleConfig, hasPermission } from "@/config";
import { sessionFromRequest, verifyRequest } from "@/server/auth/core";
import { requiredFor } from "@/server/auth/policy";
import { legacyRoleOf } from "@/config/schema";
import { recordAudit } from "@/server/services/audit";
import { tFor } from "@/i18n/request";

const PUBLIC_PAGES = ["/login", "/403"];
const FORWARDED = ["x-console-user-id", "x-console-user-email", "x-console-user-roles", "x-console-user-permissions"];
/** page → permission, checked here in addition to the page itself */
const PAGE_PERMISSIONS: [prefix: string, permission: string][] = [["/hermes", "hermes:access"]];

/** JSON error body in the request's locale (same shape as src/server/http.ts errorResponse). */
function apiError(req: NextRequest, status: number, code: string, key: string, vars?: Record<string, string>) {
  const message = tFor(req, "errors").dynamic(key, vars);
  return Response.json({ error: { code, message, key } }, { status, headers: { "cache-control": "no-store" } });
}

function forwardHeaders(req: NextRequest, s: ReturnType<typeof sessionFromRequest>) {
  const h = new Headers(req.headers);
  FORWARDED.forEach((n) => h.delete(n));
  h.delete("x-operator"); // legacy client-chosen identity: never trusted, never forwarded
  if (s) {
    h.set("x-console-user-id", encodeURIComponent(s.user.id));
    h.set("x-console-user-email", s.user.email);
    h.set("x-console-user-roles", s.roles.join(","));
    h.set("x-console-user-permissions", s.permissions.join(","));
  }
  return NextResponse.next({ request: { headers: h } });
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const cfg = getConsoleConfig().auth;

  // /403 is server-rendered (src/app/403/page.tsx) and always answers with HTTP 403
  if (pathname === "/403") return NextResponse.rewrite(new URL("/403", req.url), { status: 403 });
  if (!isApi && PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return forwardHeaders(req, null);

  if (isApi) {
    const need = requiredFor(req.method, pathname, cfg.protectReadApi ?? true);
    if (!need) return forwardHeaders(req, sessionFromRequest(req));
  }

  const verified = await verifyRequest(req);
  if (!verified.ok) {
    console.warn(`[auth] rejected ${req.method} ${pathname}: ${verified.reason}`);
    if (isApi) return apiError(req, 401, "UNAUTHENTICATED", "permission.unverified");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const session = sessionFromRequest(req);
  if (!session) {
    if (isApi) return apiError(req, 401, "UNAUTHENTICATED", "code.UNAUTHENTICATED");
    if (cfg.mode !== "mock") return new NextResponse("Unauthorized — no identity header from the auth proxy.", { status: 401 });
    const login = new URL("/login", req.url);
    login.search = "";
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  if (isApi) {
    const need = requiredFor(req.method, pathname, cfg.protectReadApi ?? true) ?? [];
    if (need.length && !need.some((p) => hasPermission(session.permissions, p))) {
      // state-changing request refused: audit it (GETs need only `view`; their 403s aren't audited)
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        recordAudit({ action: "PERMISSION_DENIED", actor: session.user.id, actorName: session.user.name, role: legacyRoleOf(session.permissions), target: `${req.method} ${pathname}`, after: { required: need.join(" | ") }, result: "denied", req });
      return apiError(req, 403, "FORBIDDEN", "permission.apiDenied", { operator: session.user.name, permission: need.join(" | ") });
    }
    return forwardHeaders(req, session);
  }

  const pagePerm = PAGE_PERMISSIONS.find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1];
  if (!hasPermission(session.permissions, "view") || (pagePerm && !hasPermission(session.permissions, pagePerm))) {
    if (pagePerm === "hermes:access" && req.method === "GET" && !req.headers.has("next-router-prefetch"))
      recordAudit({ action: "HERMES_ACCESS", actor: session.user.id, actorName: session.user.name, role: legacyRoleOf(session.permissions), target: "hermes", after: { allowed: false, required: pagePerm }, result: "denied", req });
    return NextResponse.rewrite(new URL("/403", req.url), { status: 403 });
  }
  return forwardHeaders(req, session);
}

export const config = {
  matcher: [
    // everything except Next internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|txt|xml)$).*)",
  ],
};
