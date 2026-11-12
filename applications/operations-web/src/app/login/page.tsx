import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getConsoleConfig, hasPermission } from "@/config";
import { getT } from "@/i18n/server";
import { getSession, permissionsFor, rolesFor, safeNext } from "@/server/auth";
import { AuthFrame } from "./_ui/frame";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("login.title") };
}
export const dynamic = "force-dynamic";

const ROLE_ORDER = ["Admin", "Operator", "Viewer"] as const;

/**
 * /login — mock mode: pick a demo operator (signed HttpOnly cookie via POST /api/v1/auth/login; works
 * without JS). iap / oidc-header: identity comes from the proxy, so this page only explains/forwards.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);
  const cfg = getConsoleConfig();
  const session = await getSession();
  const t = await getT("auth");

  if (cfg.auth.mode !== "mock") {
    if (session) redirect(next);
    return (
      <AuthFrame sheetNo="AUTH-01" tone="warn">
        <span className="auth-code">401 · {cfg.auth.mode.toUpperCase()}</span>
        <h1 id="auth-title" className="auth-title">
          {t("proxy.title")}
        </h1>
        <p className="auth-lead">{cfg.auth.mode === "iap" ? t("proxy.leadIap") : t("proxy.leadOidc")}</p>
      </AuthFrame>
    );
  }

  const users = cfg.auth.mockUsers.map((u) => {
    const roles = rolesFor({ id: u.id, email: u.email, name: u.name, source: "mock", baseRoles: u.roles });
    const perms = permissionsFor(roles);
    return { ...u, roles, hermes: hasPermission(perms, cfg.externalLinks.hermes.requiredPermission) };
  });
  const groups = ROLE_ORDER.map((r) => [r, users.filter((u) => (u.roles[0] ?? "Viewer") === r)] as const).filter(([, list]) => list.length);
  const others = users.filter((u) => !ROLE_ORDER.includes((u.roles[0] ?? "Viewer") as (typeof ROLE_ORDER)[number]));
  const fromPath = next && next !== "/" ? next : null;

  return (
    <AuthFrame sheetNo="AUTH-01">
      <span className="auth-code">DEMO LOGIN · MOCK</span>
      <h1 id="auth-title" className="auth-title">
        {t("login.title")}
      </h1>
      <p className="auth-lead">
        {t("login.lead")}
        {session ? <> {t("login.current", { name: session.user.name, roles: session.roles.join(", ") || t("login.noRole") })}</> : null}
      </p>
      {fromPath ? <p className="auth-hint">{t("login.next", { path: fromPath })}</p> : null}
      <form method="post" action="/api/v1/auth/login">
        <input type="hidden" name="next" value={next} />
        <div style={{ display: "grid", gap: 12 }}>
          {[...groups, ...(others.length ? ([["—", others]] as const) : [])].map(([role, list]) => (
            <div key={role} style={{ display: "grid", gap: 10 }}>
              <div className="auth-group">{role}</div>
              <ul className="auth-users">
                {list.map((u) => (
                  <li key={u.id}>
                    <button className="auth-user" type="submit" name="userId" value={u.id} aria-current={session?.user.id === u.id ? "true" : undefined}>
                      <span className="n">
                        {u.name} <span className="t">· {u.team}</span>
                      </span>
                      <span className="e">{u.email}</span>
                      <span className="r">
                        {u.roles.map((r) => (
                          <span key={r} className={`auth-tag role-${r}`}>
                            {r}
                          </span>
                        ))}
                        <span className={`auth-tag ${u.hermes ? "yes" : "no"}`} title={t("login.hermesTitle")}>
                          Hermes {u.hermes ? "✓" : "✕"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </form>
      <dl className="auth-roles">
        <div>
          <dt>Admin</dt>
          <dd>{t("roles.admin")}</dd>
        </div>
        <div>
          <dt>Operator</dt>
          <dd>{t("roles.operator")}</dd>
        </div>
        <div>
          <dt>Viewer</dt>
          <dd>{t("roles.viewer")}</dd>
        </div>
      </dl>
      {session ? (
        <form method="post" action="/api/v1/auth/logout" className="auth-foot">
          <button className="btn sm" type="submit">
            {t("login.logout")}
          </button>
          <span>{t("login.logoutHint")}</span>
        </form>
      ) : null}
    </AuthFrame>
  );
}
