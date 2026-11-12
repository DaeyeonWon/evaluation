"use client";
/**
 * Atlas application shell: top bar (brand, numbered drawing-sheet tabs, ⌘K palette, virtual clock,
 * simulator controls → POST /api/v1/sim, theme toggle), toasts, command palette.
 */
import clsx from "clsx";
import {
  BarChart3,
  GitBranch,
  Gauge,
  LayoutGrid,
  Map as MapIcon,
  Moon,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  Sun,
  Table,
  ArchiveX,
  CornerDownLeft,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CatalogIcon, fmt, useTheme } from "@/components/shared";
import { STAGES, STATUS_META, DLQ_STATUS_META } from "@/lib/catalog";
import { api, useLiveStream, useSimNow, useStreamEvent } from "@/lib/client";
import type { DeadLetter, WorkflowSummary } from "@/lib/types";
import { ToastProvider, useToast, useReducedMotionSafe } from "./ui";

export const TABS = [
  { href: "/atlas", no: "A-00", label: "오케스트레이션", Icon: MapIcon },
  { href: "/atlas/overview", no: "S-01", label: "개요", Icon: LayoutGrid },
  { href: "/atlas/capacity", no: "S-02", label: "Capacity", Icon: Gauge },
  { href: "/atlas/explorer", no: "S-03", label: "Explorer", Icon: Search },
  { href: "/atlas/workflows", no: "S-04", label: "Pipeline 상세", Icon: GitBranch },
  { href: "/atlas/dlq", no: "S-05", label: "DLQ", Icon: ArchiveX },
  { href: "/atlas/results", no: "U-01", label: "평가 결과", Icon: Table },
  { href: "/atlas/analytics", no: "S-07", label: "분석", Icon: BarChart3 },
  { href: "/atlas/config", no: "S-06", label: "설정", Icon: SlidersHorizontal },
] as const;

function isActive(path: string, href: string) {
  return href === "/atlas" ? path === "/atlas" : path === href || path.startsWith(href + "/");
}

function Brand() {
  return (
    <Link className="brand" href="/atlas" aria-label="AIPO Atlas 홈 (오케스트레이션)">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 24 L13 8 L20 24 M9 18h8" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="24" cy="10" r="3" fill="var(--accent)" />
        <path d="M20 24h6" stroke="var(--accent)" strokeWidth="2" />
      </svg>
      <div>
        <b>AIPO Atlas</b>
        <small>빅스비 실발화 평가 · PROD</small>
      </div>
    </Link>
  );
}

/** Simulator run state: `tick` stops while paused, so also follow the `sim` SSE event and mutation responses. */
export function useSim() {
  const { snapshot, status } = useLiveStream();
  const [sim, setSim] = useState<{ running: boolean; speed: number } | null>(null);
  useStreamEvent("sim", (s) => setSim({ running: s.running, speed: s.speed }));
  useStreamEvent("tick", (t) => setSim({ running: t.running, speed: t.speed }));
  useStreamEvent("hello", (h) => setSim({ running: h.sim.running, speed: h.sim.speed }));
  return { running: sim?.running ?? snapshot?.running ?? true, speed: sim?.speed ?? snapshot?.speed ?? 1, status, set: setSim };
}

function SimControls() {
  const { running, speed, status, set } = useSim();
  const toast = useToast();
  const toggle = async () => {
    try {
      const r = running ? await api.simPause() : await api.simResume();
      set({ running: r.sim.running, speed: r.sim.speed });
      toast.ok(running ? "실시간 시뮬레이션을 일시정지했습니다." : "실시간 시뮬레이션을 재개했습니다.");
    } catch (e) {
      toast.err(e);
    }
  };
  const setSpeed = async (s: number) => {
    try {
      const r = await api.simSpeed(s);
      set({ running: r.sim.running, speed: r.sim.speed });
    } catch (e) {
      toast.err(e);
    }
  };
  return (
    <>
      <button className="btn icon" onClick={toggle} aria-label={running ? "시뮬레이터 일시정지" : "시뮬레이터 재개"} title={running ? "시뮬레이터 일시정지" : "시뮬레이터 재개"}>
        {running ? <Pause /> : <Play />}
      </button>
      <div className="seg hide-sm" role="group" aria-label="시뮬레이터 속도">
        {[1, 2, 5].map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      {status !== "open" && status !== "idle" ? (
        <span className="conn hide-sm" title="실시간 스트림 연결 상태">
          {status === "connecting" ? "연결 중" : "재연결 중"}
        </span>
      ) : null}
    </>
  );
}

function Clock() {
  const now = useSimNow();
  const { running } = useSim();
  return (
    <div className={clsx("clock", !running && "paused")} aria-live="off">
      <b suppressHydrationWarning>
        <span className="live-dot" style={{ marginRight: 6 }} />
        {fmt.time(now)}
      </b>
      <span suppressHydrationWarning>{fmt.dateKo(now)} · 가상시계</span>
    </div>
  );
}

function ThemeBtn() {
  const { resolved, toggle } = useTheme();
  return (
    <button className="btn icon" onClick={toggle} aria-label={resolved === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"} suppressHydrationWarning>
      {resolved === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}

/* ───────────── command palette ───────────── */
interface PalItem {
  grp: string;
  icon: ReactNode;
  label: string;
  sub: string;
  href: string;
  tone?: string;
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [remote, setRemote] = useState<{ q: string; wfs: WorkflowSummary[]; dls: DeadLetter[] }>({ q: "", wfs: [], dls: [] });
  const listRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();

  useEffect(() => {
    const t = q.trim();
    let alive = true;
    const h = setTimeout(
      () => {
        Promise.all([api.workflows({ q: t || undefined, pageSize: t ? 12 : 6, sort: "updated_desc" }), api.deadLetters({ q: t || undefined, pageSize: t ? 10 : 5 })])
          .then(([w, d]) => alive && setRemote({ q: t, wfs: w.items, dls: d.items }))
          .catch(() => {});
      },
      t ? 160 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [q]);

  const items = useMemo<PalItem[]>(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const m = (s: string) => terms.every((x) => s.toLowerCase().includes(x));
    const out: PalItem[] = [];
    TABS.forEach((t) => {
      if (m(`${t.label} ${t.no} ${t.href}`)) out.push({ grp: "화면", icon: <t.Icon />, label: t.label, sub: t.no, href: t.href });
    });
    STAGES.forEach((s) => {
      if (m(`${s.label.ko} ${s.label.en} ${s.id}`))
        out.push({ grp: "오케스트레이션 단계", icon: <CatalogIcon name={s.icon} />, label: s.label.ko, sub: s.label.en, href: `/atlas?stage=${s.id}` });
    });
    remote.wfs.forEach((w) =>
      out.push({
        grp: "Workflow",
        icon: <CatalogIcon name={STATUS_META[w.status].icon} />,
        tone: STATUS_META[w.status].tone,
        label: w.workflow_id,
        sub: `${w.batch_id} · ${STATUS_META[w.status].label} · ${w.pipeline_job_id ?? ""}`,
        href: `/atlas/workflows/${w.workflow_id}`,
      }),
    );
    remote.dls.forEach((d) =>
      out.push({
        grp: "DLQ",
        icon: <ArchiveX />,
        tone: "dlq",
        label: d.dead_letter_id,
        sub: `${d.workflow_id} · ${d.error_code} · ${DLQ_STATUS_META[d.status].label}`,
        href: `/atlas/dlq?sel=${d.dead_letter_id}`,
      }),
    );
    return out.slice(0, 60);
  }, [q, remote]);

  const go = useCallback(
    (it: PalItem | undefined) => {
      if (!it) return;
      onClose();
      router.push(it.href);
    },
    [onClose, router],
  );

  const cur = Math.min(sel, Math.max(0, items.length - 1));
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  let lastGrp = "";
  return (
    <motion.div
      className="scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        initial={reduced ? false : { y: -8, scale: 0.985, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="pal-in">
          <Search aria-hidden />
          <input
            autoFocus
            value={q}
            placeholder="Workflow ID, Batch, PipelineJob, DLQ ID, 오류 코드, 화면 이름…"
            aria-label="검색어"
            aria-controls="atlas-pal-list"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel(Math.min(items.length - 1, cur + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel(Math.max(0, cur - 1));
              } else if (e.key === "Enter") go(items[cur]);
              else if (e.key === "Escape") onClose();
            }}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="pal-list" id="atlas-pal-list" role="listbox" ref={listRef}>
          {items.length === 0 ? (
            <div className="empty">
              <b>일치하는 항목이 없습니다</b>Workflow ID 일부(예: ko-0022)나 오류 코드(예: QUOTA)로 검색해 보세요.
            </div>
          ) : (
            items.map((it, i) => {
              const head = it.grp !== lastGrp ? <div className="grp-t">{it.grp}</div> : null;
              lastGrp = it.grp;
              return (
                <div key={it.grp + it.href}>
                  {head}
                  <div
                    className={clsx("pal-item", it.tone && `tone-${it.tone}`)}
                    role="option"
                    aria-selected={i === cur}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                  >
                    <span style={{ color: "var(--tc, var(--ink-3))", display: "grid" }}>{it.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 12.5 }}>
                        {it.label}
                      </div>
                      <div className="sub">{it.sub}</div>
                    </div>
                    <CornerDownLeft className="muted" aria-hidden style={{ width: 13, height: 13 }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function TopBar({ onPalette }: { onPalette: () => void }) {
  const path = usePathname();
  const { snapshot } = useLiveStream();
  const pend = snapshot?.kpis.dlqPendingReview ?? 0;
  return (
    <header className="top">
      <Brand />
      <nav className="tabs" aria-label="화면">
        {TABS.map((t) => {
          const on = isActive(path, t.href);
          return (
            <Link key={t.href} href={t.href} className="tab" aria-current={on ? "page" : undefined}>
              <span className="no">{t.no}</span>
              {t.label}
              {t.href === "/atlas/dlq" && pend ? (
                <span className="cnt" aria-label={`검토 대기 ${pend}건`}>
                  {pend}
                </span>
              ) : null}
              {on ? <motion.span layoutId="atlas-tab-ind" className="bar-ind" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="tools">
        <button className="btn search-btn" onClick={onPalette} aria-label="검색 및 명령 팔레트 열기 (⌘K)">
          <Search />
          <span className="lbl">Workflow·배치·DLQ 검색</span>
          <span className="kbd">⌘K</span>
        </button>
        <Clock />
        <SimControls />
        <ThemeBtn />
        <span className="mock hide-sm" title="이 화면의 모든 수치는 앱 내장 Mock API의 시뮬레이션 데이터입니다">
          MOCK DATA
        </span>
      </div>
    </header>
  );
}

export function AtlasShell({ children }: { children: ReactNode }) {
  const [pal, setPal] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPal((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const close = useCallback(() => setPal(false), []);
  return (
    <ToastProvider>
      <TopBar onPalette={() => setPal(true)} />
      <main id="atlas-main">{children}</main>
      <AnimatePresence>{pal ? <Palette key="pal" onClose={close} /> : null}</AnimatePresence>
    </ToastProvider>
  );
}
