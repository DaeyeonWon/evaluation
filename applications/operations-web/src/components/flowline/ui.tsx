"use client";
/**
 * Flowline UI primitives (variant-local). Visual language = designs/a-flowline.html.
 */
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Info,
  Lock,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { api, useApi, useOperator, useSimNow, ApiClientError, downloadText } from "@/lib/client";
import { fmt } from "@/lib/format";
import { useTween } from "@/components/shared";
import type { LangCode, Tone } from "@/lib/types";

// ───────────────────────────── small atoms ──
export function Lang({ code }: { code: LangCode | null | undefined }) {
  if (!code) return null;
  return (
    <span className={`lang lc-${code}`}>
      <i aria-hidden />
      {code}
    </span>
  );
}

export function Tag({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={clsx("tag", className)} title={title}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={clsx("eyebrow", className)} style={style}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
  bodyStyle,
  id,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  id?: string;
}) {
  return (
    <section className={clsx("panel", className)} id={id}>
      {(title || right) && (
        <div className="panel-h">
          <h2 className="h2">
            {icon}
            {title}
          </h2>
          {right}
        </div>
      )}
      <div className={clsx("panel-b", bodyClassName)} style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function Empty({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="empty" style={style}>
      {children}
    </div>
  );
}

export function Skel({ h = 120, style }: { h?: number; style?: CSSProperties }) {
  return <div className="skel" style={{ height: h, ...style }} aria-hidden />;
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="err-box row" role="alert">
      <AlertTriangle size={15} style={{ color: "var(--st-failed)" }} aria-hidden />
      <span style={{ flex: 1 }}>{msg}</span>
      {retry && (
        <button className="btn sm" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function Note({ tone, icon, children, style }: { tone?: Tone | "accent"; icon?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={clsx("note", tone && `t-${tone}`)} style={style}>
      {icon ?? <Info aria-hidden />}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onClick,
  label,
  disabled,
  pending,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      className={clsx("toggle", pending && "pending")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

/** Animated number (tabular, mono). */
export function TweenNum({ value, format = (v) => fmt.number(v), decimals }: { value: number | null | undefined; format?: (v: number) => string; decimals?: number }) {
  const v = useTween(value ?? 0, { decimals });
  if (value == null || !Number.isFinite(value)) return <>-</>;
  return <>{format(v)}</>;
}

export function Rel({ ts }: { ts: number | null | undefined }) {
  const now = useSimNow();
  return <>{fmt.relative(ts, now)}</>;
}

export const dur = (ms: number | null | undefined) => (ms == null ? "-" : fmt.duration(ms, { style: "short" }));

// ───────────────────────────── JSON ──
const JSON_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g;
export function JsonView({ value, style, id }: { value: unknown; style?: CSSProperties; id?: string }) {
  const parts = useMemo(() => {
    const s = JSON.stringify(value, null, 2) ?? "null";
    const out: ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of s.matchAll(JSON_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push(s.slice(last, idx));
      const [, str, colon, b, n] = m;
      if (str) {
        if (colon) {
          out.push(
            <span key={i++} className="k">
              {str}
            </span>,
            colon,
          );
        } else
          out.push(
            <span key={i++} className="s">
              {str}
            </span>,
          );
      } else if (b) out.push(<span key={i++} className="b">{b}</span>);
      else if (n) out.push(<span key={i++} className="n">{n}</span>);
      last = idx + m[0].length;
    }
    out.push(s.slice(last));
    return out;
  }, [value]);
  return (
    <pre className="json" style={style} id={id}>
      {parts}
    </pre>
  );
}

// ───────────────────────────── pager ──
export function Pager({ page, pages, total, from, to, onPage, unit = "건", extra }: { page: number; pages: number; total: number; from: number; to: number; onPage: (p: number) => void; unit?: string; extra?: ReactNode }) {
  return (
    <div className="pager">
      <span className="row">
        <span>
          <span className="mono">{fmt.number(total)}</span>
          {unit} 중 <span className="mono">{total ? `${from}–${to}` : 0}</span>
        </span>
        {extra}
      </span>
      <span className="row">
        <button className="btn sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft aria-hidden />
          이전
        </button>
        <span className="mono">
          {page}/{pages}
        </span>
        <button className="btn sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>
          다음
          <ChevronRight aria-hidden />
        </button>
      </span>
    </div>
  );
}

// ───────────────────────────── toasts ──
interface ToastItem {
  id: number;
  tone: Tone | "accent";
  msg: ReactNode;
}
const ToastCtx = createContext<(msg: ReactNode, tone?: Tone | "accent") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((msg: ReactNode, tone: Tone | "accent" = "accent") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-4), { id, tone, msg }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast t-${t.tone}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              {t.tone === "failed" ? <AlertTriangle aria-hidden /> : t.tone === "success" ? <Check aria-hidden /> : <Info aria-hidden />}
              <div style={{ minWidth: 0 }}>{t.msg}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Turns an API failure into a toast (Korean server message). */
export function useApiErrorToast() {
  const toast = useToast();
  return useCallback(
    (e: unknown) => {
      const m = e instanceof ApiClientError ? `${e.message}${e.status === 403 ? " (권한 부족 · 상단 운영자 선택에서 전환)" : ""}` : e instanceof Error ? e.message : String(e);
      toast(m, e instanceof ApiClientError && e.status === 409 ? "retry" : "failed");
    },
    [toast],
  );
}

// ───────────────────────────── clipboard ──
export function useCopy() {
  const toast = useToast();
  return useCallback(
    (text: string, fallback?: HTMLElement | null) => {
      const fb = () => {
        if (fallback) {
          fallback.focus();
          if (fallback instanceof HTMLTextAreaElement) fallback.select();
          else {
            const r = document.createRange();
            r.selectNodeContents(fallback);
            const s = getSelection();
            s?.removeAllRanges();
            s?.addRange(r);
          }
        }
        toast("복사가 차단되었습니다. 선택된 텍스트를 ⌘/Ctrl+C로 복사하세요", "retry");
      };
      try {
        const p = navigator.clipboard?.writeText(text);
        if (p) p.then(() => toast("클립보드에 복사했습니다", "success"), fb);
        else fb();
      } catch {
        fb();
      }
    },
    [toast],
  );
}

// ───────────────────────────── permissions ──
export function usePerm() {
  const [op] = useOperator();
  const { data } = useApi(["me", op.id], () => api.me());
  const can = useCallback((key: string) => !!data?.permissions?.[key], [data]);
  return { op, can, ready: !!data };
}

export function PermNote({ perm, label }: { perm: string; label: string }) {
  const { op, can, ready } = usePerm();
  if (!ready) return null;
  const ok = can(perm);
  return (
    <div className={clsx("perm", !ok && "no")}>
      {ok ? <ShieldCheck aria-hidden /> : <Lock aria-hidden />}
      <span>
        {ok
          ? `권한 확인됨 · ${op.name} (${op.role})`
          : `${label} 권한 없음 · 현재 역할 ${op.role} — 상단 운영자 선택에서 Operator/Admin으로 전환하세요`}
      </span>
    </div>
  );
}

// ───────────────────────────── overlay: drawer + modal ──
function useEsc(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") ref.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
}

export function Drawer({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy?: string; children: ReactNode }) {
  useEsc(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.aside
            key="drawer"
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 48, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Modal({ open, onClose, children, width }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEsc(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="mscrim" className="scrim" style={{ zIndex: 59 }} onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <div className="modal" key="modal">
            <motion.div
              className="modal-card"
              role="dialog"
              aria-modal="true"
              style={width ? { width: `min(${width}px, 100%)` } : undefined}
              initial={{ opacity: 0, scale: 0.97, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Text viewer modal with copy + download (CSV preview, JSONL log export, list export). */
export function TextModal({
  open,
  onClose,
  title,
  sub,
  text,
  filename,
  onDownload,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  text: string;
  filename?: string;
  onDownload?: () => void;
  loading?: boolean;
}) {
  const copy = useCopy();
  const ta = useRef<HTMLTextAreaElement>(null);
  const lines = text ? text.split("\n").length : 0;
  const size = useMemo(() => (typeof Blob !== "undefined" ? new Blob([text]).size : text.length), [text]);
  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-h">
        <div>
          <div className="h2">
            <FileText aria-hidden />
            {title}
          </div>
          {sub && <div className="sub mono" style={{ overflowWrap: "anywhere" }}>{sub}</div>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="닫기">
          <X aria-hidden />
        </button>
      </div>
      <div className="modal-b">
        <textarea ref={ta} className="csvbox" readOnly spellCheck={false} value={loading ? "불러오는 중…" : text} aria-label={title} />
        <div className="sub mono">
          {fmt.number(lines)} lines · {fmt.bytes(size)}
        </div>
      </div>
      <div className="modal-f">
        <button className="btn" onClick={onClose}>
          닫기
        </button>
        {(filename || onDownload) && (
          <button className="btn" onClick={() => (onDownload ? onDownload() : downloadText(text, filename!))}>
            <Download aria-hidden />
            다운로드
          </button>
        )}
        <button className="btn primary" onClick={() => copy(text, ta.current)} autoFocus>
          <Copy aria-hidden />
          복사
        </button>
      </div>
    </Modal>
  );
}

/** <option> list helper */
export function Opts({ items }: { items: [string, string][] }) {
  return (
    <>
      {items.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </>
  );
}
