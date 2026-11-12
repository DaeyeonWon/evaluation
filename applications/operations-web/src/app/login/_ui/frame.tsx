import type { ReactNode } from "react";
import { getConsoleConfig } from "@/config";
import "@/styles/atlas.css";
import "./auth.css";

/** Atlas-styled standalone sheet used by /login and the 403 page (server component). */
export function AuthFrame({ children, sheetNo }: { children: ReactNode; sheetNo: string }) {
  const { branding } = getConsoleConfig();
  return (
    <div data-variant="atlas" className="atlas-root font-atlas">
      <main className="auth">
        <section className="auth-sheet" aria-labelledby="auth-title">
          <header className="auth-head">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 24 L13 8 L20 24 M9 18h8" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="24" cy="10" r="3" fill="var(--accent)" />
              <path d="M20 24h6" stroke="var(--accent)" strokeWidth="2" />
            </svg>
            <div>
              <b>{branding.productName}</b>
              <small>
                {branding.subtitle} · {sheetNo}
              </small>
            </div>
            {branding.envLabel ? <span className="auth-env">{branding.envLabel}</span> : null}
          </header>
          <div className="auth-body">{children}</div>
        </section>
      </main>
    </div>
  );
}
