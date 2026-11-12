"use client";
import clsx from "clsx";
import { ArrowUpRight, Pause, Play, Plus, Radio } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LangDot, ThemeToggle, useTween } from "@/components/shared";
import { api, useLiveStream, useSimNow } from "@/lib/client";
import { LANG_CODES, LANGUAGE_BY_CODE } from "@/lib/catalog";
import { fmt } from "@/lib/format";
import type { TickSnapshot } from "@/lib/types";
import { AtlasPreview, FlowlinePreview, LanesPreview } from "./previews";

function Num({ value, format = (n: number) => fmt.number(n) }: { value: number | null | undefined; format?: (n: number) => string }) {
  const v = useTween(value ?? 0);
  return <>{value == null ? "–" : format(v)}</>;
}

const CONCEPTS: {
  key: "flowline" | "atlas" | "lanes";
  letter: string;
  name: string;
  tagline: string;
  description: string;
  points: string[];
  fonts: string;
  titleClass: string;
  Preview: (p: { snap: TickSnapshot | null }) => ReactNode;
  previewBg: string;
}[] = [
  {
    key: "flowline",
    letter: "A",
    name: "Flowline",
    tagline: "미션 컨트롤 파이프라인 레일",
    description: "GCS 입력부터 결과 CSV까지 한 줄의 레일 위로 배치 토큰이 흐릅니다. 레일에서 시작해 단계 인스펙터, Pipeline 상세로 파고듭니다.",
    points: ["다크 우선 관제실 톤", "단계 클릭 → 슬라이드 인스펙터", "Retry·DLQ 복구 루프 시각화"],
    fonts: "Pretendard · JetBrains Mono",
    titleClass: "font-flowline",
    Preview: FlowlinePreview,
    previewBg: "#0b111b",
  },
  {
    key: "atlas",
    letter: "B",
    name: "Atlas",
    tagline: "아키텍처 도면 위의 실시간 관제",
    description: "설계 도면처럼 그려진 논리 구성 위에서 각 GCP 구성요소의 상태가 살아 움직입니다. 줌·팬으로 탐색하고 블록을 눌러 상세를 엽니다.",
    points: ["청사진 그리드 · 엔지니어링 주석", "줌/팬 가능한 시스템 맵", "ADR·계획서 조항 레퍼런스"],
    fonts: "SUIT · IBM Plex Mono",
    titleClass: "font-atlas",
    Preview: AtlasPreview,
    previewBg: "#edf1f4",
  },
  {
    key: "lanes",
    letter: "C",
    name: "Lanes",
    tagline: "언어 레인 스케줄러 보드",
    description: "행은 언어별 Capacity Slot, 열은 상태 머신 단계입니다. Time river로 대기·실행·Backoff 구간을 한눈에 비교합니다.",
    points: ["언어 × 상태 매트릭스 보드", "Time river 타임라인", "에디토리얼 타이포그래피"],
    fonts: "Wanted Sans · Pretendard · Fira Code",
    titleClass: "font-lanes-title",
    Preview: LanesPreview,
    previewBg: "#ffffff",
  },
];

const STATUS_LABEL = { idle: "대기", connecting: "연결 중", open: "LIVE", reconnecting: "재연결 중", closed: "끊김" } as const;

export function Landing() {
  const { snapshot: snap, status } = useLiveStream();
  const now = useSimNow();
  const k = snap?.kpis;
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-variant="landing" className="landing min-h-dvh">
      <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-10">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3 py-5">
          <div className="flex items-center gap-3">
            <span className="lp-logo" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M3 15h4l2.5-6 4 10 2.5-6H21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="leading-tight">
              <div className="text-[15px] font-bold tracking-[-0.01em]">AIPO Operations</div>
              <div className="text-[12px] text-[var(--lp-muted)]">빅스비 실발화 평가 · 운영 콘솔 데모</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="lp-chip" data-state={status}>
              <span className="lp-pulse" aria-hidden />
              <span className="lp-mono text-[11px] font-semibold tracking-[0.08em]">{STATUS_LABEL[status]}</span>
              <span className="hidden text-[11px] text-[var(--lp-muted)] sm:inline">SSE</span>
            </span>
            <span className="lp-chip hidden sm:inline-flex" title="시뮬레이터 가상 시각 (KST)">
              <span className="text-[12px] text-[var(--lp-muted)]">{fmt.dateKo(now)}</span>
              <span className="lp-mono tnum text-[12px] font-semibold">{fmt.time(now)}</span>
            </span>
            <ThemeToggle className="lp-icon-btn" />
          </div>
        </header>

        {/* hero */}
        <section className="pt-8 pb-8 sm:pt-14 sm:pb-10">
          <p className="lp-eyebrow">Event-driven AI Pipeline Orchestration · Mock Demo</p>
          <h1 className="mt-3 max-w-[18ch] text-[34px] leading-[1.18] font-extrabold ko-tighter sm:text-[52px]">
            세 가지 관제 콘셉트로 보는 실시간 평가 파이프라인
          </h1>
          <p className="mt-5 max-w-[60ch] text-[15px] leading-[1.75] text-[var(--lp-muted)] sm:text-[16px]">
            실발화 배치가 GCS에 올라오면 이벤트·대기열·언어별 스케줄러·Cloud Workflows·Vertex AI Pipeline을 거쳐 발화별 PASS/FAIL CSV로
            저장됩니다. 세 콘셉트는 모두 같은 Mock API와 서버 시뮬레이터를 공유하며, 아래 숫자는 지금 이 순간의 상태입니다.
          </p>
        </section>

        {/* live KPIs */}
        <section aria-label="실시간 지표" className="lp-kpis">
          <Kpi label="실행 중" sub={k ? `Dispatching ${snap!.counts.DISPATCHING}` : " "}>
            <Num value={k?.running} />
          </Kpi>
          <Kpi label="대기" sub={k ? `Queued ${k.queued}` : " "}>
            <Num value={k?.pending} />
          </Kpi>
          <Kpi label="오늘 완료" sub={k ? `실패 ${k.failedToday} · 취소 ${k.cancelledToday}` : " "}>
            <Num value={k?.completedToday} />
          </Kpi>
          <Kpi label="DLQ 검토 대기" sub={k ? `누적 ${k.dlqTotal}건` : " "} tone="dlq">
            <Num value={k?.dlqPendingReview} />
          </Kpi>
          <Kpi label="오늘 평가 발화" sub={k ? `PASS ${fmt.pct(k.utterancePassRateToday)}` : " "}>
            <Num value={k?.utterancesEvaluatedToday} />
          </Kpi>
          <Kpi label="Global Slot" sub={snap ? `가동률 ${fmt.pct(snap.capacity.global.utilization, 0)}` : " "}>
            <Num value={snap?.capacity.global.active} />
            <span className="text-[var(--lp-faint)]">/{snap?.capacity.global.max ?? "–"}</span>
          </Kpi>
        </section>

        <section aria-label="언어별 Capacity" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {LANG_CODES.map((code) => {
            const l = snap?.capacity.languages.find((x) => x.code === code);
            const pct = l ? Math.min(1, l.active / Math.max(1, l.max)) : 0;
            return (
              <div key={code} className="flex items-center gap-2 text-[12px]">
                <LangDot lang={code} />
                <span className="w-12 shrink-0 font-semibold">{LANGUAGE_BY_CODE[code].name}</span>
                <span className="lp-bar" aria-hidden>
                  <span style={{ width: `${pct * 100}%`, background: `var(--lang-${code})` }} />
                </span>
                <span className="lp-mono tnum w-12 text-right text-[var(--lp-muted)]">{l ? `${l.active}/${l.max}` : "–"}</span>
              </div>
            );
          })}
        </section>

        {/* concepts */}
        <section aria-label="디자인 콘셉트" className="mt-12 grid gap-5 lg:grid-cols-3">
          {CONCEPTS.map((c) => (
            <Link key={c.key} href={`/${c.key}`} className="lp-card group" data-concept={c.key}>
              <div className="lp-preview" style={{ background: c.previewBg }}>
                <c.Preview snap={snap} />
              </div>
              <div className="flex flex-1 flex-col p-5 sm:p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="lp-mono text-[11px] tracking-[0.14em] text-[var(--lp-faint)]">CONCEPT {c.letter}</span>
                  <span className="lp-mono text-[11px] text-[var(--lp-faint)]">/{c.key}</span>
                </div>
                <h2 className={clsx("mt-2 text-[30px] leading-none font-bold", c.titleClass)}>{c.name}</h2>
                <p className={clsx("mt-2 text-[16px] font-semibold ko-tight", c.titleClass)}>{c.tagline}</p>
                <p className="mt-3 text-[14px] leading-[1.7] text-[var(--lp-muted)]">{c.description}</p>
                <ul className="mt-4 space-y-1.5 text-[13px]">
                  {c.points.map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" aria-hidden />
                      {p}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                  <span className="text-[12px] text-[var(--lp-faint)]">{c.fonts}</span>
                  <span className="lp-cta">
                    열기 <ArrowUpRight size={15} aria-hidden className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>

        {/* simulator controls */}
        <section aria-label="시뮬레이터" className="lp-sim mt-12">
          <div>
            <div className="flex items-center gap-2 text-[14px] font-bold">
              <Radio size={15} aria-hidden /> 서버 시뮬레이터
            </div>
            <p className="mt-1 text-[13px] leading-[1.65] text-[var(--lp-muted)]">
              가상 시계는 2026-11-12 14:30 KST에서 시작해 1.2초마다 20초 × 배속만큼 흐릅니다. 모든 콘셉트와 API가 같은 상태를 봅니다. GCP 호출은
              없습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="lp-btn"
              disabled={busy || !snap}
              onClick={() => run(() => (snap?.running ? api.simPause() : api.simResume()))}
            >
              {snap?.running === false ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
              {snap?.running === false ? "재개" : "일시 정지"}
            </button>
            <div className="lp-seg" role="radiogroup" aria-label="배속">
              {[1, 2, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={snap?.speed === s}
                  data-active={snap?.speed === s || undefined}
                  disabled={busy}
                  onClick={() => run(() => api.simSpeed(s))}
                  className="lp-mono"
                >
                  {s}x
                </button>
              ))}
            </div>
            <button type="button" className="lp-btn" disabled={busy} onClick={() => run(() => api.simInject())}>
              <Plus size={14} aria-hidden /> 배치 주입
            </button>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 py-10 text-[12px] text-[var(--lp-faint)]">
          <span>Mock 데이터 · 결정적(seeded) 시나리오 · 실제 내부 데이터 없음</span>
          <span className="lp-mono">
            <a className="underline-offset-4 hover:underline" href="/api/v1/overview">
              /api/v1/overview
            </a>
            {"  ·  "}
            <a className="underline-offset-4 hover:underline" href="/api/v1/meta">
              /api/v1/meta
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}

function Kpi({ label, sub, children, tone }: { label: string; sub: string; children: ReactNode; tone?: "dlq" }) {
  return (
    <div className="lp-kpi">
      <div className="text-[12px] font-medium text-[var(--lp-muted)]">{label}</div>
      <div className="lp-kpi-num tnum" style={tone ? { color: `var(--st-${tone})` } : undefined}>
        {children}
      </div>
      <div className="truncate text-[11.5px] text-[var(--lp-faint)]">{sub}</div>
    </div>
  );
}
