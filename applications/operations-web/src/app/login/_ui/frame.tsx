import type { ReactNode } from "react";
import { LocaleToggle } from "@/components/shared";
import { getConsoleConfig } from "@/config";
import { getT } from "@/i18n/server";
import "@/styles/atlas.css";
import "./auth.css";

/** Atlas-styled standalone sheet used by /login, the 403 page and /hermes (server component). */
export async function AuthFrame({ children, sheetNo, tone }: { children: ReactNode; sheetNo: string; tone?: "warn" | "bad" }) {
  const { branding } = getConsoleConfig();
  const c = await getT("common");
  return (
    <div data-variant="atlas" className="atlas-root font-atlas">
      <main className="auth">
        <section className="auth-sheet sheet-in" data-tone={tone} aria-labelledby="auth-title">
          <header className="auth-head">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 24 L13 8 L20 24 M9 18h8" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="24" cy="10" r="3" fill="var(--accent)" />
              <path d="M20 24h6" stroke="var(--accent)" strokeWidth="2" />
            </svg>
            <div>
              <b>{branding.productName} Atlas</b>
              <small>
                {c("app.subtitle")} · {sheetNo}
              </small>
            </div>
            <div className="auth-tools">
              {branding.envLabel ? <span className="auth-env">{branding.envLabel}</span> : null}
              <LocaleToggle />
            </div>
          </header>
          <div className="auth-body">{children}</div>
          <footer className="auth-titleblock" aria-hidden="true">
            <span>{branding.productName}</span>
            <span>{sheetNo}</span>
            <span>KST</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
