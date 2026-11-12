/**
 * Proxy (Next 16's renamed middleware; Node.js runtime). The first, coarse gate for every page and
 * /api/v1 request — runs before routes render and before the OPERATIONS_API_URL rewrite:
 *
 *  1. adapter verification (IAP JWT when IAP_AUDIENCE is set) → 401
 *  2. no session: pages → 307 /login?next=…, API → 401 JSON
 *  3. API permission table (src/server/auth/policy.ts) → 403 JSON
 *  4. pages: session without `view` → /403; /hermes without `hermes:access` → 403 (rewritten to /403)
 *  5. forwards identity to upstream as x-console-user-* request headers (stripped from the client)
 *
 * Fine-grained checks stay in the routes (src/server/http.ts) and pages (hermes/page.tsx).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getConsoleConfig, hasPermission } from "@/config";
import { sessionFromRequest, verifyRequest } from "@/server/auth/core";
import { requiredFor } from "@/server/auth/policy";

const PUBLIC_PAGES = ["/login", "/403"];
const FORWARDED = ["x-console-user-id", "x-console-user-email", "x-console-user-roles", "x-console-user-permissions"];
/** page → permission, checked here in addition to the page itself */
const PAGE_PERMISSIONS: [prefix: string, permission: string][] = [["/hermes", "hermes:access"]];

function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
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

  if (!isApi && PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return forwardHeaders(req, null);

  if (isApi) {
    const need = requiredFor(req.method, pathname, cfg.protectReadApi ?? true);
    if (!need) return forwardHeaders(req, sessionFromRequest(req));
  }

  const verified = await verifyRequest(req);
  if (!verified.ok) {
    console.warn(`[auth] rejected ${req.method} ${pathname}: ${verified.reason}`);
    if (isApi) return apiError(401, "UNAUTHENTICATED", "인증 정보를 확인할 수 없습니다.");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const session = sessionFromRequest(req);
  if (!session) {
    if (isApi) return apiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
    if (cfg.mode !== "mock") return new NextResponse("Unauthorized — no identity header from the auth proxy.", { status: 401 });
    const login = new URL("/login", req.url);
    login.search = "";
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  if (isApi) {
    const need = requiredFor(req.method, pathname, cfg.protectReadApi ?? true) ?? [];
    if (need.length && !need.some((p) => hasPermission(session.permissions, p))) {
      return apiError(403, "FORBIDDEN", `권한이 없습니다 (${session.user.name}). 필요 권한: ${need.join(" | ")}`);
    }
    return forwardHeaders(req, session);
  }

  const pagePerm = PAGE_PERMISSIONS.find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1];
  if (!hasPermission(session.permissions, "view") || (pagePerm && !hasPermission(session.permissions, pagePerm))) {
    return NextResponse.rewrite(new URL("/403", req.url));
  }
  return forwardHeaders(req, session);
}

export const config = {
  matcher: [
    // everything except Next internals and static files
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|txt|xml)$).*)",
  ],
};
