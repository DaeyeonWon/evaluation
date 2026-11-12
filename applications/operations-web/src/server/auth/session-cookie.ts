/**
 * Signed session cookie for mock mode: `base64url(JSON payload).base64url(HMAC-SHA256)`.
 * Secret: CONSOLE_SESSION_SECRET (≥ 32 chars recommended). Without it a fixed dev secret is used and a
 * warning is logged once — anyone who knows the default could forge a cookie, so set it anywhere but
 * a laptop.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionCookiePayload = {
  /** user id (mock user id) */
  sub: string;
  /** issued at, epoch seconds */
  iat: number;
  /** expiry, epoch seconds */
  exp: number;
};

const DEV_SECRET = "aipo-dev-insecure-session-secret-change-me";
let warned = false;

function secret(): string {
  const s = process.env.CONSOLE_SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!warned) {
    warned = true;
    console.warn(
      s
        ? "[auth] CONSOLE_SESSION_SECRET is shorter than 16 chars — using the insecure dev default instead."
        : "[auth] CONSOLE_SESSION_SECRET is not set — signing mock session cookies with an insecure dev default. Set it in every shared environment.",
    );
  }
  return DEV_SECRET;
}

const b64 = (buf: Buffer) => buf.toString("base64url");
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest();

export function signSession(sub: string, maxAgeSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionCookiePayload = { sub, iat: now, exp: now + maxAgeSec };
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64(sign(body))}`;
}

export function verifySession(token: string | undefined): SessionCookiePayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  const expected = sign(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionCookiePayload;
    if (typeof p.sub !== "string" || typeof p.exp !== "number") return null;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}
