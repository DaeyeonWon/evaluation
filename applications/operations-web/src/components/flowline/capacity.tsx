"use client";
/**
 * S2 Language Capacity — per-language Active/Max gauges, backlog & wait, throughput, utilization,
 * capacity edit (dry-run impact analysis from the API → reason → confirm → PATCH), pause/resume,
 * priority weight, global capacity and slot reservations. Changes persist in the server simulator.
 */
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, ChevronRight, Database, Info, Lock, Pause, Play, Sliders } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EChart, type ChartTokens } from "@/components/shared";
import { LANG_CODES } from "@/lib/catalog";
import { ApiClientError, api, revalidateKey, useApi, useLiveStream, useSimNow } from "@/lib/client";
import { fmt } from "@/lib/format";
import type { CapacityImpact, CapacitySnapshot, LanguageCapacity, LanguageCapacityPatch } from "@/lib/types";
import { axX, axY, baseOpt } from "./chart";
import { wfHref } from "./nav-store";
import { CapChip } from "./orchestration/home";
import { Empty, Lang, Note, Panel, PermNote, Skel, TweenNum, dur, useApiErrorToast, usePerm, useToast } from "./ui";

export function CapacityScreen() {
  const { snapshot } = useLiveStream();
  const cap = snapshot?.capacity;
  return (
    <div className="screen enter">
      <div className="head-row">
        <div>
          <div className="eyebrow">Screen 2 · Language-aware Scheduler</div>
          <h1 className="h1">Language Capacity</h1>
          <div className="sub">언어별 Active / Max, Backlog, 대기 시간과 Admission 정책. 변경은 사유와 함께 감사 로그에 남고 Runtime Config(drift)에 반영됩니다.</div>
        </div>
      </div>
      {cap ? <GlobalPanel cap={cap} /> : <Skel h={140} />}
      <div className="lang-cards">{cap ? cap.languages.map((l) => <LangCard key={l.code} l={l} globalMax={cap.global.max} />) : LANG_CODES.map((l) => <Skel key={l} h={380} />)}</div>
      <div className="grid g2">
        <ThroughputCompare />
        <UtilBacklog cap={cap} />
      </div>
      <Reservations />
    </div>
  );
}

// ───────────────────────────── gauge ──
function Gauge({ l }: { l: LanguageCapacity }) {
  const r = 58;
  const cx = 75;
  const cy = 80;
  const frac = Math.min(1, l.active / Math.max(1, l.max));
  const arc = (f: number) => {
    const a = Math.PI + f * Math.PI;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  };
  const len = Math.PI * r;
  return (
    <svg viewBox="0 0 150 92" aria-hidden>
      <path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(1)}`} fill="none" stroke="var(--surface-3)" strokeWidth={10} strokeLinecap="round" />
      <path
        d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(1)}`}
        fill="none"
        stroke="var(--lc)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${(frac * len).toFixed(1)} ${len.toFixed(1)}`}
        style={{ transition: "stroke-dasharray .6s var(--ease)", filter: "drop-shadow(0 0 5px color-mix(in srgb,var(--lc) calc(var(--glow)*70%),transparent))", opacity: frac > 0 ? 1 : 0 }}
      />
    </svg>
  );
}

type EditState = { mode: "edit" | "pause"; step: 1 | 2; max: number; spm: number; pw: number; reason: string };

function LangCard({ l, globalMax }: { l: LanguageCapacity; globalMax: number }) {
  const [ed, setEd] = useState<EditState | null>(null);
  return (
    <div className={`lcard lc-${l.code}`}>
      <div className="lcard-h">
        <div className="row" style={{ gap: 8 }}>
          <b>{l.name}</b>
          <Lang code={l.code} />
        </div>
        <CapChip status={l.status} />
      </div>
      <div className="gauge">
        <Gauge l={l} />
        <div className="gv">
          <TweenNum value={l.active} />
          <span style={{ color: "var(--muted)", fontSize: 15 }}>/{l.max}</span>
          <small>Active / Max · {fmt.pct(l.utilization, 0)}</small>
        </div>
      </div>
      <div className="lstats">
        <div>
          <small>실행 · 예약/요청</small>
          <b>
            {l.running} · {l.reserved + l.dispatching}
          </b>
        </div>
        <div>
          <small>Backlog (임계 {l.backlogAlertThreshold})</small>
          <b className={clsx(l.backlog >= l.backlogAlertThreshold && "over")}>
            {l.backlog}
            {l.backlog >= l.backlogAlertThreshold ? " ▲" : ""}
          </b>
        </div>
        <div>
          <small>평균 대기</small>
          <b>{dur(l.avgWaitSec * 1000)}</b>
        </div>
        <div>
          <small>p95 대기 (SLO {dur(l.p95WaitSloSec * 1000)})</small>
          <b className={clsx(l.p95WaitSec > l.p95WaitSloSec && "over")}>{dur(l.p95WaitSec * 1000)}</b>
        </div>
        <div>
          <small>Throughput</small>
          <b>{l.throughputPerHour}/h</b>
        </div>
        <div>
          <small>발화 처리</small>
          <b>{fmt.number(l.utterancesPerHour)}/h</b>
        </div>
        <div>
          <small>우선순위 가중치</small>
          <b>{l.priorityWeight}</b>
        </div>
        <div>
          <small>분당 시작 · Batch</small>
          <b>
            {l.maxStartsPerMinute} · {l.batchSize}
          </b>
        </div>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => setEd({ mode: "edit", step: 1, max: l.max, spm: l.maxStartsPerMinute, pw: l.priorityWeight, reason: "" })} aria-expanded={ed?.mode === "edit"}>
          <Sliders aria-hidden />
          설정 변경
        </button>
        <button className={clsx("btn sm", !l.paused && "danger")} onClick={() => setEd({ mode: "pause", step: 1, max: l.max, spm: l.maxStartsPerMinute, pw: l.priorityWeight, reason: "" })} aria-expanded={ed?.mode === "pause"}>
          {l.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {l.paused ? "재개" : "일시 중지"}
        </button>
        <Link className="btn sm ghost" href={`/flowline/explorer?language=${l.code}&status=QUEUED`}>
          대기열 보기
        </Link>
      </div>
      <AnimatePresence initial={false}>
        {ed && (
          <motion.div key="ed" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
            <Editor l={l} ed={ed} setEd={setEd} globalMax={globalMax} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function useDryRun<T>(key: string | null, run: () => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const t = setTimeout(() => {
      run().then(
        (d) => alive && setState({ key, data: d, error: null }),
        (e) => alive && setState({ key, data: null, error: e instanceof ApiClientError ? e.message : String(e) }),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? { data: state.data, error: state.error } : { data: null, error: null };
}

function ImpactList({ impact, loading, error }: { impact: CapacityImpact[] | null; loading: boolean; error: string | null }) {
  if (error)
    return (
      <Note tone="failed" icon={<AlertTriangle aria-hidden />}>
        {error}
      </Note>
    );
  return (
    <Note icon={<Info aria-hidden />}>
      <div className="stack" style={{ gap: 3 }}>
        <span className="eyebrow">기존 실행 영향 분석 · API dry-run</span>
        {loading && <span className="sub">계산 중…</span>}
        {impact && !impact.length && <span>변경 사항이 없습니다.</span>}
        {impact?.map((x, i) => (
          <div key={i}>{x.message}</div>
        ))}
      </div>
    </Note>
  );
}

function Editor({ l, ed, setEd, globalMax }: { l: LanguageCapacity; ed: EditState; setEd: (e: EditState | null) => void; globalMax: number }) {
  const toast = useToast();
  const onErr = useApiErrorToast();
  const { can } = usePerm();
  const [busy, setBusy] = useState(false);
  const perm = ed.mode === "pause" ? "language.pause" : "config.write";
  const body: LanguageCapacityPatch =
    ed.mode === "pause"
      ? { paused: !l.paused }
      : {
          ...(ed.max !== l.max ? { max_concurrent: ed.max } : {}),
          ...(ed.spm !== l.maxStartsPerMinute ? { max_starts_per_minute: ed.spm } : {}),
          ...(ed.pw !== l.priorityWeight ? { priority_weight: ed.pw } : {}),
        };
  const changed = Object.keys(body).length > 0;
  const key = changed ? `${l.code}:${JSON.stringify(body)}` : null;
  const dry = useDryRun(key, () => api.patchLanguageCapacity(l.code, { ...body, reason: "dry-run" }, { dryRun: true }));
  const diffText =
    ed.mode === "pause"
      ? `${l.name} ${l.paused ? "재개" : "일시 중지"}`
      : [ed.max !== l.max && `maxConcurrent ${l.max}→${ed.max}`, ed.spm !== l.maxStartsPerMinute && `maxStartsPerMinute ${l.maxStartsPerMinute}→${ed.spm}`, ed.pw !== l.priorityWeight && `priorityWeight ${l.priorityWeight}→${ed.pw}`]
          .filter(Boolean)
          .join(", ") || "변경 없음";
  const next = () => {
    if (!ed.reason.trim()) {
      toast("변경 사유를 입력하세요", "retry");
      return;
    }
    if (!changed) {
      toast("변경된 값이 없습니다", "retry");
      return;
    }
    setEd({ ...ed, step: 2, reason: ed.reason.trim() });
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.patchLanguageCapacity(l.code, { ...body, reason: ed.reason });
      toast(
        <>
          {l.name} {ed.mode === "pause" ? (l.paused ? "재개됨" : "일시 중지됨") : "Capacity 변경"} · 감사 로그 <span className="mono">{r.audit[0]?.audit_id ?? ""}</span>
          {r.impact[0] ? <div className="sub">{r.impact[0].message}</div> : null}
        </>,
        "success",
      );
      revalidateKey("capacity");
      revalidateKey("config");
      setEd(null);
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="editor">
      {ed.mode === "pause" ? (
        <Note tone="retry" icon={l.paused ? <Play aria-hidden /> : <Pause aria-hidden />}>
          {l.paused ? (
            "재개하면 대기 중인 배치가 다시 admission 대상이 됩니다."
          ) : (
            <>
              일시 중지하면 <b>신규 admission만</b> 멈춥니다. 실행 중 {l.active}건은 끝까지 진행되고 대기열 {l.backlog}건은 보존됩니다.
            </>
          )}
        </Note>
      ) : (
        <div className="row3">
          <label className="field">
            <span>maxConcurrent (≤ global {globalMax})</span>
            <input className="inp mono" type="number" min={0} max={Math.min(100, globalMax)} value={ed.max} disabled={ed.step === 2} onChange={(e) => setEd({ ...ed, max: +e.target.value })} />
          </label>
          <label className="field">
            <span>maxStartsPerMinute</span>
            <input className="inp mono" type="number" min={1} max={60} value={ed.spm} disabled={ed.step === 2} onChange={(e) => setEd({ ...ed, spm: +e.target.value })} />
          </label>
          <label className="field">
            <span>priorityWeight</span>
            <input className="inp mono" type="number" min={1} max={10} value={ed.pw} disabled={ed.step === 2} onChange={(e) => setEd({ ...ed, pw: +e.target.value })} />
          </label>
        </div>
      )}
      {changed && <ImpactList impact={dry.data?.impact ?? null} loading={!dry.data && !dry.error} error={dry.error} />}
      <label className="field">
        <span>변경 사유 (필수 · 감사 로그 기록)</span>
        <textarea className="inp" rows={2} value={ed.reason} disabled={ed.step === 2} onChange={(e) => setEd({ ...ed, reason: e.target.value })} placeholder="예: 오후 실발화 업로드 급증 대응" />
      </label>
      <PermNote perm={perm} label={ed.mode === "pause" ? "언어 일시 중지/재개" : "Capacity 변경"} />
      {ed.step === 2 ? (
        <div className="confirm">
          <div className="steps">
            <span>1 입력</span>
            <ChevronRight aria-hidden />
            <b className="on">2 확인</b>
          </div>
          <div style={{ fontSize: 12.5 }}>
            <b>{l.name}</b> <span className="mono">{diffText}</span> · 사유 “{ed.reason}”
          </div>
          <div className="row end">
            <button className="btn sm" onClick={() => setEd({ ...ed, step: 1 })}>
              수정
            </button>
            <button className="btn sm primary" onClick={apply} disabled={busy || !can(perm)}>
              <Check aria-hidden />
              적용
            </button>
          </div>
        </div>
      ) : (
        <div className="row end">
          <button className="btn sm" onClick={() => setEd(null)}>
            닫기
          </button>
          <button className="btn sm primary" onClick={next} disabled={!can(perm) || !!dry.error}>
            검토 <ChevronRight aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── global ──
function GlobalPanel({ cap }: { cap: CapacitySnapshot }) {
  const g = cap.global;
  const toast = useToast();
  const onErr = useApiErrorToast();
  const { can } = usePerm();
  const [ge, setGe] = useState<{ max: number; spm: number; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const body = ge ? { ...(ge.max !== g.max ? { max_concurrent: ge.max } : {}), ...(ge.spm !== g.maxStartsPerMinute ? { max_starts_per_minute: ge.spm } : {}) } : {};
  const changed = Object.keys(body).length > 0;
  const dry = useDryRun(ge && changed ? JSON.stringify(body) : null, () => api.patchGlobalCapacity({ ...body, reason: "dry-run" }, { dryRun: true }));
  const sumMax = cap.languages.reduce((a, l) => a + l.max, 0);
  const apply = async () => {
    if (!ge) return;
    if (!ge.reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    if (!changed) return toast("변경된 값이 없습니다", "retry");
    setBusy(true);
    try {
      const r = await api.patchGlobalCapacity({ ...body, reason: ge.reason.trim() });
      toast(`Global Capacity ${r.global.maxConcurrent} · 분당 ${r.global.maxStartsPerMinute} 로 변경 · 감사 로그 기록`, "success");
      revalidateKey("capacity");
      revalidateKey("config");
      setGe(null);
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Global Capacity"
      icon={<Database aria-hidden />}
      right={
        <button className="btn sm" onClick={() => setGe(ge ? null : { max: g.max, spm: g.maxStartsPerMinute, reason: "" })} aria-expanded={!!ge}>
          <Sliders aria-hidden />
          상한 변경
        </button>
      }
      bodyClassName="stack"
      bodyStyle={{ gap: 12 }}
    >
      <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
        <span className="big-rate">
          <TweenNum value={g.active} />
          <span style={{ fontSize: 20, color: "var(--muted)" }}>/{g.max}</span>
        </span>
        <span className="sub">
          Utilization <span className="mono">{fmt.pct(g.utilization, 1)}</span> · 분당 시작 <span className="mono">{g.maxStartsPerMinute}</span> · 전체 Backlog <span className="mono">{g.backlog}</span> · ACTIVE 예약{" "}
          <span className="mono">{cap.reservationsActive}</span>
          {cap.reservationsOrphaned ? (
            <>
              {" "}
              · <b style={{ color: "var(--st-retry)" }}>ORPHANED {cap.reservationsOrphaned}</b>
            </>
          ) : null}{" "}
          · 언어별 상한 합계 <span className="mono">{sumMax}</span>
        </span>
      </div>
      <div className="passbar" style={{ height: 12 }}>
        {cap.languages.map((l) => (
          <i key={l.code} className={`lc-${l.code}`} style={{ width: `${((l.active / Math.max(1, g.max)) * 100).toFixed(2)}%`, background: "var(--lc)" }} title={`${l.code} ${l.active}`} />
        ))}
      </div>
      <div className="sub row" style={{ gap: 12 }}>
        {cap.languages.map((l) => (
          <span key={l.code} className="row" style={{ gap: 4 }}>
            <Lang code={l.code} /> <span className="mono">{l.active}/{l.max}</span>
          </span>
        ))}
        <span>
          여유 <span className="mono">{g.max - g.active}</span>
        </span>
      </div>
      <AnimatePresence initial={false}>
        {ge && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <div className="editor">
              <div className="row3">
                <label className="field">
                  <span>global.maxConcurrent (≥ 언어 최대, ≤ 200)</span>
                  <input className="inp mono" type="number" min={1} max={200} value={ge.max} onChange={(e) => setGe({ ...ge, max: +e.target.value })} />
                </label>
                <label className="field">
                  <span>global.maxStartsPerMinute</span>
                  <input className="inp mono" type="number" min={1} max={120} value={ge.spm} onChange={(e) => setGe({ ...ge, spm: +e.target.value })} />
                </label>
              </div>
              {changed && <ImpactList impact={dry.data?.impact ?? null} loading={!dry.data && !dry.error} error={dry.error} />}
              <label className="field">
                <span>변경 사유 (필수)</span>
                <input className="inp" value={ge.reason} onChange={(e) => setGe({ ...ge, reason: e.target.value })} placeholder="예: ko 상향에 맞춰 Global 확장" />
              </label>
              <PermNote perm="config.write" label="Capacity 변경" />
              <div className="row end">
                <button className="btn sm" onClick={() => setGe(null)}>
                  닫기
                </button>
                <button className="btn sm primary" onClick={apply} disabled={busy || !can("config.write") || !!dry.error}>
                  <Check aria-hidden />
                  적용
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

// ───────────────────────────── charts ──
function ThroughputCompare() {
  const { data } = useApi(["throughput", "24h"], () => api.throughput({ range: "24h" }), { revalidateOn: ["tick"], throttleMs: 60000 });
  const option = useMemo(
    () =>
      data
        ? (t: ChartTokens) =>
            baseOpt(t, {
              xAxis: axX(t, data.ts.map((x) => fmt.hm(x)), { axisLabel: { color: t.muted, fontSize: 10.5, interval: 3, fontFamily: t.mono } }),
              yAxis: axY(t),
              series: LANG_CODES.map((l) => ({ type: "bar" as const, name: l.toUpperCase(), stack: "a", barWidth: "60%", itemStyle: { color: t.lang[l] }, data: data.byLanguage[l] })),
            })
        : null,
    [data],
  );
  return (
    <Panel title="언어별 Throughput 비교" right={<span className="sub">최근 24시간 · pipeline/h</span>}>
      {option ? <EChart className="chart" style={{ height: 410 }} option={option} ariaLabel="언어별 시간당 Throughput" /> : <Skel h={410} />}
    </Panel>
  );
}

function UtilBacklog({ cap }: { cap: CapacitySnapshot | undefined }) {
  const { data } = useApi(["throughput", "5m"], () => api.throughput({ granularity: "5m" }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const maxSig = cap ? cap.languages.map((l) => l.max).join(",") : "";
  const opts = useMemo(() => {
    if (!data || !maxSig) return null;
    const maxes = Object.fromEntries(LANG_CODES.map((l, i) => [l, +maxSig.split(",")[i] || 1]));
    const B = 3;
    const nb = Math.ceil(data.ts.length / B);
    const labels = Array.from({ length: nb }, (_, i) => fmt.hm(data.ts[i * B]));
    const bucket = (arr: number[] | undefined) =>
      Array.from({ length: nb }, (_, i) => {
        const xs = (arr ?? []).slice(i * B, i * B + B).filter((v) => v != null);
        return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null;
      });
    const util = (t: ChartTokens) =>
      baseOpt(t, {
        grid: { left: 8, right: 14, top: 26, bottom: 4, containLabel: true },
        tooltip: { ...(baseOpt(t, {}).tooltip as object), valueFormatter: (v: unknown) => (v == null ? "-" : v + "%") },
        xAxis: axX(t, labels, { boundaryGap: false, axisLabel: { color: t.muted, fontSize: 10.5, interval: 7, fontFamily: t.mono, alignMinLabel: "left", alignMaxLabel: "right" } }),
        yAxis: axY(t, { min: 0, max: 100, splitNumber: 2, axisLabel: { color: t.muted, fontSize: 10.5, fontFamily: t.mono, formatter: "{value}%" } }),
        series: LANG_CODES.map((l) => ({
          type: "line" as const,
          name: l.toUpperCase(),
          showSymbol: false,
          smooth: 0.35,
          lineStyle: { width: 1.6, color: t.lang[l] },
          itemStyle: { color: t.lang[l] },
          data: bucket(data.active?.[l]).map((v) => (v == null ? null : Math.min(100, Math.round((v / maxes[l]) * 100)))),
        })),
      });
    const bl = (t: ChartTokens) =>
      baseOpt(t, {
        legend: { show: false },
        grid: { left: 8, right: 14, top: 8, bottom: 4, containLabel: true },
        tooltip: { ...(baseOpt(t, {}).tooltip as object), valueFormatter: (v: unknown) => (v == null ? "-" : v + "건") },
        xAxis: axX(t, labels, { axisLabel: { color: t.muted, fontSize: 10.5, interval: 7, fontFamily: t.mono, alignMinLabel: "left", alignMaxLabel: "right" } }),
        yAxis: axY(t, { minInterval: 1, splitNumber: 2 }),
        series: LANG_CODES.map((l) => ({ type: "bar" as const, name: l.toUpperCase(), stack: "bl", barWidth: "70%", itemStyle: { color: t.lang[l] }, data: bucket(data.queueDepth?.[l]).map((v) => (v == null ? null : Math.round(v * 10) / 10)) })),
      });
    return { util, bl };
  }, [data, maxSig]);
  return (
    <Panel title="Capacity Utilization · Backlog" right={<span className="sub">오늘 · 15분 평균</span>} bodyClassName="stack" bodyStyle={{ gap: 6 }}>
      <div className="eyebrow">Utilization · Active / Max (%)</div>
      {opts ? <EChart className="chart short" option={opts.util} ariaLabel="언어별 Capacity 사용률" /> : <Skel h={180} />}
      <div className="eyebrow">Backlog · 대기 배치 수 (언어별 누적)</div>
      {opts ? <EChart className="chart short" option={opts.bl} ariaLabel="언어별 Backlog" /> : <Skel h={180} />}
    </Panel>
  );
}

function Reservations() {
  const now = useSimNow();
  const { data } = useApi(["reservations", "open"], () => api.reservations({ status: ["ACTIVE", "ORPHANED"] }), { revalidateOn: ["transition"], throttleMs: 3000 });
  const list = useMemo(() => [...(data ?? [])].sort((a, b) => (a.status === "ORPHANED" ? -1 : 0) - (b.status === "ORPHANED" ? -1 : 0) || b.created_at - a.created_at), [data]);
  return (
    <Panel title="Slot Reservation" icon={<Lock aria-hidden />} right={<span className="sub">ACTIVE / ORPHANED · fencing token · lease</span>}>
      {!data ? (
        <Skel h={200} />
      ) : !list.length ? (
        <Empty>활성 예약이 없습니다</Empty>
      ) : (
        <div className="tbl-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="tbl fluid">
            <thead>
              <tr>
                <th>Reservation</th>
                <th>상태</th>
                <th>Workflow</th>
                <th>언어</th>
                <th>Attempt</th>
                <th className="r">Fencing</th>
                <th>Lease 만료</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.reservation_id}>
                  <td className="mono nw">{r.reservation_id}</td>
                  <td>
                    <span className={`pill sm t-${r.status === "ACTIVE" ? "running" : "retry"}`}>
                      {r.status === "ACTIVE" ? <Lock aria-hidden /> : <AlertTriangle aria-hidden />}
                      {r.status}
                    </span>
                  </td>
                  <td className="nw">
                    <Link className="idlink" href={wfHref(r.workflow_id, { screen: "capacity" })}>
                      {r.workflow_id}
                    </Link>
                  </td>
                  <td>
                    <Lang code={r.language} />
                  </td>
                  <td className="mono">{r.attempt}</td>
                  <td className="r mono">{r.fencing_token}</td>
                  <td className="mono nw">
                    {fmt.time(r.lease_expires_at)} <span className="sub">{fmt.relative(r.lease_expires_at, now)}</span>
                  </td>
                  <td className="sub">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
