import type { NextRequest } from "next/server";
import { sessionFromRequest, sessionInfo, verifyRequest } from "@/server/auth/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/session → SessionInfo { authenticated, mode, user, roles, permissions, branding, links }
 * Always 200 (authenticated:false when there is no valid session) so the UI can decide what to show.
 * /api/v1/auth/* is public in src/proxy.ts, so the adapter verification (IAP JWT) runs here explicitly.
 * Hiding UI based on this is cosmetic; the server checks (src/proxy.ts, src/server/http.ts) are the gate.
 */
export async function GET(req: NextRequest) {
  const verified = await verifyRequest(req);
  const session = verified.ok ? sessionFromRequest(req) : null;
  return Response.json(sessionInfo(session), { headers: { "cache-control": "no-store" } });
}
