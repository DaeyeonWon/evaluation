import { getConsoleConfig } from "@/config";
import { verifySession } from "../session-cookie";
import type { IdentityAdapter } from "../types";

/** mock: demo users (console.config.ts → auth.mock.users) logged in via /login, signed HttpOnly cookie. */
export const mockAdapter: IdentityAdapter = {
  mode: "mock",
  identify(input) {
    const cfg = getConsoleConfig().auth;
    const payload = verifySession(input.cookie(cfg.cookieName));
    if (!payload) return null;
    const u = cfg.mockUsers.find((m) => m.id === payload.sub);
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name, team: u.team, source: "mock", baseRoles: u.roles };
  },
};
