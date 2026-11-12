import { getConsoleConfig } from "@/config";
import type { IdentityAdapter, IdentityInput, VerifyResult } from "../types";

/**
 * iap: Google Cloud Identity-Aware Proxy (Cloud Run behind an external HTTPS LB with IAP, or Cloud Run
 * IAP directly).
 *
 * - Identity: `x-goog-authenticated-user-email: accounts.google.com:user@example.com` (prefix stripped).
 * - Verification: when IAP_AUDIENCE is set, `x-goog-iap-jwt-assertion` (ES256 JWT signed by IAP) is
 *   verified in `verify()` — signature against Google's public JWKs, `aud`, `iss`, `exp`/`iat`, and that
 *   its `email` matches the header. src/proxy.ts awaits this for every request.
 *
 * CAVEAT (IAP_AUDIENCE unset): the email header is trusted as-is. That is only safe when the service
 * cannot be reached except through IAP (Cloud Run ingress "internal-and-cloud-load-balancing", no
 * public run.app URL). Set IAP_AUDIENCE in every real deployment.
 */
const EMAIL_HEADER = "x-goog-authenticated-user-email";
const JWT_HEADER = "x-goog-iap-jwt-assertion";
const PREFIX = "accounts.google.com:";
const JWK_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const ISSUER = "https://cloud.google.com/iap";
const SKEW_SEC = 30;

function headerEmail(input: IdentityInput): string | null {
  let v = input.header(EMAIL_HEADER)?.trim();
  if (!v) return null;
  if (v.startsWith(PREFIX)) v = v.slice(PREFIX.length);
  v = v.toLowerCase();
  return v.includes("@") ? v : null;
}

let warnedTrust = false;

export const iapAdapter: IdentityAdapter = {
  mode: "iap",
  identify(input) {
    const email = headerEmail(input);
    if (!email) return null;
    return { id: email, email, name: email.split("@")[0], source: "iap" };
  },
  async verify(input): Promise<VerifyResult> {
    const audience = getConsoleConfig().auth.iap?.audience;
    if (!audience) {
      if (!warnedTrust) {
        warnedTrust = true;
        console.warn("[auth] iap mode without IAP_AUDIENCE: trusting x-goog-authenticated-user-email without verifying the IAP JWT.");
      }
      return { ok: true };
    }
    const jwt = input.header(JWT_HEADER);
    if (!jwt) return { ok: false, reason: "missing x-goog-iap-jwt-assertion" };
    try {
      const claims = await verifyIapJwt(jwt, audience);
      const email = headerEmail(input);
      if (!email || String(claims.email ?? "").toLowerCase() !== email) return { ok: false, reason: "IAP JWT email does not match header" };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "invalid IAP JWT" };
    }
  },
};

// ───────────────────────────────────────── IAP JWT (ES256) ──
type Jwk = JsonWebKey & { kid: string };
let jwkCache: { at: number; keys: Map<string, CryptoKey> } | null = null;
const JWK_TTL = 60 * 60 * 1000;

async function iapKey(kid: string): Promise<CryptoKey> {
  if (!jwkCache || Date.now() - jwkCache.at > JWK_TTL || !jwkCache.keys.has(kid)) {
    const res = await fetch(JWK_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`failed to fetch IAP public keys (${res.status})`);
    const { keys } = (await res.json()) as { keys: Jwk[] };
    const map = new Map<string, CryptoKey>();
    for (const k of keys) {
      map.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    }
    jwkCache = { at: Date.now(), keys: map };
  }
  const key = jwkCache.keys.get(kid);
  if (!key) throw new Error(`unknown IAP key id ${kid}`);
  return key;
}

const b64urlDecode = (s: string) => Uint8Array.from(Buffer.from(s, "base64url"));

async function verifyIapJwt(jwt: string, audience: string): Promise<Record<string, unknown>> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed IAP JWT");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string; kid?: string };
  if (header.alg !== "ES256" || !header.kid) throw new Error("unexpected IAP JWT alg/kid");
  const key = await iapKey(header.kid);
  // JWS ES256 signatures are raw r||s (IEEE P1363), which is what WebCrypto expects.
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("bad IAP JWT signature");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER) throw new Error("bad IAP JWT issuer");
  if (claims.aud !== audience) throw new Error("bad IAP JWT audience");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_SEC < now) throw new Error("IAP JWT expired");
  if (typeof claims.iat !== "number" || claims.iat - SKEW_SEC > now) throw new Error("IAP JWT issued in the future");
  return claims;
}
