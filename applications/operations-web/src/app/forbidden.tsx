import Link from "next/link";
import { getT } from "@/i18n/server";
import { getSession } from "@/server/auth";
import { AuthFrame } from "./login/_ui/frame";

/**
 * Global 403 UI — rendered (with HTTP 403) whenever a server component calls `forbidden()`
 * (experimental.authInterrupts), e.g. /hermes without `hermes:access`, and for /403.
 */
export default async function Forbidden() {
  const session = await getSession();
  const t = await getT("auth");
  return (
    <AuthFrame sheetNo="ERR-403" tone="bad">
      <span className="auth-code">403 · FORBIDDEN</span>
      <h1 id="auth-title" className="auth-title">
        {t("forbidden.title")}
      </h1>
      <p className="auth-lead">{t("forbidden.lead")}</p>
      {session ? (
        <dl className="auth-dl">
          <dt>{t("forbidden.account")}</dt>
          <dd>
            {session.user.name} <span className="mono muted">{session.user.email}</span>
          </dd>
          <dt>{t("forbidden.roles")}</dt>
          <dd className="mono">{session.roles.join(", ") || "—"}</dd>
          <dt>{t("forbidden.perms")}</dt>
          <dd className="mono" style={{ fontSize: 12 }}>
            {session.permissions.join(" · ") || "—"}
          </dd>
        </dl>
      ) : null}
      <div className="auth-foot">
        <Link className="btn primary" href="/">
          {t("forbidden.back")}
        </Link>
        <Link className="btn" href="/login" prefetch={false}>
          {t("forbidden.switch")}
        </Link>
      </div>
    </AuthFrame>
  );
}
