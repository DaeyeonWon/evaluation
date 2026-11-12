import { NextResponse, type NextRequest } from "next/server";
import { getConsoleConfig } from "@/config";
import { safeNext, sessionInfo, signSession, toSession } from "@/server/auth/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 303 with a RELATIVE Location: behind Cloud Run / a standalone server, `req.url` may carry the
 * internal host (localhost:8080), and the cookie must land on the host the browser used.
 */
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { location: path } });

const NO_STORE = { "cache-control": "no-store" };
const err = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: NO_STORE });

/**
 * POST /api/v1/auth/login — mock mode only (404 otherwise).
 * Body: JSON `{ userId, next? }` → 200 SessionInfo, or an HTML form post (`userId`, `next`) → 303 to `next`.
 * Sets the signed HttpOnly session cookie.
 */
export async function POST(req: NextRequest) {
  const cfg = getConsoleConfig().auth;
  if (cfg.mode !== "mock") return err(404, "NOT_FOUND", "mock 로그인은 auth.mode=mock 에서만 사용할 수 있습니다.");

  const isForm = (req.headers.get("content-type") ?? "").includes("form");
  let userId: string | undefined;
  let next: string | undefined;
  try {
    if (isForm) {
      const f = await req.formData();
      userId = String(f.get("userId") ?? "");
      next = String(f.get("next") ?? "");
    } else {
      const b = (await req.json()) as { userId?: unknown; next?: unknown };
      userId = typeof b.userId === "string" ? b.userId : undefined;
      next = typeof b.next === "string" ? b.next : undefined;
    }
  } catch {
    return err(400, "INVALID_ARGUMENT", "요청 본문이 올바르지 않습니다.");
  }

  const user = cfg.mockUsers.find((u) => u.id === userId);
  if (!user) return err(400, "INVALID_ARGUMENT", `알 수 없는 사용자입니다: ${userId ?? ""}`);

  const session = toSession({ id: user.id, email: user.email, name: user.name, team: user.team, source: "mock", baseRoles: user.roles });
  const res = isForm
    ? seeOther(safeNext(next))
    : NextResponse.json(sessionInfo(session), { headers: NO_STORE });
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set({
    name: cfg.cookieName,
    value: signSession(user.id, cfg.maxAgeSec),
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: cfg.maxAgeSec,
  });
  return res;
}
