"use client";
/**
 * DEPRECATED compatibility shim. The acting operator is no longer chosen on the client: identity is
 * resolved on the server from the session (see src/server/auth, docs/auth.md), and the client no
 * longer sends `x-operator` (getOperatorId() returns "", so api.request() omits the header; the server
 * ignores it anyway).
 *
 * Exports are kept so existing UI compiles:
 * - useOperator() → [the session user as an Operator, switch()] — switch() goes to /login (mock mode
 *   account picker); the id argument is ignored.
 * - getOperatorId() → "" (no header)
 * - setOperatorId() → same as switch()
 * New code should use useSession() from ./session.
 */
import { legacyRoleOf } from "@/config/schema";
import type { Operator } from "@/lib/types";
import { useSession } from "./session";

/** @deprecated identity is server-side; always "" so no x-operator header is sent. */
export function getOperatorId(): string {
  return "";
}

/** @deprecated navigates to /login to switch account (mock mode). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setOperatorId(_id?: string): void {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  // full navigation on purpose: the root layout must re-resolve the session server-side
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login?next=" + encodeURIComponent(here));
}

/** [operator, switchAccount] — the session user mapped to the legacy Operator shape. */
export function useOperator(): [Operator, (id: string) => void] {
  const s = useSession();
  const op: Operator = s.user
    ? { id: s.user.id, name: s.user.name, email: s.user.email, team: s.user.team ?? "", role: legacyRoleOf(s.permissions), lastActiveAt: 0 }
    : { id: "anonymous", name: "로그인 필요", email: "", team: "", role: "Viewer", lastActiveAt: 0 };
  return [op, setOperatorId];
}
