import { getConsoleConfig } from "@/config";
import type { IdentityAdapter } from "../types";

/**
 * oidc-header: an authenticating reverse proxy in front of the app (oauth2-proxy, Pomerium, an
 * ingress with OIDC, …) sets a header carrying the user's email.
 *
 * CAVEAT: the header is trusted as-is. The app MUST be reachable only through that proxy (private
 * network / ingress-only), and the proxy MUST strip the header from client requests. Otherwise anyone
 * can send `x-forwarded-email: admin@…`.
 */
export const oidcHeaderAdapter: IdentityAdapter = {
  mode: "oidc-header",
  identify(input) {
    const o = getConsoleConfig().auth.oidcHeader ?? { emailHeader: "x-forwarded-email" };
    let email = input.header(o.emailHeader)?.trim();
    if (!email) return null;
    if (o.stripPrefix && email.startsWith(o.stripPrefix)) email = email.slice(o.stripPrefix.length);
    email = email.toLowerCase();
    if (!email.includes("@")) return null;
    const name = (o.nameHeader && input.header(o.nameHeader)?.trim()) || email.split("@")[0];
    return { id: email, email, name, source: "oidc-header" };
  },
};
