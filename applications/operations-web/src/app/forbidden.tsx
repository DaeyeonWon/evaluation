import Link from "next/link";
import { getSession } from "@/server/auth";
import { AuthFrame } from "./login/_ui/frame";

/**
 * Global 403 UI — rendered (with HTTP 403) whenever a server component calls `forbidden()`
 * (experimental.authInterrupts), e.g. /hermes without `hermes:access`, and for /403.
 */
export default async function Forbidden() {
  const session = await getSession();
  return (
    <AuthFrame sheetNo="ERR-403">
      <span className="auth-code">403 · FORBIDDEN</span>
      <h1 id="auth-title" className="auth-title">이 페이지에 접근할 권한이 없습니다</h1>
      <p className="auth-lead">권한이 필요하면 콘솔 관리자에게 역할 추가를 요청하세요. 요청 시 아래 계정 정보를 함께 전달하면 됩니다.</p>
      {session ? (
        <dl className="auth-dl">
          <dt>계정</dt>
          <dd>
            {session.user.name} <span className="mono muted">{session.user.email}</span>
          </dd>
          <dt>역할</dt>
          <dd className="mono">{session.roles.join(", ") || "—"}</dd>
        </dl>
      ) : null}
      <div className="auth-foot">
        <Link className="btn primary" href="/">
          콘솔로 돌아가기
        </Link>
        <Link className="btn" href="/login">
          다른 계정으로 로그인
        </Link>
      </div>
    </AuthFrame>
  );
}
