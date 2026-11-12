import type { AuthMode, SessionUser } from "@/config/schema";

/**
 * What an identity adapter can read from a request. Built from a NextRequest (proxy, route handlers;
 * synchronous) or from `await headers()` / `await cookies()` (server components).
 */
export interface IdentityInput {
  header(name: string): string | null;
  cookie(name: string): string | undefined;
}

/** Who the request is, before role mapping. */
export interface Identity extends SessionUser {
  source: AuthMode;
  /** roles the identity source itself asserts (mock users carry their demo role) */
  baseRoles?: readonly string[];
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Identity adapter. `identify` is synchronous on purpose: route handlers call
 * `resolveOperator(req)` synchronously. Anything that needs I/O (e.g. fetching IAP public keys to
 * verify the signed JWT) lives in `verify`, which src/proxy.ts awaits for EVERY matched request before
 * the route runs, and which `getSession()` awaits in server components.
 */
export interface IdentityAdapter {
  mode: AuthMode;
  identify(input: IdentityInput): Identity | null;
  verify?(input: IdentityInput): Promise<VerifyResult>;
}

/** Resolved session (server-side). */
export interface Session {
  mode: AuthMode;
  user: SessionUser;
  roles: string[];
  permissions: string[];
}
