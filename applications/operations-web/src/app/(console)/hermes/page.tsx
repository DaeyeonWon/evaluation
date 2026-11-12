import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { getConsoleConfig } from "@/config";
import { can, getSession } from "@/server/auth";

export const metadata: Metadata = { title: "Hermes" };
export const dynamic = "force-dynamic";

/**
 * /hermes — entry point to the separately hosted Hermes dashboard. Server-side only:
 *   no session            → 307 /login?next=/hermes
 *   no `hermes:access`    → forbidden() → src/app/forbidden.tsx with HTTP 403 (nothing else renders)
 *   HERMES_DASHBOARD_URL  → 307 to that URL
 *   otherwise             → "not configured" placeholder
 * src/proxy.ts enforces the same rules before this renders; this page re-checks (defense in depth).
 */
export default async function HermesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/hermes");
  const link = getConsoleConfig().externalLinks.hermes;
  if (!can(session, link.requiredPermission)) forbidden();
  if (link.url) redirect(link.url);

  return (
    <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
      <section
        aria-labelledby="hermes-title"
        style={{ width: "min(560px, 100%)", background: "var(--sheet)", border: "1px solid var(--rule)", borderRadius: "var(--r)", boxShadow: "var(--shadow)" }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--rule-2)" }}>
          <span className="mono muted" style={{ fontSize: 11, letterSpacing: "0.1em" }}>
            EXT-01 · HERMES
          </span>
          <h1 id="hermes-title" style={{ margin: "6px 0 0", fontSize: "var(--t-lg)", fontWeight: 750 }}>
            Hermes 대시보드가 아직 연결되지 않았습니다
          </h1>
        </div>
        <div style={{ padding: "16px 20px 20px", display: "grid", gap: 12 }}>
          <p className="ink2" style={{ margin: 0, fontSize: "var(--t-sm)" }}>
            Hermes는 별도 URL에서 운영됩니다. 주소가 설정되면 이 페이지는 권한 확인 후 Hermes로 바로 이동합니다.
          </p>
          <div className="note">
            서버 환경 변수 <code className="mono">HERMES_DASHBOARD_URL</code>을 설정하고 서버를 재시작하세요. 접근 권한:{" "}
            <code className="mono">{link.requiredPermission}</code>
          </div>
        </div>
      </section>
    </div>
  );
}
