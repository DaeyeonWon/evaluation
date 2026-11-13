/**
 * Session-expiry handling shared by every client fetch path.
 *
 * - api.request() calls redirectToLogin() on any 401 from /api/v1 (except /auth/*), so a background
 *   useApi() refetch, a polling query or an action all end up on /login?next=<current page>, whether
 *   or not the screen renders an <ErrorNote> or toast.
 * - The SSE stream can't see HTTP status; LiveStreamStore asks sessionExpired() after a failed
 *   reconnect and redirects the same way.
 *
 * Loop guard: never redirects while already on /login (or /403), and only once per page load
 * (parallel 401s don't stack navigations).
 */
const NO_REDIRECT = ["/login", "/403"];
let redirecting = false;

export function isRedirectingToLogin(): boolean {
  return redirecting;
}

/** Full navigation to /login?next=<current page>. No-op on the server, on /login and when already redirecting. */
export function redirectToLogin(): void {
  if (typeof window === "undefined" || redirecting) return;
  const { pathname, search } = window.location;
  if (NO_REDIRECT.some((p) => pathname === p || pathname.startsWith(p + "/"))) return;
  redirecting = true;
  // full navigation on purpose: drop every client cache/stream tied to the expired session
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`);
}

/** true when the server says there is no session (used by the SSE stream after a connection error). */
export async function sessionExpired(base = "/api/v1"): Promise<boolean> {
  try {
    const r = await fetch(`${base}/auth/session`, { cache: "no-store", headers: { accept: "application/json" } });
    if (!r.ok) return false;
    const s = (await r.json()) as { authenticated?: boolean };
    return s.authenticated === false;
  } catch {
    return false; // offline / server down: not an auth problem, keep reconnecting
  }
}
