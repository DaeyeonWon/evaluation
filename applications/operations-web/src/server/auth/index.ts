/**
 * Server-side identity. Entry points:
 * - `sessionFromRequest(req)` — sync, for route handlers / src/server/http.ts (NextRequest)
 * - `verifyRequest(req)`      — async adapter verification (IAP JWT), awaited by src/proxy.ts
 * - `getSession()`            — async, for server components (uses `await headers()` / `await cookies()`)
 * - `sessionInfo(session)`    — the GET /api/v1/auth/session payload
 *
 * src/proxy.ts imports ./core directly (no next/headers in the proxy bundle).
 */
import { cookies, headers } from "next/headers";
import { getAdapter } from "./core";
import { toSession } from "./rbac";
import type { IdentityInput, Session } from "./types";

export type { Identity, IdentityAdapter, IdentityInput, Session, VerifyResult } from "./types";
export { can, permissionsFor, rolesFor, toSession } from "./rbac";
export { signSession, verifySession } from "./session-cookie";
export { getAdapter, inputFromRequest, safeNext, sessionFromRequest, sessionInfo, verifyRequest } from "./core";

/** Server components / server actions: identify + verify. null = not authenticated. */
export async function getSession(): Promise<Session | null> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  const input: IdentityInput = { header: (n) => h.get(n), cookie: (n) => c.get(n)?.value };
  const a = getAdapter();
  const id = a.identify(input);
  if (!id) return null;
  if (a.verify && !(await a.verify(input)).ok) return null;
  return toSession(id);
}
