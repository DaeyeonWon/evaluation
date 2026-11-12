"use client";
/** Temporary placeholder rendered by /flowline, /atlas, /lanes until each variant is implemented. */
import Link from "next/link";
import { StatusPill, ThemeToggle } from "@/components/shared";
import { useLiveStream, useSimNow } from "@/lib/client";
import { fmt } from "@/lib/format";

const NAMES = { flowline: "Flowline", atlas: "Atlas", lanes: "Lanes" } as const;

export function VariantPlaceholder({ variant }: { variant: keyof typeof NAMES }) {
  const { snapshot, status } = useLiveStream();
  const now = useSimNow();
  return (
    <main style={{ padding: "48px 16px", maxWidth: 720, margin: "0 auto" }}>
      <p style={{ opacity: 0.6, fontSize: 12, letterSpacing: ".12em" }}>CONCEPT · /{variant}</p>
      <h1 style={{ fontSize: 40, fontWeight: 800, marginTop: 8 }}>{NAMES[variant]}</h1>
      <p style={{ marginTop: 12, lineHeight: 1.7, opacity: 0.75 }}>
        이 경로는 <code>{variant}</code> 콘셉트 구현을 위해 예약되어 있습니다. 공용 기반(API · 시뮬레이터 · 폰트 · 공용 컴포넌트)은 연결되어 있습니다.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 20 }}>
        <StatusPill status="RUNNING" label={`실행 중 ${snapshot?.kpis.running ?? "–"}`} />
        <StatusPill status="QUEUED" label={`대기 ${snapshot?.kpis.pending ?? "–"}`} />
        <StatusPill kind="dlq" status="PENDING_REVIEW" label={`DLQ ${snapshot?.kpis.dlqPendingReview ?? "–"}`} />
        <span style={{ fontSize: 13, opacity: 0.7 }}>
          {status} · {fmt.dateTime(now)} KST
        </span>
        <ThemeToggle />
      </div>
      <p style={{ marginTop: 28 }}>
        <Link href="/" style={{ textDecoration: "underline" }}>
          ← 콘셉트 선택으로
        </Link>
      </p>
    </main>
  );
}
