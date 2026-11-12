import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { getConsoleConfig } from "@/config";
import { getT } from "@/i18n/server";
import { can, getSession } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("nav");
  return { title: t("hermes.title") };
}
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

  const t = await getT("hermes");
  return (
    <div className="sheet sheet-in hermes-wrap">
      <section aria-labelledby="hermes-title" className="plate hermes">
        <header>
          <span className="mono muted hermes-dwg">EXT-01 · HERMES</span>
          <span className="chip">{t("status")}</span>
        </header>
        <div className="body hermes-body">
          <svg className="hermes-art" viewBox="0 0 120 60" aria-hidden="true">
            <rect x="1" y="1" width="46" height="58" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 14h32M8 22h24M8 30h28" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <path d="M47 30h26" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="3 3" />
            <rect x="73" y="1" width="46" height="58" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 3" />
            <text x="96" y="34" textAnchor="middle" fontSize="9" fontFamily="var(--f-mono)" fill="currentColor" opacity="0.7">
              ?
            </text>
          </svg>
          <h1 id="hermes-title">{t("title")}</h1>
          <p className="ink2">{t("lead")}</p>
          <ol className="hermes-steps">
            <li>
              {t("step1")} <code className="mono">HERMES_DASHBOARD_URL</code>
            </li>
            <li>{t("step2")}</li>
            <li>
              {t("step3")} <code className="mono">{link.requiredPermission}</code>
            </li>
          </ol>
          <div className="note">
            {t("access", { name: session.user.name, roles: session.roles.join(", ") || "—" })}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href="/">
              {t("back")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
