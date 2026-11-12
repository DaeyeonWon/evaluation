"use client";
/**
 * Lanes app shell: sticky header (brand · nav with sliding pill · sim controls · theme · operator),
 * sub-bar (URL-derived breadcrumbs + live transition ticker), toasts, reduced-motion config.
 */
import clsx from "clsx";
import Link from "next/link";
import { MotionConfig, motion } from "motion/react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArchiveX,
  BarChart3,
  ChevronRight,
  Gauge,
  LayoutGrid,
  Menu,
  Moon,
  Pause,
  Play,
  Search,
  Settings,
  Sun,
  Target,
} from "lucide-react";
import { STAGE_BY_ID, STATUS_META } from "@/lib/catalog";
import { api, useLiveStream, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, useTheme } from "@/components/shared";
import type { StageId, TransitionMessage } from "@/lib/types";
import { ToastProvider, shortWf, useAction, useCan } from "./core";

export const NAV = [
  { id: "board", href: "/lanes", short: "보드", Icon: LayoutGrid },
  { id: "overview", href: "/lanes/overview", short: "개요", Icon: Activity },
  { id: "capacity", href: "/lanes/capacity", short: "Capacity", Icon: Gauge },
  { id: "explorer", href: "/lanes/explorer", short: "Pipeline 탐색", Icon: Search },
  { id: "dlq", href: "/lanes/dlq", short: "DLQ", Icon: ArchiveX },
  { id: "results", href: "/lanes/results", short: "평가 결과", Icon: Target },
  { id: "analytics", href: "/lanes/analytics", short: "분석", Icon: BarChart3 },
  { id: "config", href: "/lanes/config", short: "설정", Icon: Settings },
] as const;

const TITLES: Record<string, string> = {
  board: "오케스트레이션 보드",
  overview: "Global Overview",
  capacity: "Language Capacity",
  explorer: "Pipeline Explorer",
  workflows: "Pipeline Detail",
  dlq: "DLQ Operations",
  results: "평가 결과",
  analytics: "Analytics",
  config: "System Configuration",
};

function screenOf(path: string): string {
  const seg = path.replace(/^\/lanes\/?/, "").split(/[/?#]/)[0];
  return seg || "board";
}

export function LanesShell({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <Header />
        <div className="subbar">
          <Suspense fallback={<nav className="crumbs" />}>
            <Crumbs />
          </Suspense>
          <Ticker />
        </div>
        <main className="ln-main">{children}</main>
      </ToastProvider>
    </MotionConfig>
  );
}

function Header() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenu(false);
  }
  const { snapshot } = useLiveStream();
  const scr = screenOf(pathname);
  const cur = scr === "workflows" ? "explorer" : scr;
  const dlqN = snapshot?.kpis.dlqPendingReview;
  const curNav = NAV.find((n) => n.id === cur);
  return (
    <>
      <header className="hdr">
        <Link className="brand" href="/lanes" aria-label="AIPO Lanes 보드로 이동">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="brand-t">
            <b>AIPO Lanes</b>
            <span>빅스비 실발화 평가 운영 콘솔</span>
          </span>
        </Link>
        <span className="mockflag" title="Mock 데이터 — 실제 운영 수치가 아닙니다">
          MOCK DATA
        </span>
        <div className="nav-wrap">
          <nav className="nav" aria-label="화면 전환">
            {NAV.map((n) => (
              <Link key={n.id} href={n.href} aria-current={n.id === cur ? "page" : undefined} data-nav={n.id}>
                {n.id === cur && <motion.span layoutId="ln-nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                <n.Icon className="i" aria-hidden />
                <span>{n.short}</span>
                {n.id === "dlq" && dlqN != null && <span className="cnt">{dlqN}</span>}
              </Link>
            ))}
          </nav>
          <button type="button" className="btn menu-btn" aria-expanded={menu} aria-controls="ln-menu" onClick={() => setMenu((m) => !m)}>
            <Menu className="i" aria-hidden />
            <span className="cur-l">{curNav?.short ?? "메뉴"}</span>
          </button>
        </div>
        <div className="hdr-r">
          <SimControl />
          <ThemeBtn />
          <Who />
        </div>
      </header>
      {menu && (
        <div className="menu-pop" id="ln-menu">
          {NAV.map((n) => (
            <Link key={n.id} href={n.href} aria-current={n.id === cur ? "page" : undefined} onClick={() => setMenu(false)}>
              <n.Icon className="i" aria-hidden />
              {n.short}
              {n.id === "dlq" && dlqN != null && <span className="mono dim">({dlqN})</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

const SPEEDS = [1, 2, 5, 10];
function SimControl() {
  const { snapshot, status } = useLiveStream();
  const act = useAction();
  const [simOverride, setSimOverride] = useState<{ running: boolean; speed: number } | null>(null);
  useStreamEvent("sim", (s) => setSimOverride({ running: s.running, speed: s.speed }));
  useStreamEvent("tick", () => setSimOverride(null));
  const running = simOverride?.running ?? snapshot?.running ?? true;
  const speed = simOverride?.speed ?? snapshot?.speed ?? 1;
  const now = snapshot?.now;
  const live = status === "open" && running;
  return (
    <div className="simctl" role="group" aria-label="시뮬레이터 제어">
      <span className="clock" title={status === "open" ? "SSE 연결됨 · 가상 시계" : `스트림 ${status}`}>
        <span className={clsx("live", !live && (status === "open" ? "off" : "warn"))} />
        <span className="d">{now ? fmt.dateKo(now) : ""}</span>
        <span className="t">{now ? fmt.time(now) : "--:--:--"}</span>
      </span>
      <button
        type="button"
        className="iconbtn"
        aria-label={running ? "시뮬레이터 일시정지" : "시뮬레이터 재개"}
        title="일시정지 / 재개"
        onClick={async () => {
          const r = await act(() => (running ? api.simPause() : api.simResume()));
          if (r) setSimOverride({ running: r.sim.running, speed: r.sim.speed });
        }}
      >
        {running ? <Pause className="i" /> : <Play className="i" />}
      </button>
      <div className="speed" role="group" aria-label="재생 속도">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            onClick={async () => {
              const r = await act(() => api.simSpeed(s));
              if (r) setSimOverride({ running: r.sim.running, speed: r.sim.speed });
            }}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

function ThemeBtn() {
  const { resolved, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const dark = mounted && resolved === "dark";
  return (
    <button type="button" className="iconbtn" onClick={toggle} aria-label={dark ? "라이트 테마로 전환" : "다크 테마로 전환"} title="Light / Dark" data-theme-control="toggle">
      {dark ? <Sun className="i" /> : <Moon className="i" />}
    </button>
  );
}

function Who() {
  const { operator } = useCan();
  return (
    <Link className="who" href="/lanes/config#roles" title="현재 운영자 — 설정 › 권한에서 전환">
      <span className="avatar">{operator.name.slice(0, 1)}</span>
      <span className="nm">
        <b>{operator.name}</b> <span className="muted">{operator.role}</span>
      </span>
    </Link>
  );
}

function crumbFor(href: string): { label: string; hint: string } {
  const [p, q] = href.split("?");
  const scr = screenOf(p);
  const sp = new URLSearchParams(q || "");
  const bits: string[] = [];
  sp.forEach((v, k) => {
    if (v && k !== "from" && k !== "tab") bits.push(v);
  });
  return { label: TITLES[scr] ?? scr, hint: bits.slice(0, 3).join(" · ") };
}

function Crumbs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const scr = screenOf(pathname);
  const sep = <ChevronRight className="i sm" aria-hidden />;
  if (scr === "workflows") {
    const id = decodeURIComponent(pathname.split("/")[3] ?? "");
    const from = sp.get("from");
    const f = from && from.startsWith("/lanes") ? crumbFor(from) : null;
    const node = sp.get("node");
    const attempt = sp.get("attempt");
    return (
      <nav className="crumbs" aria-label="현재 위치">
        <Link href="/lanes">AIPO</Link>
        {sep}
        {f ? (
          <Link href={from!} title="필터가 유지된 이전 화면으로">
            {f.label}
            {f.hint && <span className="muted mono"> ({f.hint})</span>}
          </Link>
        ) : (
          <Link href="/lanes/explorer">Pipeline Explorer</Link>
        )}
        {sep}
        <span className={clsx("mono", !node && "cur")}>{id}</span>
        {node && (
          <>
            {sep}
            <span className="mono">attempt {attempt ?? "—"}</span>
            {sep}
            <span className="mono cur">{node}</span>
          </>
        )}
      </nav>
    );
  }
  const hint = crumbFor(pathname + "?" + sp.toString()).hint;
  const stage = scr === "board" ? (sp.get("stage") as StageId | null) : null;
  return (
    <nav className="crumbs" aria-label="현재 위치">
      <Link href="/lanes">AIPO</Link>
      {sep}
      {stage && STAGE_BY_ID[stage] ? (
        <>
          <Link href="/lanes">{TITLES.board}</Link>
          {sep}
          <span className="cur">{STAGE_BY_ID[stage].label.ko}</span>
        </>
      ) : (
        <>
          <span className="cur">{TITLES[scr] ?? scr}</span>
          {hint && <span className="muted mono">· {hint}</span>}
        </>
      )}
    </nav>
  );
}

function Ticker() {
  const [items, setItems] = useState<(TransitionMessage & { k: number })[]>([]);
  useStreamEvent("transition", (t) => {
    if (!t.from) return;
    setItems((xs) => [{ ...t, k: Math.random() }, ...xs].slice(0, 3));
  });
  return (
    <div className="ticker" aria-live="polite">
      {items.map((t, i) => {
        const m = STATUS_META[t.to];
        const fm = t.from ? STATUS_META[t.from] : null;
        return (
          <span key={t.k} style={{ display: "contents" }}>
            {i > 0 && <span className="dim">·</span>}
            <span className={`tk t-${m.tone}`}>
              <CatalogIcon name={m.icon} className="i sm" style={{ color: "var(--tc)" }} aria-hidden />
              <b className="mono" style={{ color: "var(--ink)" }}>
                {shortWf(t.workflow_id)}
              </b>
              {fm?.label ?? t.from} → <b style={{ color: "var(--tc)" }}>{m.label}</b>
            </span>
          </span>
        );
      })}
    </div>
  );
}
