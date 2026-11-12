"use client";
/**
 * Lanes — shared helpers for every Lanes screen (toasts, permissions, small presentational atoms,
 * chart option builders, URL helpers). Port of the prototype's `window.LANES` utility bag.
 */
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { LANGUAGE_BY_CODE, OPERATORS, ROLE_PERMISSIONS, STATUS_META } from "@/lib/catalog";
import { api, useApi, useOperator, ApiClientError } from "@/lib/client";
import { fmt } from "@/lib/format";
import { useTween, type ChartTokens } from "@/components/shared";
import type { LangCode, Tone, WorkflowStatus } from "@/lib/types";

// ───────────────────────── formatting ──
export const shortWf = (id: string | null | undefined) => fmt.shortWorkflowId(id);
export const dur = (ms: number | null | undefined) => (ms == null || Number.isNaN(ms) ? "—" : fmt.duration(ms, { style: "short" }));
export const pct = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? "—" : fmt.pct(v, d));
export const num = (v: number | null | undefined, d = 0) => (v == null ? "—" : fmt.number(v, d));
export const langName = (c: string) => LANGUAGE_BY_CODE[c as LangCode]?.name ?? c;
export const toneOf = (s: WorkflowStatus | string) => STATUS_META[s as WorkflowStatus]?.tone ?? "queued";
export const opName = (id: string | null | undefined) => (id ? OPERATORS.find((o) => o.id === id)?.name ?? id : "—");
export const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : e instanceof Error ? e.message : String(e));

/** "2026-11-12T14:30" (datetime-local, KST) ⇄ epoch ms */
export function localToMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const d = new Date(v.length === 16 ? v + ":00+09:00" : v + "+09:00");
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// ───────────────────────── toasts ──
type ToastTone = Tone;
interface ToastItem {
  id: number;
  tone: ToastTone;
  msg: ReactNode;
}
const ToastCtx = createContext<(msg: ReactNode, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((msg: ReactNode, tone: ToastTone = "running") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.filter((x) => !(tone === "success" && x.tone === "retry")), { id, tone, msg }].slice(-4));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.button
              key={t.id}
              type="button"
              layout
              className={`toast t-${t.tone}`}
              title="클릭하여 닫기"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {t.tone === "success" ? <CheckCircle2 /> : t.tone === "failed" || t.tone === "retry" ? <AlertTriangle /> : <Info />}
              <div>{t.msg}</div>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an API mutation with toast feedback on error. Returns the result or undefined. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, ok?: (r: T) => ReactNode): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (ok) toast(ok(r), "success");
        return r;
      } catch (e) {
        toast(errMsg(e), e instanceof ApiClientError && e.status === 409 ? "retry" : "failed");
        return undefined;
      }
    },
    [toast],
  );
}

// ───────────────────────── permissions ──
export function useCan() {
  const [op] = useOperator();
  const me = useApi(["lanes-me", op.id], () => api.me(), { revalidateOnFocus: false });
  return useMemo(() => {
    const perms = me.data && me.data.operator.id === op.id ? me.data.permissions : null;
    const can = (key: string) => (perms ? !!perms[key] : !!ROLE_PERMISSIONS.find((p) => p.key === key)?.[op.role]);
    return { can, operator: op, role: op.role };
  }, [me.data, op]);
}

// ───────────────────────── copy ──
export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast("클립보드에 복사했습니다", "success");
      } catch {
        toast("클립보드 권한이 없습니다 — 텍스트를 직접 선택해 복사하세요", "retry");
      }
    },
    [toast],
  );
}

export function CopyId({ text, children, className, title }: { text: string | null | undefined; children?: ReactNode; className?: string; title?: string }) {
  const copy = useCopy();
  if (!text) return <span className="dim">—</span>;
  return (
    <button
      type="button"
      className={clsx("copy-id mono", className)}
      title={title ?? "클릭하여 복사"}
      onClick={(e) => {
        e.stopPropagation();
        void copy(text);
      }}
    >
      {children ?? text}
    </button>
  );
}

// ───────────────────────── atoms ──
export function Pill({ tone, icon, children, className, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={clsx("pill", tone && `t-${tone}`, className)} title={title}>
      {icon}
      {children}
    </span>
  );
}

export function LangTag({ code, className }: { code: string; className?: string }) {
  return <span className={clsx("lang", `L-${code}`, className)}>{langName(code)}</span>;
}

export function Empty({ icon, children, style }: { icon?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="empty" style={style}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <b>불러오지 못했습니다</b> — {errMsg(error)}{" "}
      {retry && (
        <button type="button" className="btn sm" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function Skel({ h = 18, w, style }: { h?: number; w?: number | string; style?: CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden />;
}

/** Animated number (tween) — formats with `f`. */
export function Tween({ value, f = (v) => fmt.number(Math.round(v)), decimals }: { value: number | null | undefined; f?: (v: number) => string; decimals?: number }) {
  const v = useTween(value ?? 0, { duration: 700, decimals: decimals ?? 2 });
  if (value == null) return <>—</>;
  return <>{f(v)}</>;
}

export function Ring({ pct: p, text, size = 26 }: { pct: number; text?: string; size?: number }) {
  const r = 10;
  const C = 2 * Math.PI * r;
  const off = C * (1 - Math.max(0, Math.min(1, p || 0)));
  return (
    <svg className="ringc" viewBox="0 0 26 26" width={size} height={size} aria-hidden>
      <circle className="bg" cx="13" cy="13" r={r} />
      <circle className="fg" cx="13" cy="13" r={r} strokeDasharray={C.toFixed(2)} strokeDashoffset={off.toFixed(2)} transform="rotate(-90 13 13)" />
      {text ? (
        <text x="13" y="13.5">
          {text}
        </text>
      ) : null}
    </svg>
  );
}

export function ProgBar({ pct: p, tone }: { pct: number; tone: Tone }) {
  return (
    <span className={`t-${tone}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--sunken)", overflow: "hidden", minWidth: 50 }}>
        <i style={{ display: "block", height: "100%", width: `${(p * 100).toFixed(1)}%`, background: "var(--tc)", transition: "width .8s" }} />
      </span>
      <span className="mono muted" style={{ fontSize: 10.5 }}>
        {Math.round(p * 100)}%
      </span>
    </span>
  );
}

export function Meter({ value }: { value: number }) {
  const v = Math.round(value || 0);
  const t = v > 85 ? "failed" : v > 65 ? "retry" : "success";
  return (
    <span className={`meter t-${t}`}>
      <span>
        <i style={{ width: `${v}%` }} />
      </span>
      <span className="mono" style={{ fontSize: 11 }}>
        {v}%
      </span>
    </span>
  );
}

/** Syntax-colored JSON (port of the prototype's jsonHtml) rendered as React nodes. */
export function JsonView({ value, style, className }: { value: unknown; style?: CSSProperties; className?: string }) {
  const nodes = useMemo(() => {
    const s = JSON.stringify(value, null, 2) ?? "";
    const out: ReactNode[] = [];
    const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*(?:e[+-]?\d+)?)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1]) {
        out.push(
          <span key={k++} className={m[2] ? "k" : "s"}>
            {m[1]}
          </span>,
        );
        if (m[2]) out.push(m[2]);
      } else if (m[3]) out.push(<span key={k++} className="b">{m[3]}</span>);
      else out.push(<span key={k++} className="n">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    out.push(s.slice(last));
    return out;
  }, [value]);
  return (
    <pre className={clsx("code", className)} style={style}>
      {nodes}
    </pre>
  );
}

// ───────────────────────── navigation helpers ──
/** Current path + query (used as `from` so breadcrumbs can return to a filtered list). */
export function useHere(): string {
  const pathname = usePathname();
  const sp = useSearchParams();
  const s = sp.toString();
  return pathname + (s ? "?" + s : "");
}

export function wfHref(id: string, from?: string) {
  return `/lanes/workflows/${encodeURIComponent(id)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

// ───────────────────────── charts (port of base/axX/axY) ──
type Obj = Record<string, unknown>;
/** Escape hatch from ECharts' very strict option unions (options are built dynamically). */
export const eo = (o: Obj): import("echarts").EChartsOption => o as unknown as import("echarts").EChartsOption;
export function chartBase(t: ChartTokens, reduced: boolean, extra: Obj = {}): Obj {
  return {
    animation: !reduced,
    animationDuration: 650,
    animationEasing: "cubicOut",
    textStyle: { fontFamily: t.font, color: t.muted, fontSize: 11 },
    grid: { left: 46, right: 16, top: 30, bottom: 28, containLabel: false },
    tooltip: {
      trigger: "axis",
      backgroundColor: t.tooltipBg,
      borderColor: t.read("--line-2"),
      borderWidth: 1,
      padding: [6, 9],
      textStyle: { color: t.text, fontSize: 11, fontFamily: t.font },
      axisPointer: { type: "line", lineStyle: { color: t.read("--ink-4"), width: 1 } },
      confine: true,
    },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 3, icon: "rect", textStyle: { color: t.text, fontSize: 11 } },
    ...extra,
  };
}
export function axX(t: ChartTokens, type: "time" | "category" | "value" = "time", extra: Obj = {}): Obj {
  return {
    type,
    axisLine: { lineStyle: { color: t.read("--line-2") } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10, hideOverlap: true },
    splitLine: { show: false },
    ...extra,
  };
}
export function axY(t: ChartTokens, extra: Obj = {}): Obj {
  return {
    type: "value",
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10 },
    splitLine: { lineStyle: { color: t.grid, type: [2, 3] } },
    ...extra,
  };
}
