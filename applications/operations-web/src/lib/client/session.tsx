"use client";
/**
 * Client view of the server-side session.
 *
 *   <SessionProvider initial={…}>  — mounted in the root layout with the session resolved on the server
 *                                     (no loading flash, no client fetch on first paint)
 *   const { user, roles, can, logout } = useSession();
 *
 * `can()` is for HIDING UI only. Every real decision is made on the server (src/proxy.ts,
 * src/server/http.ts, server components). Accepts console keys (`hermes:access`) and legacy catalog
 * keys (`config.write`).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { hasPermission, type SessionInfo } from "@/config/schema";

export type { SessionInfo } from "@/config/schema";

export interface SessionValue extends SessionInfo {
  status: "authenticated" | "unauthenticated";
  can(permission: string): boolean;
  /** re-fetch GET /api/v1/auth/session */
  refresh(): Promise<SessionInfo>;
  /** POST /api/v1/auth/logout, then full navigation to /login (or IAP's clear-cookie URL) */
  logout(): Promise<void>;
}

const ANON: SessionInfo = {
  authenticated: false,
  mode: "mock",
  user: null,
  roles: [],
  permissions: [],
  branding: { productName: "", subtitle: "" },
  links: {},
};

const Ctx = createContext<SessionValue | null>(null);

export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/v1/auth/session", { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`session ${res.status}`);
  return (await res.json()) as SessionInfo;
}

export async function logout(): Promise<void> {
  let target = "/login";
  try {
    const res = await fetch("/api/v1/auth/logout", { method: "POST", headers: { accept: "application/json" } });
    const body = (await res.json()) as { redirect?: string };
    if (body.redirect) target = body.redirect;
  } finally {
    window.location.assign(target);
  }
}

export function SessionProvider({ initial, children }: { initial: SessionInfo; children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo>(initial);
  const refresh = useCallback(async () => {
    const next = await fetchSession();
    setInfo(next);
    return next;
  }, []);
  const value = useMemo<SessionValue>(
    () => ({
      ...info,
      status: info.authenticated ? "authenticated" : "unauthenticated",
      can: (p: string) => info.authenticated && hasPermission(info.permissions, p),
      refresh,
      logout,
    }),
    [info, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Current session. Outside a provider it reports "unauthenticated" (never throws). */
export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (v) return v;
  return { ...ANON, status: "unauthenticated", can: () => false, refresh: fetchSession, logout };
}
