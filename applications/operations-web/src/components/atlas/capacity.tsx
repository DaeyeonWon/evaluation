"use client";
/**
 * S-02 · Language capacity. Cards are live from the SSE `tick` snapshot. Edits go through
 * PATCH /languages/{lang}/capacity (impact analysis from ?dry_run=1, debounced) and
 * PATCH /capacity/global; both persist server-side and are audited.
 */
import clsx from "clsx";
import { AlertTriangle, Check, CheckCircle2, Pause, Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EChart, fmt, useTween } from "@/components/shared";
import { LANG_CODES } from "@/lib/catalog";
import { api, parseAsString, revalidateKey, useApi, useLiveStream, useQueryStates, useSimNow } from "@/lib/client";
import type { CapacityImpact, LangCode, LanguageCapacity, LanguageCapacityPatch } from "@/lib/types";

import { axisX, axisY, baseOpt, opt } from "./chart";
import { OperatorSelect, PermNote, Plate, Sheet, SheetHead, Skeleton, usePerms, useToast, useReducedMotionSafe } from "./ui";

const PARSERS = { lang: parseAsString.withDefault("ko") };
type Fields = { max: number; starts: number; weight: number; paused: boolean };
const FIELD_KEY: Record<keyof Fields, keyof LanguageCapacityPatch> = { max: "max_concurrent", starts: "max_starts_per_minute", weight: "priority_weight", paused: "paused" };
const LABEL: Record<keyof Fields, string> = { max: "maxConcurrent", starts: "maxStartsPerMinute", weight: "priorityWeight", paused: "paused" };

function Tw({ v }: { v: number }) {
  return <>{useTween(v)}</>;
}

function LangCard({ L, sel, onEdit, onPause, now }: { L: LanguageCapacity; sel: boolean; onEdit: () => void; onPause: () => void; now: number }) {
  const tone = { OK: "success", SATURATED: "retry", BACKLOGGED: "retry", PAUSED: "cancelled", DISABLED: "cancelled" }[L.status];
  const cells = Array.from({ length: Math.max(L.max, L.active) }, (_, i) => (i < L.running ? "on" : i < L.active ? "res" : ""));
  const slo = L.p95WaitSloSec;
  return (
    <section className={`plate lg-${L.code}`} style={{ boxShadow: "inset 0 3px 0 var(--lc)", borderColor: sel ? "var(--ink)" : undefined }}>
      <div className="cap">
        <div className="cap-top">
          <div>
            <h3>
              {L.name}{" "}
              <span className="mono muted" style={{ fontSize: 12, fontWeight: 400 }}>
                {L.code} · {L.nameEn}
              </span>
            </h3>
            <span className="st-pill" style={{ ["--tone" as string]: `var(--st-${tone})` }}>
              {tone === "success" ? <CheckCircle2 size={12} aria-hidden /> : tone === "cancelled" ? <Pause size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
              {L.status}
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="cap-frac">
              <Tw v={L.active} />
              <small>/{L.max}</small>
            </div>
            <div className="mono muted" style={{ fontSize: 10.5 }}>
              ACTIVE / MAX
            </div>
          </div>
        </div>
        <div className="slots" role="img" aria-label={`Slot ${L.active}/${L.max}`}>
          {cells.map((c, i) => (
            <i key={i} className={c} />
          ))}
        </div>
        <div className="mono muted" style={{ fontSize: 10.5 }}>
          ■ RUNNING {L.running} · ▨ RESERVED/DISPATCHING {L.reserved + L.dispatching} · RETRY_WAIT {L.retryWait} (Slot 반납)
        </div>
        <div className="stat-row">
          <div>
            <div className="k">Backlog</div>
            <div className={clsx("v", L.backlog >= L.backlogAlertThreshold && "sev-WARNING")}>
              {L.backlog}
              <span className="muted" style={{ fontSize: 10 }}>
                /{L.backlogAlertThreshold}
              </span>
            </div>
          </div>
          <div>
            <div className="k">평균 대기</div>
            <div className="v">{fmt.duration(L.avgWaitSec * 1000, { style: "short" })}</div>
          </div>
          <div title={`p95 대기 · SLO ${slo / 60}분`}>
            <div className="k">p95 · SLO {slo / 60}m</div>
            <div className={clsx("v", L.p95WaitSec > slo && "sev-ERROR")}>
              {fmt.duration(L.p95WaitSec * 1000, { style: "short" })}
              {L.p95WaitSec > slo ? " ▲" : ""}
            </div>
          </div>
        </div>
        <div className="stat-row">
          <div>
            <div className="k">Throughput</div>
            <div className="v">
              {L.throughputPerHour}
              <span className="muted" style={{ fontSize: 10 }}>
                /h
              </span>
            </div>
          </div>
          <div>
            <div className="k">실발화/h</div>
            <div className="v">{fmt.number(L.utterancesPerHour)}</div>
          </div>
          <div>
            <div className="k">가중·시작/분</div>
            <div className="v">
              {L.priorityWeight} · {L.maxStartsPerMinute}
            </div>
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="muted">
            <span>Utilization</span>
            <span className="mono">{fmt.pct(L.utilization, 0)}</span>
          </div>
          <div className="bar" style={{ ["--tc" as string]: "var(--lc)" }}>
            <i style={{ width: `${Math.min(100, L.utilization * 100)}%` }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button className={clsx("btn sm", sel && "primary")} onClick={onEdit}>
            <SlidersHorizontal />
            설정 변경
          </button>
          <button className="btn sm" onClick={onPause}>
            {L.paused ? <Play /> : <Pause />}
            {L.paused ? "재개" : "일시 중지"}
          </button>
          <span className="mono muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
            최장 대기 {L.oldestQueuedAt ? fmt.relative(L.oldestQueuedAt, now) : "없음"}
          </span>
        </div>
      </div>
    </section>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={`${label} 감소`}>
          −
        </button>
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value || 0)))} aria-label={label} />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label={`${label} 증가`}>
          +
        </button>
      </span>
    </label>
  );
}

function useDryRun<T>(key: string, enabled: boolean, run: () => Promise<T>) {
  const [res, setRes] = useState<{ key: string; data?: T; err?: unknown } | null>(null);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const t = setTimeout(() => {
      runRef
        .current()
        .then((data) => alive && setRes({ key, data }))
        .catch((err) => alive && setRes({ key, err }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, enabled]);
  return enabled && res?.key === key ? res : null;
}

function Impact({ items, err }: { items?: CapacityImpact[]; err?: unknown }) {
  return (
    <div className={clsx("note", items?.length ? "warn" : err ? "bad" : "")}>
      <b>기존 실행 영향 분석</b>{" "}
      <span className="mono muted" style={{ fontSize: 10.5 }}>
        (dry_run=1)
      </span>
      <div style={{ marginTop: 4, display: "grid", gap: 3 }}>
        {err ? (
          <div>{err instanceof Error ? err.message : String(err)}</div>
        ) : items ? (
          items.length ? (
            items.map((i, k) => <div key={k}>• {i.message}</div>)
          ) : (
            <div>영향 없음</div>
          )
        ) : (
          <div>값을 바꾸면 서버에서 기존 실행에 미치는 영향을 계산합니다.</div>
        )}
      </div>
    </div>
  );
}

function EditPanel({ L, tfMax, initial }: { L: LanguageCapacity; tfMax: unknown; initial?: Partial<Fields> }) {
  const toast = useToast();
  const { can } = usePerms();
  const cur: Fields = { max: L.max, starts: L.maxStartsPerMinute, weight: L.priorityWeight, paused: L.paused };
  const [patch, setPatch] = useState<Partial<Fields>>(initial ?? {});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const v: Fields = { ...cur, ...patch };
  const changed = (Object.keys(cur) as (keyof Fields)[]).filter((k) => v[k] !== cur[k]);
  const body: LanguageCapacityPatch = {};
  changed.forEach((k) => ((body as Record<string, unknown>)[FIELD_KEY[k]] = v[k]));
  const perm = changed.length === 1 && changed[0] === "paused" ? "language.pause" : "config.write";
  const dry = useDryRun(JSON.stringify([L.code, body]), changed.length > 0, () => api.patchLanguageCapacity(L.code, { ...body, reason: reason || "dry-run" }, { dryRun: true }));
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.patchLanguageCapacity(L.code, { ...body, reason });
      toast.ok(
        <>
          <b>{L.code}</b> 설정을 적용했습니다 · {changed.map((k) => LABEL[k]).join(", ")} · 감사 로그 {r.audit.map((a) => a.audit_id).join(", ")}
        </>,
      );
      setPatch({});
      setReason("");
      revalidateKey("capacity");
      revalidateKey("config");
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Plate id="atlas-cap-edit" title={`${L.name} Capacity 설정 변경`} refText={`PATCH /api/v1/languages/${L.code}/capacity`}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <Stepper label="동시 실행 상한" value={v.max} min={0} max={100} onChange={(x) => setPatch((p) => ({ ...p, max: x }))} />
          <Stepper label="분당 시작 수" value={v.starts} min={1} max={60} onChange={(x) => setPatch((p) => ({ ...p, starts: x }))} />
          <Stepper label="우선순위 가중치" value={v.weight} min={1} max={10} onChange={(x) => setPatch((p) => ({ ...p, weight: x }))} />
          <label className="field">
            <span>Admission</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", height: 31 }}>
              <input type="checkbox" className="switch" checked={v.paused} onChange={(e) => setPatch((p) => ({ ...p, paused: e.target.checked }))} aria-label="일시 중지" />
              <span style={{ fontSize: 12.5 }}>{v.paused ? "일시 중지" : "실행 중"}</span>
            </span>
          </label>
          <div className="mono muted" style={{ fontSize: 11 }}>
            Terraform 기본값 maxConcurrent = {String(tfMax ?? "—")}
            {tfMax != null && tfMax !== L.max ? (
              <>
                {" "}
                · <span style={{ color: "var(--st-retry)" }}>DRIFT</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="diff">
          {changed.length ? (
            changed.map((k) => (
              <span key={k}>
                {LABEL[k]}: <span className="from">{String(cur[k])}</span> → <span className="to">{String(v[k])}</span>
              </span>
            ))
          ) : (
            <span className="muted">변경 없음</span>
          )}
        </div>
        <Impact items={dry?.data?.impact} err={dry?.err} />
        <PermNote perm={perm} />
        <div className="split s-55" style={{ gap: 12 }}>
          <label className="field">
            <span>변경 사유 (필수 · 감사 로그 기록)</span>
            <textarea id="atlas-cap-reason" className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 오후 실발화 업로드 급증, ko p95 대기 SLO 초과 — INC-20261112-01" />
          </label>
          <OperatorSelect />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => (setPatch({}), setReason(""))}>
            <RotateCcw />
            되돌리기
          </button>
          <button className="btn primary" disabled={busy || !changed.length || reason.trim().length < 4 || !can(perm)} onClick={apply}>
            <Check />
            변경 적용
          </button>
        </div>
      </div>
    </Plate>
  );
}

function GlobalPanel({ g, sumL, tf }: { g: { active: number; max: number; utilization: number; maxStartsPerMinute: number; backlog: number }; sumL: number; tf: unknown }) {
  const toast = useToast();
  const { can } = usePerms();
  const [max, setMax] = useState<number | null>(null);
  const [starts, setStarts] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const vMax = max ?? g.max;
  const vStarts = starts ?? g.maxStartsPerMinute;
  const body = { ...(vMax !== g.max ? { max_concurrent: vMax } : {}), ...(vStarts !== g.maxStartsPerMinute ? { max_starts_per_minute: vStarts } : {}) };
  const changed = Object.keys(body).length > 0;
  const dry = useDryRun(JSON.stringify(body), changed, () => api.patchGlobalCapacity({ ...body, reason: "dry-run" }, { dryRun: true }));
  const apply = async () => {
    setBusy(true);
    try {
      await api.patchGlobalCapacity({ ...body, reason });
      toast.ok(`Global 설정을 변경했습니다 · 상한 ${vMax} · 분당 시작 ${vStarts}`);
      setMax(null);
      setStarts(null);
      setReason("");
      revalidateKey("capacity");
      revalidateKey("config");
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Plate title="Global Capacity" refText="global_active < global_limit · PATCH /capacity/global">
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
          <div className="cap-frac">
            <Tw v={g.active} />
            <small>/{g.max}</small>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="bar" style={{ height: 10 }}>
              <i style={{ width: `${Math.min(100, g.utilization * 100)}%` }} />
            </div>
            <div className="mono muted" style={{ fontSize: 11, marginTop: 4 }}>
              Utilization {fmt.pct(g.utilization, 0)} · 분당 시작 {g.maxStartsPerMinute} · Global backlog {g.backlog} · 언어 상한 합 {sumL}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Stepper label="Global 상한" value={vMax} min={1} max={200} onChange={setMax} />
          <Stepper label="분당 시작" value={vStarts} min={1} max={120} onChange={setStarts} />
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span>변경 사유 (필수)</span>
            <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: GPU quota 16 → 24 증설 반영" />
          </label>
          <button className="btn primary" disabled={busy || !changed || reason.trim().length < 4 || !can("config.write")} onClick={apply}>
            <Check />
            Global 적용
          </button>
        </div>
        {changed ? <Impact items={dry?.data?.impact} err={dry?.err} /> : null}
        <div className="note">
          Global 상한을 낮춰도 실행 중인 Pipeline은 종료되지 않습니다. Terraform 기본값은 {String(tf ?? "—")}이며 런타임 값과 다르면 설정 화면의 Drift 목록에 표시됩니다.
        </div>
      </div>
    </Plate>
  );
}

export function CapacityScreen() {
  const [f, setF] = useQueryStates(PARSERS);
  const { snapshot } = useLiveStream();
  const now = useSimNow();
  const toast = useToast();
  const reduced = useReducedMotionSafe();
  const capQ = useApi(["capacity"], () => api.capacity(), { revalidateOn: ["tick"], throttleMs: 3000 });
  const cfg = useApi(["config"], () => api.config(), { revalidateOn: ["audit"] });
  const fm = useApi(["throughput-5m"], () => api.throughput({ granularity: "5m" }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const cap = snapshot?.capacity ?? capQ.data;
  const sel = (LANG_CODES.includes(f.lang as LangCode) ? f.lang : "ko") as LangCode;
  const L = cap?.languages.find((l) => l.code === sel);
  const tf = cfg.data?.terraformDefaults ?? {};
  const sumL = (cap?.languages ?? []).reduce((s, l) => s + l.max, 0);
  const focusEdit = () => setTimeout(() => document.getElementById("atlas-cap-edit")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" }), 50);
  const [pauseReq, setPauseReq] = useState<{ code: string; n: number; paused: boolean } | null>(null);
  const capLangs = useMemo(() => cap?.languages ?? [], [cap]);

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-02 · LANGUAGE CAPACITY"
        title="언어별 Capacity"
        desc={
          <>
            <span className="mono">language_active &lt; language_limit AND global_active &lt; global_limit</span>. 변경은 권한 확인, 사유 기록, 서버 영향 분석(dry run)을 거쳐 PATCH로 저장됩니다.
          </>
        }
        acts={
          <Link className="btn" href="/config">
            <SlidersHorizontal />
            전체 설정
          </Link>
        }
      />
      <div className="grid g4">
        {cap
          ? capLangs.map((l) => (
              <LangCard
                key={l.code}
                L={l}
                sel={sel === l.code}
                now={now}
                onEdit={() => {
                  setF({ lang: l.code });
                  focusEdit();
                }}
                onPause={() => {
                  setF({ lang: l.code });
                  setPauseReq((p) => ({ code: l.code, n: (p?.n ?? 0) + 1, paused: !l.paused }));
                  toast.ok("일시 중지/재개는 아래에서 스위치를 확인하고 사유를 입력한 뒤 \"변경 적용\"을 눌러야 반영됩니다.");
                  focusEdit();
                }}
              />
            ))
          : LANG_CODES.map((c) => (
              <Plate key={c}>
                <Skeleton />
              </Plate>
            ))}
      </div>
      <div className="split s-64">
        {L ? (
          <EditPanel
            key={L.code + (pauseReq?.code === L.code ? "-" + pauseReq.n : "")}
            L={L}
            initial={pauseReq?.code === L.code ? { paused: pauseReq.paused } : undefined}
            tfMax={tf[`languages.${L.code}.maxConcurrent`]}
          />
        ) : (
          <Skeleton />
        )}
        {cap ? <GlobalPanel g={cap.global} sumL={sumL} tf={tf["global.maxConcurrent"]} /> : <Skeleton />}
      </div>
      <div className="split s-55">
        <Plate title="언어별 Throughput 비교" refText="시간당 Pipeline · 최근 1시간 완료">
          <EChart
            className="chart"
            ariaLabel="언어별 처리량"
            option={(t) =>
              opt({
              ...baseOpt(t, reduced),
              legend: { show: false },
              xAxis: axisX(t, capLangs.map((l) => l.code.toUpperCase()), { boundaryGap: true }),
              yAxis: axisY(t),
              series: [
                {
                  name: "Pipeline /h",
                  type: "bar",
                  barWidth: 30,
                  data: capLangs.map((l) => ({ value: l.throughputPerHour, itemStyle: { color: t.lang[l.code] } })),
                  label: { show: true, position: "top", color: t.text, fontFamily: t.mono, fontSize: 11, formatter: (p: { dataIndex: number; value: number }) => `${p.value}/h · ${fmt.number(capLangs[p.dataIndex]?.utterancesPerHour)} utt` },
                },
              ],
            })
            }
          />
        </Plate>
        <Plate title="대기열 깊이 추이" refText="오늘 5분 단위 · Firestore pending_jobs">
          <EChart
            className="chart"
            ariaLabel="대기열 깊이 추이"
            loading={!fm.data}
            option={(t) => {
              const d = fm.data;
              const n = d?.ts.length ?? 0;
              const from = Math.max(0, n - 72);
              return {
                ...baseOpt(t, reduced),
                xAxis: axisX(t, (d?.ts ?? []).slice(from).map((x) => fmt.hm(x))),
                yAxis: axisY(t, { name: "대기 건수" }),
                series: LANG_CODES.map((c) => ({
                  name: c.toUpperCase(),
                  type: "line",
                  showSymbol: false,
                  step: "end",
                  lineStyle: { width: 1.4, color: t.lang[c] },
                  itemStyle: { color: t.lang[c] },
                  areaStyle: { color: t.lang[c], opacity: 0.06 },
                  data: (d?.queueDepth?.[c] ?? []).slice(from),
                })),
              };
            }}
          />
        </Plate>
      </div>
    </Sheet>
  );
}
