import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getConsoleConfig, hasPermission } from "@/config";
import { getSession, permissionsFor, rolesFor, safeNext } from "@/server/auth";
import { AuthFrame } from "./_ui/frame";

export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

/**
 * /login — mock mode: pick a demo operator (signed HttpOnly cookie via POST /api/v1/auth/login; works
 * without JS). iap / oidc-header: identity comes from the proxy, so this page only explains/forwards.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : undefined);
  const cfg = getConsoleConfig();
  const session = await getSession();

  if (cfg.auth.mode !== "mock") {
    if (session) redirect(next);
    return (
      <AuthFrame sheetNo="AUTH-01">
        <span className="auth-code">401 · {cfg.auth.mode.toUpperCase()}</span>
        <h1 id="auth-title" className="auth-title">인증 정보가 없습니다</h1>
        <p className="auth-lead">
          이 콘솔은 {cfg.auth.mode === "iap" ? "Google Cloud IAP" : "조직 OIDC 인증 프록시"} 뒤에서만 동작합니다. 프록시를 거쳐 다시 접속해 주세요.
        </p>
      </AuthFrame>
    );
  }

  const users = cfg.auth.mockUsers.map((u) => {
    const roles = rolesFor({ id: u.id, email: u.email, name: u.name, source: "mock", baseRoles: u.roles });
    const perms = permissionsFor(roles);
    return { ...u, roles, hermes: hasPermission(perms, cfg.externalLinks.hermes.requiredPermission) };
  });

  return (
    <AuthFrame sheetNo="AUTH-01">
      <span className="auth-code">DEMO LOGIN · MOCK</span>
      <h1 id="auth-title" className="auth-title">운영자 계정 선택</h1>
      <p className="auth-lead">
        데모용 로그인입니다. 선택한 계정은 서버가 서명한 HttpOnly 쿠키로 유지되며, 모든 권한 검사와 감사 로그는 이 계정 기준입니다.
        {session ? (
          <>
            {" "}현재 <b>{session.user.name}</b> ({session.roles.join(", ") || "역할 없음"})로 로그인되어 있습니다.
          </>
        ) : null}
      </p>
      <form method="post" action="/api/v1/auth/login">
        <input type="hidden" name="next" value={next} />
        <ul className="auth-users">
          {users.map((u) => (
            <li key={u.id}>
              <button className="auth-user" type="submit" name="userId" value={u.id} aria-current={session?.user.id === u.id ? "true" : undefined}>
                <span className="n">
                  {u.name} <span className="muted" style={{ fontWeight: 400 }}>· {u.team}</span>
                </span>
                <span className="e">{u.email}</span>
                <span className="r">
                  {u.roles.map((r) => (
                    <span key={r} className={`auth-tag role-${r}`}>
                      {r}
                    </span>
                  ))}
                  <span className={`auth-tag ${u.hermes ? "yes" : "no"}`} title="Hermes 대시보드 접근 권한">
                    Hermes {u.hermes ? "✓" : "✕"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </form>
      {session ? (
        <form method="post" action="/api/v1/auth/logout" className="auth-foot">
          <button className="btn sm" type="submit">로그아웃</button>
          <span>세션 쿠키를 삭제합니다.</span>
        </form>
      ) : null}
    </AuthFrame>
  );
}
