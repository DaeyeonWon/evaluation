"use client";
/**
 * S2 — Language capacity. Live slots/backlog/wait from the SSE tick; edits go through
 * PATCH /languages/[lang]/capacity (dry-run for server impact analysis, then apply with reason) and
 * PATCH /capacity/global. Pause/resume uses the Operator-level permission. Changes persist server-side.
 */
import clsx from "clsx";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Check, CheckCircle2, Gauge, Layers, ListOrdered, PauseCircle, PlayCircle, Shield } from "lucide-react";
import { DAG_TEMPLATE, LANG_CODES, STATUS_META } from "@/lib/catalog";
import { api, parseAsString, revalidateKey, useApi, useLiveStream, useQueryStates, useSimNow } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, EChart } from "@/components/shared";
import type { CapacityImpact, LangCode, LanguageCapacity, WorkflowSummary } from "@/lib/types";
import { Pill, Tween, axX, axY, chartBase, dur, eo, langName, pct, shortWf, useAction, useCan, useHere, useToast, wfHref } from "./core";
import { Slots } from "./board";

const PARSERS = { lang: parseAsString };
const ST_TONE: Record<string, string> = { OK: "success", SATURATED: "retry", BACKLOGGED: "failed", PAUSED: "cancelled", DISABLED: "cancelled" };

export function CapacityScreen() {
  const [{ lang }] = useQueryStates(PARSERS);
  const { snapshot } = useLiveStream();
  const { can, role } = useCan();
  const cap = snapshot?.capacity;
  const activeQ = useApi(["lanes-wf-active"], () => api.workflows({ active: true, pageSize: 500 }), { revalidateOn: ["transition"] });
  const orphans = useApi(["lanes-res-orphan"], () => api.reservations({ status: "ORPHANED" }), { revalidateOn: ["tick"], throttleMs: 10000 }).data;
  const cfg = useApi(["lanes-config"], () => api.config(), { revalidateOn: ["audit"] });
  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Screen 2 · Language-aware Scheduling</div>
          <h1>Language Capacity</h1>
          <p>
            언어별 Active/Max Slot, Backlog, 대기 시간과 처리량. 변경은 <b>권한 확인 → 사유 기록 → 영향 분석(서버 dry-run)</b> 후 Runtime Configuration에 반영되고 감사 로그에 남습니다.
          </p>
        </div>
        <div className={`note t-${can("config.write") ? "success" : "retry"}`} style={{ maxWidth: 440 }}>
          <Shield className="i sm" /> 현재 역할 <b>{role}</b> — Capacity 변경 {can("config.write") ? <b>허용</b> : <><b>불가</b> (Admin 필요)</>} · 일시중지/재개 {can("language.pause") ? "허용" : "불가"}.{" "}
          <Link href="/lanes/config#roles">역할 전환</Link>
        </div>
      </div>
      <GlobalPanel cap={cap} />
      {LANG_CODES.map((code) => {
        const c = cap?.languages.find((l) => l.code === code);
        return c ? (
          <LaneCap
            key={code}
            c={c}
            focus={lang === code}
            orphan={orphans?.filter((r) => r.language === code).length ?? 0}
            wfs={activeQ.data?.items.filter((w) => w.language === code) ?? []}
            tf={cfg.data?.terraformDefaults}
          />
        ) : (
          <div key={code} className="skel" style={{ height: 200, marginBottom: 12 }} />
        );
      })}
      <Charts />
    </section>
  );
}

function useDryRun<T>(key: unknown[] | null, fn: () => Promise<T>) {
  return useApi(key, fn, { revalidateOnFocus: false });
}

function ImpactNote({ impact, loading, fallback }: { impact: CapacityImpact[] | undefined; loading: boolean; fallback: React.ReactNode }) {
  if (!impact) return <div className="note">{loading ? "영향 분석 중…" : fallback}</div>;
  const neg = impact.some((i) => i.overLimitBy > 0 || (typeof i.after === "number" && typeof i.before === "number" && i.after < i.before));
  return (
    <div className={clsx("note", neg ? "t-retry" : "t-running")}>
      <b>영향 분석 (서버 dry-run)</b>
      {impact.map((i, k) => (
        <div key={k}>· {i.message}</div>
      ))}
    </div>
  );
}

function GlobalPanel({ cap }: { cap: import("@/lib/types").CapacitySnapshot | undefined }) {
  const { can } = useCan();
  const act = useAction();
  const toast = useToast();
  const g = cap?.global;
  const [draft, setDraft] = useState<{ max: number; spm: number } | null>(null);
  const [reason, setReason] = useState("");
  const max = draft?.max ?? g?.max ?? 0;
  const spm = draft?.spm ?? g?.maxStartsPerMinute ?? 0;
  const dirty = !!g && (max !== g.max || spm !== g.maxStartsPerMinute);
  const body = { ...(g && max !== g.max ? { max_concurrent: max } : {}), ...(g && spm !== g.maxStartsPerMinute ? { max_starts_per_minute: spm } : {}) };
  const dry = useDryRun(dirty ? ["lanes-dry-global", body] : null, () => api.patchGlobalCapacity({ ...body }, { dryRun: true }));
  const apply = async () => {
    if (!reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    const r = await act(() => api.patchGlobalCapacity({ ...body, reason: reason.trim() }), (x) => `Global Capacity → ${x.global.maxConcurrent} slot · ${x.global.maxStartsPerMinute}/분 적용 · 감사 로그 기록`);
    if (r) {
      setDraft(null);
      setReason("");
      revalidateKey("lanes-config");
    }
  };
  const sumMax = cap?.languages.reduce((s, l) => s + l.max, 0) ?? 0;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) auto", gap: 16, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div className="panel-h" style={{ margin: "0 0 6px" }}>
            <h2 className="sec">
              <Layers className="i" />
              Global Capacity
            </h2>
            <span className="eyebrow" style={{ marginLeft: 8, textTransform: "none", letterSpacing: ".02em" }}>
              language_active &lt; language_limit AND global_active &lt; global_limit
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <b className="disp" style={{ fontSize: 52, lineHeight: 1 }}>
              <Tween value={g?.active ?? null} />
            </b>
            <span className="disp muted" style={{ fontSize: 24 }}>
              / {g?.max ?? "—"}
            </span>
            {g && cap && (
              <span className="muted">
                utilization <b>{pct(g.utilization)}</b> · backlog <b>{g.backlog}</b> · 시작 제한 <b>{g.maxStartsPerMinute}</b>/분 · Active Reservation <b>{cap.reservationsActive}</b>
                {cap.reservationsOrphaned ? <span style={{ color: "var(--st-retry)" }}> · Orphaned {cap.reservationsOrphaned}</span> : null} · 언어 합계 {sumMax}
              </span>
            )}
          </div>
          <div style={{ display: "flex", height: 12, borderRadius: 3, overflow: "hidden", background: "var(--sunken)", marginTop: 8 }}>
            {cap?.languages.map((l) => (
              <i key={l.code} title={`${l.name} ${l.active}`} style={{ display: "block", width: `${(l.active / Math.max(1, g!.max)) * 100}%`, background: `var(--l-${l.code})`, transition: "width .6s" }} />
            ))}
          </div>
          <div className="legend" style={{ marginTop: 6 }}>
            {cap?.languages.map((l) => (
              <span key={l.code}>
                <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: `var(--l-${l.code})` }} />
                {l.name} <b className="mono">{l.active}</b>
                <span className="dim">/{l.max}</span>
              </span>
            ))}
            {g && (
              <span>
                <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "var(--sunken)", boxShadow: "inset 0 0 0 1px var(--line-2)" }} />
                여유 <b className="mono">{Math.max(0, g.max - g.active)}</b>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", maxWidth: 300 }}>
          <div className="formrow" style={{ gap: 8 }}>
            <span className="muted">max_concurrent</span>
            <Stepper value={max} min={1} max={200} dirty={!!g && max !== g.max} onChange={(v) => setDraft({ max: v, spm })} label="Global max" />
          </div>
          <div className="formrow" style={{ gap: 8 }}>
            <span className="muted">starts / 분</span>
            <Stepper value={spm} min={1} max={120} dirty={!!g && spm !== g.maxStartsPerMinute} onChange={(v) => setDraft({ max, spm: v })} label="Global starts per minute" />
          </div>
          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 사유 (필수)" style={{ width: 260 }} />
          <div style={{ display: "flex", gap: 6 }}>
            {dirty && (
              <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
                되돌리기
              </button>
            )}
            <button type="button" className="btn pri" disabled={!can("config.write") || !dirty} onClick={() => void apply()}>
              <Check />
              Global 적용
            </button>
          </div>
          {dirty && (
            <div style={{ width: 260 }}>
              <ImpactNote impact={dry.data?.impact} loading={dry.isValidating} fallback={dry.error ? <span style={{ color: "var(--st-failed)" }}>{String((dry.error as Error).message)}</span> : "—"} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, min, max, dirty, onChange, label }: { value: number; min: number; max: number; dirty?: boolean; onChange: (v: number) => void; label: string }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <span className={clsx("stepper", dirty && "dirty")}>
      <button type="button" aria-label={`${label} 감소`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        −
      </button>
      <input type="number" min={min} max={max} value={value} aria-label={label} onChange={(e) => onChange(clamp(+e.target.value || min))} />
      <button type="button" aria-label={`${label} 증가`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
        +
      </button>
    </span>
  );
}

type Draft = { max_concurrent: number; max_starts_per_minute: number; priority_weight: number };

function LaneCap({ c, focus, orphan, wfs, tf }: { c: LanguageCapacity; focus: boolean; orphan: number; wfs: WorkflowSummary[]; tf: Record<string, unknown> | undefined }) {
  const { can, role } = useCan();
  const act = useAction();
  const toast = useToast();
  const here = useHere();
  const now = useSimNow();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => ref.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" }), 150);
    return () => clearTimeout(t);
  }, [focus, reduced]);
  const cur: Draft = { max_concurrent: c.max, max_starts_per_minute: c.maxStartsPerMinute, priority_weight: c.priorityWeight };
  const [draft, setDraft] = useState<Partial<Draft>>({});
  const [reason, setReason] = useState("");
  const val = { ...cur, ...draft };
  const body = Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== cur[k as keyof Draft])) as Partial<Draft>;
  const dirty = Object.keys(body).length > 0;
  const dry = useDryRun(dirty ? ["lanes-dry-lang", c.code, body] : null, () => api.patchLanguageCapacity(c.code, { ...body }, { dryRun: true }));
  const apply = async () => {
    if (!can("config.write")) return toast("권한 없음 — Capacity 변경은 Admin 역할이 필요합니다", "failed");
    if (!reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    const r = await act(
      () => api.patchLanguageCapacity(c.code, { ...body, reason: reason.trim() }),
      () => `${c.name} ${Object.entries(body).map(([k, v]) => `${k}=${v}`).join(", ")} 적용 · Terraform drift 갱신`,
    );
    if (r) {
      setDraft({});
      setReason("");
      revalidateKey("lanes-config");
    }
  };
  const pause = async () => {
    const r = await act(() => api.setLanguagePaused(c.code, !c.paused, reason.trim() || (c.paused ? "운영자 재개" : "운영자 일시중지")));
    if (r) toast(`${c.name} ${r.language.paused ? "일시중지 — 신규 Admission 중단, 실행 중 작업 유지" : "재개"}`, r.language.paused ? "retry" : "success");
  };
  const run = wfs.filter((w) => ["RUNNING", "DISPATCHING", "RESERVED"].includes(w.status)).sort((a, b) => b.progress.pct - a.progress.pct);
  const q = wfs.filter((w) => w.status === "QUEUED").sort((a, b) => b.priority - a.priority || (a.queued_at ?? 0) - (b.queued_at ?? 0));
  const rt = wfs.filter((w) => w.status === "RETRY_WAIT");
  const chip = (w: WorkflowSummary, extra: string) => (
    <Link key={w.workflow_id} className={`capchip t-${STATUS_META[w.status].tone}`} href={wfHref(w.workflow_id, here)} title={`${w.workflow_id} · ${STATUS_META[w.status].label}`}>
      <CatalogIcon name={STATUS_META[w.status].icon} />
      <span className="mono">{shortWf(w.workflow_id)}</span>
      <span className="muted">{extra}</span>
    </Link>
  );
  const tfMax = tf?.[`languages.${c.code}.maxConcurrent`];
  return (
    <div ref={ref} id={`cap-${c.code}`} className={clsx("capl", `L-${c.code}`, focus && "focus")}>
      <div>
        <div className="eyebrow">
          {c.code.toUpperCase()} · {c.nameEn}
        </div>
        <div style={{ fontWeight: 800, fontSize: 19, margin: "2px 0 8px", letterSpacing: "-.02em" }}>{c.name}</div>
        <div className="big">
          <Tween value={c.active} />
          <span> / {c.max}</span>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Pill tone={ST_TONE[c.status] as never} icon={c.status === "OK" ? <CheckCircle2 /> : c.status === "PAUSED" ? <PauseCircle /> : <AlertTriangle />}>
            {c.status}
          </Pill>
          <span className="muted" style={{ fontSize: 11 }}>
            utilization {pct(c.utilization, 0)}
          </span>
        </div>
      </div>
      <div>
        <Slots cap={c} orphan={orphan} lg />
        <div className="capstats">
          {(
            [
              ["Backlog", String(c.backlog), c.backlog > c.backlogAlertThreshold, `임계 ${c.backlogAlertThreshold}`],
              ["평균 대기", dur(c.avgWaitSec * 1000), false, ""],
              ["p95 대기", dur(c.p95WaitSec * 1000), c.p95WaitSec > c.p95WaitSloSec, `SLO ${dur(c.p95WaitSloSec * 1000)}`],
              ["처리량", c.throughputPerHour + "/h", false, `${fmt.number(c.utterancesPerHour)} 발화/h`],
              ["Retry 대기", String(c.retryWait), false, `실행 ${c.running} · 예약 ${c.reserved}`],
            ] as [string, string, boolean, string][]
          ).map(([k, v, bad, s]) => (
            <div key={k}>
              <span>{k}</span>
              <b className={bad ? "bad" : ""}>{v}</b>
              {s && (
                <span className="muted" style={{ fontSize: 10.5 }}>
                  {s}
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11 }} className="muted">
          {c.oldestQueuedAt ? (
            <>
              가장 오래된 대기 {fmt.relative(c.oldestQueuedAt, now)} ({fmt.time(c.oldestQueuedAt)}) · batch {c.batchSize}건 · 완료 1h {c.completedLastHour}건 ·{" "}
              <Link href={`/lanes/explorer?language=${c.code}&status=QUEUED`}>대기열 보기 →</Link>
            </>
          ) : (
            <>대기열 비어 있음 · batch {c.batchSize}건</>
          )}
        </div>
        <div className="capocc">
          <div className="eyebrow">
            슬롯 점유 · {run.length}/{c.max}
          </div>
          <div className="capchips">
            {run.slice(0, 12).map((w) => chip(w, w.status === "RUNNING" ? `${Math.round(w.progress.pct * 100)}% · ${DAG_TEMPLATE.find((d) => d.id === w.current_node)?.id ?? ""}` : STATUS_META[w.status].label))}
            {!run.length && (
              <span className="muted" style={{ fontSize: 11 }}>
                점유 없음
              </span>
            )}
            {run.length > 12 && <span className="muted" style={{ fontSize: 11 }}>+{run.length - 12}</span>}
          </div>
          <div className="eyebrow" style={{ marginTop: 8 }}>
            다음 Admission 후보 <span className="dim">(priority → FIFO)</span>
            {rt.length ? ` · Retry 대기 ${rt.length}` : ""}
          </div>
          <div className="capchips">
            {q.slice(0, 6).map((w, i) => chip(w, `#${i + 1} · P${w.priority} · ${dur(now - (w.queued_at ?? w.created_at))}`))}
            {!q.length && (
              <span className="muted" style={{ fontSize: 11 }}>
                대기열 비어 있음 — 슬롯이 비면 즉시 Admission
              </span>
            )}
            {q.length > 6 && (
              <Link className="muted" style={{ fontSize: 11 }} href={`/lanes/explorer?language=${c.code}&status=QUEUED`}>
                +{q.length - 6} 더 보기
              </Link>
            )}
            {rt.map((w) => chip(w, `재시도 ${w.retry_at ? fmt.relative(w.retry_at, now) : ""}`))}
          </div>
        </div>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Capacity 설정
        </div>
        <div className="formrow">
          <span>동시 실행 상한 {tfMax != null && <span className="dim mono" style={{ fontSize: 10 }}>tf {String(tfMax)}</span>}</span>
          <Stepper value={val.max_concurrent} min={0} max={100} dirty={val.max_concurrent !== c.max} onChange={(v) => setDraft({ ...draft, max_concurrent: v })} label={`${c.name} 동시 실행 상한`} />
        </div>
        <div className="formrow">
          <span>분당 시작 제한</span>
          <Stepper
            value={val.max_starts_per_minute}
            min={1}
            max={60}
            dirty={val.max_starts_per_minute !== c.maxStartsPerMinute}
            onChange={(v) => setDraft({ ...draft, max_starts_per_minute: v })}
            label={`${c.name} 분당 시작 제한`}
          />
        </div>
        <div className="formrow">
          <span>우선순위 가중치 (WRR)</span>
          <Stepper value={val.priority_weight} min={1} max={10} dirty={val.priority_weight !== c.priorityWeight} onChange={(v) => setDraft({ ...draft, priority_weight: v })} label={`${c.name} 우선순위`} />
        </div>
        <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 사유 (필수, 감사 기록)" style={{ margin: "6px 0" }} />
        <div style={{ marginBottom: 8 }}>
          <ImpactNote
            impact={dirty ? dry.data?.impact : undefined}
            loading={dirty && dry.isValidating}
            fallback={
              dirty && dry.error ? (
                <span style={{ color: "var(--st-failed)" }}>{String((dry.error as Error).message)}</span>
              ) : (
                <>
                  영향 분석 · 변경 없음 — 현재 {c.active}/{c.max} 사용, 추가 Admission 가능 <b>{Math.max(0, c.max - c.active)}</b>건{c.backlog ? ` · 대기 ${c.backlog}건` : ""}
                </>
              )
            }
          />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn pri" disabled={!can("config.write") || !dirty} onClick={() => void apply()}>
            <Check />
            적용
          </button>
          <button type="button" className="btn" disabled={!can("language.pause")} onClick={() => void pause()}>
            {c.paused ? <PlayCircle /> : <PauseCircle />}
            {c.paused ? "재개" : "일시중지"}
          </button>
          <button type="button" className="btn ghost" disabled={!dirty} onClick={() => setDraft({})}>
            되돌리기
          </button>
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
          <Shield className="i sm" /> 권한: config.write(Admin) · language.pause(Operator+) · 현재 <b>{role}</b>
        </div>
      </div>
    </div>
  );
}

function Charts() {
  const reduced = !!useReducedMotion();
  const langs = useApi(["lanes-an-langs"], () => api.languages(), { revalidateOn: ["transition"], throttleMs: 10000 });
  const five = useApi(["lanes-tp-5m"], () => api.throughput({ granularity: "5m" }), { revalidateOn: ["tick"], throttleMs: 10000 });
  const { snapshot } = useLiveStream();
  const maxOf = (l: LangCode) => snapshot?.capacity.languages.find((x) => x.code === l)?.max || 1;
  const f = five.data;
  return (
    <div className="grid g3" style={{ marginTop: 14 }}>
      <div className="panel">
        <div className="panel-h">
          <h2 className="sec">
            <BarChart3 className="i" />
            Throughput 비교 <span className="eyebrow">pipelines · 7일 누적</span>
          </h2>
        </div>
        {langs.data ? (
          <EChart
            className="chart sm"
            ariaLabel="언어별 7일 처리량"
            option={(t) =>
              eo({
                ...chartBase(t, reduced),
                legend: { show: false },
                grid: { left: 40, right: 12, top: 14, bottom: 24 },
                tooltip: { ...(chartBase(t, reduced).tooltip as object), trigger: "item" },
                xAxis: axX(t, "category", { data: langs.data!.map((x) => x.name) }),
                yAxis: axY(t),
                series: [
                  {
                    type: "bar",
                    name: "7일 처리 pipelines",
                    barWidth: 22,
                    data: langs.data!.map((x) => ({ value: x.throughput7d, itemStyle: { color: t.lang[x.code], borderRadius: [2, 2, 0, 0] } })),
                    label: { show: true, position: "top", color: t.text, fontSize: 10, fontFamily: t.mono },
                  },
                ],
              })
            }
          />
        ) : (
          <div className="skel chart sm" />
        )}
      </div>
      <div className="panel">
        <div className="panel-h">
          <h2 className="sec">
            <Gauge className="i" />
            Capacity Utilization <span className="eyebrow">오늘 · active / max</span>
          </h2>
        </div>
        {f?.active ? (
          <EChart
            className="chart sm"
            ariaLabel="언어별 utilization 추이"
            option={(t) =>
              eo({
                ...chartBase(t, reduced),
                grid: { left: 40, right: 12, top: 24, bottom: 24 },
                xAxis: axX(t, "time", { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => fmt.hm(v) } }),
                yAxis: axY(t, { max: 1.2, axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => Math.round(v * 100) + "%" } }),
                tooltip: { ...(chartBase(t, reduced).tooltip as object), valueFormatter: (v: unknown) => pct(v as number, 0) },
                series: LANG_CODES.map((l) => ({
                  type: "line",
                  name: langName(l),
                  showSymbol: false,
                  step: "end",
                  lineStyle: { width: 1.4 },
                  itemStyle: { color: t.lang[l] },
                  data: f.ts.map((x, i) => [x, (f.active![l][i] ?? 0) / maxOf(l)]),
                })),
              })
            }
          />
        ) : (
          <div className="skel chart sm" />
        )}
      </div>
      <div className="panel">
        <div className="panel-h">
          <h2 className="sec">
            <ListOrdered className="i" />
            Backlog 추이 <span className="eyebrow">오늘 · 대기열 깊이</span>
          </h2>
        </div>
        {f?.queueDepth ? (
          <EChart
            className="chart sm"
            ariaLabel="언어별 backlog 추이"
            option={(t) =>
              eo({
                ...chartBase(t, reduced),
                grid: { left: 40, right: 12, top: 24, bottom: 24 },
                xAxis: axX(t, "time", { axisLabel: { color: t.muted, fontSize: 10, formatter: (v: number) => fmt.hm(v) } }),
                yAxis: axY(t),
                series: LANG_CODES.map((l) => ({
                  type: "line",
                  name: langName(l),
                  showSymbol: false,
                  smooth: 0.3,
                  lineStyle: { width: 1.4 },
                  itemStyle: { color: t.lang[l] },
                  data: f.ts.map((x, i) => [x, f.queueDepth![l][i]]),
                })),
              })
            }
          />
        ) : (
          <div className="skel chart sm" />
        )}
      </div>
    </div>
  );
}
