import { NextResponse, type NextRequest } from "next/server";
import { getConsoleConfig } from "@/config";
import { legacyRoleOf } from "@/config/schema";
import { sessionFromRequest } from "@/server/auth/core";
import { recordAudit } from "@/server/services/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 303 with a RELATIVE Location: behind Cloud Run / a standalone server, `req.url` may carry the
 * internal host (localhost:8080), and the cookie must land on the host the browser used.
 */
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } });

/**
 * POST /api/v1/auth/logout — clears the session cookie.
 * JSON → 200 `{ ok, redirect }`; HTML form post → 303 to `redirect`.
 * In iap mode `redirect` is IAP's `/_gcp_iap/clear_login_cookie` (ends the IAP session too).
 */
export async function POST(req: NextRequest) {
  const cfg = getConsoleConfig().auth;
  const redirect = cfg.mode === "iap" ? "/_gcp_iap/clear_login_cookie" : "/login";
  const isForm = (req.headers.get("content-type") ?? "").includes("form");
  const s = sessionFromRequest(req);
  if (s) recordAudit({ action: "AUTH_LOGOUT", actor: s.user.id, actorName: s.user.name, role: legacyRoleOf(s.permissions), target: "session", after: { mode: cfg.mode }, req });
  const res = isForm
    ? seeOther(redirect)
    : NextResponse.json({ ok: true, redirect }, { headers: { "cache-control": "no-store" } });
  res.cookies.set({ name: cfg.cookieName, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
