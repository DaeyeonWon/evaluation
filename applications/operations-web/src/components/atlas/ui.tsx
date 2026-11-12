"use client";
/**
 * Atlas UI primitives — drawing-sheet chrome (sheet head, plates, KPI readouts), status helpers,
 * JSON pretty-printer, permission note, operator select, toasts.
 */
import clsx from "clsx";
import { KeyRound, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "@/i18n/client";
import { OPERATORS, ROLE_PERMISSIONS } from "@/lib/catalog";
import { ApiClientError, useSession } from "@/lib/client";
import type { Tone } from "@/lib/types";

/* ───────────── sheet chrome ───────────── */
export function SheetHead({ dwg, title, desc, acts }: { dwg: string; title: ReactNode; desc?: ReactNode; acts?: ReactNode }) {
  return (
    <div className="sheet-head">
      <div style={{ minWidth: 0 }}>
        <span className="dwg">{dwg}</span>
        <h1>{title}</h1>
        {desc ? <p>{desc}</p> : null}
      </div>
      {acts ? <div className="acts">{acts}</div> : null}
    </div>
  );
}

export function Plate({
  title,
  refText,
  right,
  flush,
  children,
  className,
  style,
  id,
}: {
  title?: ReactNode;
  refText?: ReactNode;
  right?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <section className={clsx("plate", flush && "flush", className)} style={style} id={id}>
      {title || refText || right ? (
        <header>
          {title ? <h2>{title}</h2> : <span />}
          {right ?? (refText ? <span className="ref">{refText}</span> : null)}
        </header>
      ) : null}
      <div className="body">{children}</div>
    </section>
  );
}

/* ───────────── reduced motion (hydration-safe) ───────────── */
const RM_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeRM(cb: () => void) {
  const m = window.matchMedia(RM_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
/**
 * `prefers-reduced-motion` that is safe to read during render: the server snapshot (and the
 * hydration pass) is always `false`, so SSR markup and the first client render match; React then
 * re-renders with the real media-query value right after hydration. Use this instead of motion's
 * `useReducedMotion`, which reads the media query during the hydration render and mismatches.
 */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(
    subscribeRM,
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  );
}

/** Sheet wrapper: page-load choreography (fade + rise) as a CSS animation, so the markup is the
 *  same on server and client; `@media (prefers-reduced-motion: reduce)` in atlas.css disables it. */
export function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("sheet", "sheet-in", className)}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  const t = useT("common");
  return (
    <div style={{ display: "grid", gap: 10, padding: 14 }} aria-busy="true" aria-label={t("state.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ width: `${90 - i * 9}%` }} />
      ))}
    </div>
  );
}

/* ───────────── auth-aware errors ───────────── */
/** Full navigation to /login?next=<current page> (session expired / missing). */
export function redirectToLogin() {
  if (typeof window === "undefined") return;
  const next = window.location.pathname + window.location.search;
  // full navigation on purpose: drop every client cache/stream tied to the expired session
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}
const isStatus = (e: unknown, s: number) => e instanceof ApiClientError && e.status === s;

/** Inline API error. 401 → redirects to /login?next=…; 403 → localized permission message. */
export function ErrorNote({ error }: { error: unknown }) {
  const t = useT("shell");
  const unauth = isStatus(error, 401);
  useEffect(() => {
    if (unauth) redirectToLogin();
  }, [unauth]);
  if (!error) return null;
  if (unauth) return <div className="note warn">{t("auth.expired")}</div>;
  if (isStatus(error, 403))
    return (
      <div className="note bad">
        <KeyRound aria-hidden /> {t("auth.forbidden")} <span className="muted">{(error as Error).message}</span>
      </div>
    );
  return <div className="note bad">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Bar({ pct, tone, height }: { pct: number; tone?: string; height?: number }) {
  return (
    <div className="bar" style={{ ["--tc" as string]: tone, height }}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%` }} />
    </div>
  );
}

export const toneCls = (t: Tone | null | undefined) => (t ? `tone-${t}` : "");

/* ───────────── JSON pretty print (colored, no innerHTML) ───────────── */
const TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g;
export function JsonView({ value, className, style }: { value: unknown; className?: string; style?: CSSProperties }) {
  const s = JSON.stringify(value, null, 2) ?? "null";
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(s.slice(last, idx));
    const [whole, str, colon, bool] = m;
    if (str) {
      out.push(
        <span key={i++} className={colon ? "j-k" : "j-s"}>
          {str}
        </span>,
      );
      if (colon) out.push(colon);
    } else if (bool) out.push(<span key={i++} className="j-b">{whole}</span>);
    else if (whole === "null") out.push(<span key={i++} className="j-z">null</span>);
    else out.push(<span key={i++} className="j-n">{whole}</span>);
    last = idx + whole.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <pre className={clsx("code", className)} style={style}>{out}</pre>;
}

/* ───────────── session + permissions ───────────── */
/**
 * Back-compat wrapper over useSession(): `op` is the signed-in user (id, name, role), `can(key)`
 * accepts console keys (`config:write`) and legacy catalog keys (`config.write`). Hiding/disabling
 * UI only — the server enforces every permission.
 */
export function usePerms() {
  const s = useSession();
  const role = s.roles.includes("Admin") ? "Admin" : s.roles.includes("Operator") ? "Operator" : s.roles.includes("Viewer") ? "Viewer" : (s.roles[0] ?? "—");
  const op = useMemo(
    () => ({ id: s.user?.id ?? "", name: s.user?.name ?? "—", email: s.user?.email ?? "", role: role as "Viewer" | "Operator" | "Admin", roles: s.roles }),
    [s.user, s.roles, role],
  );
  return { op, can: s.can };
}

const ROLE_ORDER = ["Viewer", "Operator", "Admin"] as const;

/** Permission note for an action: who may run it, and whether the signed-in user can. */
export function PermNote({ perm }: { perm: string }) {
  const t = useT("shell");
  const { op, can } = usePerms();
  const p = ROLE_PERMISSIONS.find((r) => r.key === perm);
  const ok = can(perm);
  const roles = p ? ROLE_ORDER.filter((r) => p[r]).join(" · ") : "";
  return (
    <div className={clsx("note", !ok && "bad")}>
      <KeyRound aria-hidden />
      {t("perm.need", { perm })}
      {roles ? <> {t("perm.roles", { roles })}</> : null} {t("perm.current", { name: op.name, role: op.role })}{" "}
      {ok ? t("perm.ok") : <b>{t("perm.denied")}</b>} {t("perm.audit")}
    </div>
  );
}

/** Read-only display of the account that runs actions (the session user; switching = sign out). */
export function OperatorSelect({ label }: { label?: string }) {
  const t = useT("shell");
  const { op } = usePerms();
  return (
    <div className="field">
      <span>{label ?? t("perm.actor")}</span>
      <div className="in op-ro" aria-readonly="true">
        <b>{op.name}</b> <span className="mono muted">· {op.role}</span>
        <Link href="/login" className="op-switch" prefetch={false}>
          {t("user.switch")}
        </Link>
      </div>
    </div>
  );
}

export const opName = (id: string | null | undefined) => (id ? (OPERATORS.find((o) => o.id === id)?.name ?? id) : "—");

/** sessionStorage key: the explorer's last query string, read by the detail breadcrumb. */
export const EXPLORER_RETURN_KEY = "atlas.explorer.search";

const noopSubscribe = () => () => {};
function readExplorerHref(): string {
  try {
    const q = window.sessionStorage.getItem(EXPLORER_RETURN_KEY);
    if (q && q.startsWith("?")) return "/explorer" + q;
  } catch {
    /* storage unavailable */
  }
  return "/explorer";
}
/** "/explorer" + the last explorer filters; the bare path on the server and during hydration. */
export function useExplorerHref(): string {
  return useSyncExternalStore(noopSubscribe, readExplorerHref, () => "/explorer");
}

/* ───────────── toasts ───────────── */
interface ToastItem {
  id: number;
  msg: ReactNode;
  err?: boolean;
}
const ToastCtx = createContext<{ push: (msg: ReactNode, err?: boolean) => void } | null>(null);
let tid = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const tc = useT("common");
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduced = useReducedMotionSafe();
  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (msg: ReactNode, err?: boolean) => {
      const id = ++tid;
      // at most 2 on screen (newest wins) so a burst of actions never builds a wall over the page
      setItems((x) => [...x.slice(-1), { id, msg, err }]);
      setTimeout(() => dismiss(id), err ? 6000 : 2800);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              className={clsx("toast", t.err && "err")}
              role={t.err ? "alert" : "status"}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
            >
              <span className="toast-msg">{t.msg}</span>
              <button className="toast-x" aria-label={tc("actions.dismiss")} onClick={() => dismiss(t.id)}>
                <X aria-hidden />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  const t = useT("shell");
  const push = c?.push;
  return useMemo(
    () => ({
      ok: (m: ReactNode) => push?.(m),
      err: (e: unknown) => {
        if (isStatus(e, 401)) {
          push?.(t("auth.expired"), true);
          redirectToLogin();
          return;
        }
        if (isStatus(e, 403)) {
          push?.(`${t("auth.forbidden")} ${(e as Error).message}`, true);
          return;
        }
        push?.(e instanceof ApiClientError ? `${e.message} (${e.status})` : e instanceof Error ? e.message : String(e), true);
      },
    }),
    [push, t],
  );
}

/* ───────────── misc ───────────── */
export function A({ href, children, className, title }: { href: string; children: ReactNode; className?: string; title?: string }) {
  return (
    <Link href={href} className={className} title={title}>
      {children}
    </Link>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
