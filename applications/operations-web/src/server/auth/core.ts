/**
 * Request-level identity core (no `next/headers`), shared by src/proxy.ts, route handlers and
 * server components. See ./index.ts for the entry-point overview.
 */
import type { NextRequest } from "next/server";
import { getConsoleConfig, hasPermission, type AuthMode, type SessionInfo } from "@/config";
import { iapAdapter } from "./adapters/iap";
import { mockAdapter } from "./adapters/mock";
import { oidcHeaderAdapter } from "./adapters/oidc-header";
import { toSession } from "./rbac";
import type { IdentityAdapter, IdentityInput, Session, VerifyResult } from "./types";

const ADAPTERS: Record<AuthMode, IdentityAdapter> = {
  mock: mockAdapter,
  iap: iapAdapter,
  "oidc-header": oidcHeaderAdapter,
};

export function getAdapter(): IdentityAdapter {
  return ADAPTERS[getConsoleConfig().auth.mode];
}

export function inputFromRequest(req: NextRequest): IdentityInput {
  return { header: (n) => req.headers.get(n), cookie: (n) => req.cookies.get(n)?.value };
}

/** Synchronous identification (no I/O). src/proxy.ts has already run `verifyRequest` for this request. */
export function sessionFromRequest(req: NextRequest): Session | null {
  const id = getAdapter().identify(inputFromRequest(req));
  return id ? toSession(id) : null;
}

export async function verifyRequest(req: NextRequest): Promise<VerifyResult> {
  const a = getAdapter();
  return a.verify ? a.verify(inputFromRequest(req)) : { ok: true };
}

export function sessionInfo(session: Session | null): SessionInfo {
  const cfg = getConsoleConfig();
  const links: SessionInfo["links"] = {};
  for (const [k, l] of Object.entries(cfg.externalLinks)) {
    links[k] = { label: l.label, configured: !!l.url, allowed: !!session && hasPermission(session.permissions, l.requiredPermission) };
  }
  return {
    authenticated: !!session,
    mode: cfg.auth.mode,
    user: session?.user ?? null,
    roles: session?.roles ?? [],
    permissions: session?.permissions ?? [],
    branding: cfg.branding,
    links,
  };
}

/** Only same-origin absolute paths are allowed as post-login targets (no open redirect). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/login") || next.startsWith("/api/")) return fallback;
  return next;
}

export { toSession } from "./rbac";
export { signSession } from "./session-cookie";
