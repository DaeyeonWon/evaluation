"use client";
import clsx from "clsx";
import { MotionConfig, motion } from "motion/react";
import {
  Activity,
  ArchiveX,
  BarChart3,
  FileSpreadsheet,
  Gauge,
  Layers,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "@/components/shared";
import { OPERATORS, PROJECT_ID, REGION } from "@/lib/catalog";
import { api, revalidateKey, useLiveStream, useOperator, useStreamEvent } from "@/lib/client";
import { fmt } from "@/lib/format";
import type { SimState } from "@/lib/types";
import { useLastWorkflow } from "./nav-store";
import { ToastHost, useApiErrorToast, useToast } from "./ui";

const NAV: { key: string; href: string; label: string; short?: string; icon: ReactNode }[] = [
  { key: "orch", href: "/flowline", label: "관제", icon: <Activity aria-hidden /> },
  { key: "capacity", href: "/flowline/capacity", label: "Capacity", short: "용량", icon: <Gauge aria-hidden /> },
  { key: "explorer", href: "/flowline/explorer", label: "탐색", icon: <Search aria-hidden /> },
  { key: "detail", href: "/flowline/workflows", label: "상세", icon: <Layers aria-hidden /> },
  { key: "dlq", href: "/flowline/dlq", label: "DLQ", icon: <ArchiveX aria-hidden /> },
  { key: "results", href: "/flowline/results", label: "평가 결과", short: "결과", icon: <FileSpreadsheet aria-hidden /> },
  { key: "analytics", href: "/flowline/analytics", label: "분석", icon: <BarChart3 aria-hidden /> },
  { key: "config", href: "/flowline/config", label: "설정", icon: <Settings aria-hidden /> },
];

function activeKey(path: string): string {
  if (path === "/flowline" || path === "/flowline/" || path.startsWith("/flowline/overview")) return "orch";
  if (path.startsWith("/flowline/workflows")) return "detail";
  const seg = path.split("/")[2];
  return NAV.find((n) => n.key === seg)?.key ?? "orch";
}

export function FlowlineShell({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(t);
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <ToastHost>
        <div className={clsx("app", booting && "booting")}>
          <Nav />
          <Strip />
          <main className="main" id="fl-main">
            {children}
          </main>
        </div>
      </ToastHost>
    </MotionConfig>
  );
}

function Nav() {
  const path = usePathname();
  const cur = activeKey(path);
  const last = useLastWorkflow();
  const { snapshot } = useLiveStream();
  const pend = snapshot?.kpis.dlqPendingReview ?? 0;
  return (
    <nav className="nav" aria-label="화면">
      <Link href="/flowline" className="brand" aria-label="Flowline 관제 홈">
        <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden>
          <rect x="1" y="1" width="32" height="32" rx="8" fill="none" stroke="var(--line-2)" />
          <path d="M6 21h6l3-8 4 12 3-6h6" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="25" cy="19" r="2.2" fill="var(--l-en)" />
        </svg>
        <span className="brand-name">FLOWLINE</span>
      </Link>
      {NAV.map((n) => {
        const isDetail = n.key === "detail";
        const href = isDetail ? (last ? `/flowline/workflows/${encodeURIComponent(last)}` : "/flowline/explorer") : n.href;
        const on = cur === n.key;
        return (
          <Link
            key={n.key}
            href={href}
            className="nav-btn"
            data-screen={n.key}
            aria-current={on ? "page" : undefined}
            aria-disabled={isDetail && !last && !on ? true : undefined}
            title={isDetail && last ? `상세 · ${last}` : n.label}
          >
            {on && <motion.i className="nav-ind" layoutId="fl-nav-ind" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            {n.icon}
            {n.short ? (
              <>
                <span className="full">{n.label}</span>
                <span className="short">{n.short}</span>
              </>
            ) : (
              <span>{n.label}</span>
            )}
            {n.key === "dlq" && pend > 0 && <b className="badge">{pend}</b>}
          </Link>
        );
      })}
      <div className="nav-spacer" />
      <div className="mock-mark" title="모든 수치는 앱 내장 Mock API · 시뮬레이터 데이터입니다">
        MOCK
        <br />
        DATA
      </div>
    </nav>
  );
}

const SPEEDS = [1, 2, 5, 10];

function Strip() {
  const { snapshot, status } = useLiveStream();
  const [op, setOp] = useOperator();
  const toast = useToast();
  const onErr = useApiErrorToast();
  const [env, setEnv] = useState<"dev" | "staging" | "prod">("prod");
  const [sim, setSim] = useState<Pick<SimState, "running" | "speed"> | null>(null);
  useStreamEvent("sim", (s) => setSim({ running: s.running, speed: s.speed }));
  useStreamEvent("hello", (h) => setSim({ running: h.sim.running, speed: h.sim.speed }));
  const running = sim?.running ?? snapshot?.running ?? true;
  const speed = sim?.speed ?? snapshot?.speed ?? 1;
  const now = snapshot?.now;
  const g = snapshot?.capacity.global;
  const proj = { dev: "bixby-eval-dev", staging: "bixby-eval-stg", prod: PROJECT_ID }[env];
  const live = status !== "open" ? "down" : running ? "" : "paused";
  const liveLabel = status === "open" ? (running ? "LIVE · SSE" : "PAUSED") : status === "reconnecting" ? "RECONNECTING" : "CONNECTING";

  const toggleSim = async () => {
    try {
      const r = running ? await api.simPause() : await api.simResume();
      setSim({ running: r.sim.running, speed: r.sim.speed });
      toast(r.sim.running ? "시뮬레이터를 재개했습니다" : "시뮬레이터를 일시정지했습니다 · 가상 시계 정지", r.sim.running ? "success" : "retry");
    } catch (e) {
      onErr(e);
    }
  };
  const setSpeed = async (n: number) => {
    try {
      const r = await api.simSpeed(n);
      setSim({ running: r.sim.running, speed: r.sim.speed });
    } catch (e) {
      onErr(e);
    }
  };
  const inject = async () => {
    try {
      const r = await api.simInject();
      toast(
        <>
          새 실발화 배치 업로드 → <span className="mono">{r.workflow.workflow_id}</span>
        </>,
        "success",
      );
      revalidateKey("workflows");
    } catch (e) {
      onErr(e);
    }
  };

  return (
    <header className="strip">
      <div className="strip-title">
        <b>빅스비 실발화 평가 · AIPO</b>
        <small>
          {proj} · {REGION}
        </small>
      </div>
      <span className="statchip t-retry mock-inline">MOCK</span>
      <div className="seg" role="group" aria-label="환경">
        {(["dev", "staging", "prod"] as const).map((e) => (
          <button
            key={e}
            aria-pressed={env === e}
            onClick={() => {
              setEnv(e);
              if (e !== "prod") toast(`${e === "dev" ? "Dev" : "Staging"} 환경 전환은 디자인 시연용입니다. Mock 데이터는 Prod 한 세트만 있습니다.`, "retry");
            }}
          >
            {e === "dev" ? "Dev" : e === "staging" ? "Staging" : "Prod"}
          </button>
        ))}
      </div>
      <div className="clock" aria-live="off">
        <span>{now ? fmt.time(now) : "--:--:--"} KST</span>
        <small>{now ? fmt.dateKo(now) : "KST"}</small>
      </div>
      <span className={clsx("live", live)} title={`SSE ${status}`}>
        <i aria-hidden />
        {liveLabel}
      </span>
      <div className="gcap" title="Global Capacity (active / max)">
        <div className="gcap-top">
          <span>Global Capacity</span>
          <b>{g ? `${g.active}/${g.max}` : "-/-"}</b>
        </div>
        <div className="meter">
          <i style={{ width: `${((g?.utilization ?? 0) * 100).toFixed(1)}%` }} />
        </div>
      </div>
      <div className="simctl" aria-label="시뮬레이터">
        <button className="icon-btn" onClick={toggleSim} aria-label={running ? "시뮬레이터 일시정지" : "시뮬레이터 재개"} title={running ? "시뮬레이터 일시정지" : "시뮬레이터 재개"}>
          {running ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <div className="seg" role="group" aria-label="속도">
          {SPEEDS.map((n) => (
            <button key={n} className="mono" aria-pressed={speed === n} onClick={() => setSpeed(n)}>
              {n}x
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={inject} aria-label="새 배치 업로드 (시뮬레이션)" title="새 실발화 배치를 GCS에 업로드 (시뮬레이션)">
          <Plus aria-hidden />
        </button>
      </div>
      <select
        className="opsel"
        aria-label="운영자 (권한 시뮬레이션)"
        value={op.id}
        onChange={(e) => {
          setOp(e.target.value);
          const o = OPERATORS.find((x) => x.id === e.target.value);
          if (o) toast(`${o.name} (${o.role}) 권한으로 전환했습니다`);
        }}
      >
        {OPERATORS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.role}
          </option>
        ))}
      </select>
      <ThemeToggle className="icon-btn" />
    </header>
  );
}
