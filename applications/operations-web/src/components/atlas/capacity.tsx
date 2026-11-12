"use client";
/**
 * S-02 · Language capacity. Cards are live from the SSE `tick` snapshot. Edits go through
 * PATCH /languages/{lang}/capacity (impact analysis from ?dry_run=1, debounced) and
 * PATCH /capacity/global; both persist server-side and are audited. The history charts follow the
 * global period (GET /capacity/history?range=…, auto granularity).
 */
import clsx from "clsx";
import { AlertTriangle, Check, CheckCircle2, Pause, Play, RotateCcw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EChart, useTween } from "@/components/shared";
import { languageName, statusHelp, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { LANG_CODES } from "@/lib/catalog";
import { api, parseAsString, revalidateKey, useApi, useLiveStream, useQueryStates, useSimNow, useTimeRange } from "@/lib/client";
import type { CapacityImpact, LangCode, LanguageCapacity, LanguageCapacityPatch } from "@/lib/types";

import { axisX, axisY, baseOpt, opt, tooltip } from "./chart";
import { RangeEmpty, RangeTag, useRangeHref } from "./time-range";
import { ErrorNote, OperatorSelect, PermNote, Plate, Sheet, SheetHead, Skeleton, usePerms, useToast, useReducedMotionSafe } from "./ui";

const PARSERS = { lang: parseAsString.withDefault("ko") };
type Fields = { max: number; starts: number; weight: number; paused: boolean };
const FIELD_KEY: Record<keyof Fields, keyof LanguageCapacityPatch> = { max: "max_concurrent", starts: "max_starts_per_minute", weight: "priority_weight", paused: "paused" };
const LABEL: Record<keyof Fields, string> = { max: "maxConcurrent", starts: "maxStartsPerMinute", weight: "priorityWeight", paused: "paused" };
/** capacity PATCHes need `capacity:write` (Operator+) on the server */
const CAP_PERM = "capacity:write";

function Tw({ v }: { v: number }) {
  return <>{useTween(v)}</>;
}

function LangCard({ L, sel, onEdit, onPause, now }: { L: LanguageCapacity; sel: boolean; onEdit: () => void; onPause: () => void; now: number }) {
  const t = useT("capacity");
  const f = useFmt();
  const locale = useLocale();
  const tone = { OK: "success", SATURATED: "retry", BACKLOGGED: "retry", PAUSED: "cancelled", DISABLED: "cancelled" }[L.status];
  const cells = Array.from({ length: Math.max(L.max, L.active) }, (_, i) => (i < L.running ? "on" : i < L.active ? "res" : ""));
  const slo = L.p95WaitSloSec;
  return (
    <section className={`plate lg-${L.code}`} style={{ boxShadow: "inset 0 3px 0 var(--lc)", borderColor: sel ? "var(--ink)" : undefined }}>
      <div className="cap">
        <div className="cap-top">
          <div>
            <h3>
              {languageName(L.code, locale)}{" "}
              <span className="mono muted" style={{ fontSize: 12, fontWeight: 400 }}>
                {L.code}
              </span>
            </h3>
            <span className="st-pill" style={{ ["--tone" as string]: `var(--st-${tone})` }} title={statusHelp("capacity", L.status, locale)}>
              {tone === "success" ? <CheckCircle2 size={12} aria-hidden /> : tone === "cancelled" ? <Pause size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
              {statusLabel("capacity", L.status, locale)}
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
        <div className="slots" role="img" aria-label={t("card.slotsAria", { active: L.active, max: L.max })}>
          {cells.map((c, i) => (
            <i key={i} className={c} />
          ))}
        </div>
        <div className="mono muted" style={{ fontSize: 10.5 }}>
          {t("card.legend", { running: L.running, reserved: L.reserved + L.dispatching, retry: L.retryWait })}
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
            <div className="k">{t("card.avgWait")}</div>
            <div className="v">{f.duration(L.avgWaitSec * 1000, { style: "short" })}</div>
          </div>
          <div title={t("card.p95Title", { min: slo / 60 })}>
            <div className="k">p95 · SLO {slo / 60}m</div>
            <div className={clsx("v", L.p95WaitSec > slo && "sev-ERROR")}>
              {f.duration(L.p95WaitSec * 1000, { style: "short" })}
              {L.p95WaitSec > slo ? " ▲" : ""}
            </div>
          </div>
        </div>
        <div className="stat-row">
          <div>
            <div className="k">{t("card.throughput")}</div>
            <div className="v">
              {L.throughputPerHour}
              <span className="muted" style={{ fontSize: 10 }}>
                /h
              </span>
            </div>
          </div>
          <div>
            <div className="k">{t("card.uttPerHour")}</div>
            <div className="v">{f.number(L.utterancesPerHour)}</div>
          </div>
          <div>
            <div className="k">{t("card.weightStarts")}</div>
            <div className="v">
              {L.priorityWeight} · {L.maxStartsPerMinute}
            </div>
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="muted">
            <span>{t("card.utilization")}</span>
            <span className="mono">{f.pct(L.utilization, 0)}</span>
          </div>
          <div className="bar" style={{ ["--tc" as string]: "var(--lc)" }}>
            <i style={{ width: `${Math.min(100, L.utilization * 100)}%` }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button className={clsx("btn sm", sel && "primary")} onClick={onEdit}>
            <SlidersHorizontal />
            {t("card.edit")}
          </button>
          <button className="btn sm" onClick={onPause}>
            {L.paused ? <Play /> : <Pause />}
            {L.paused ? t("card.resume") : t("card.pause")}
          </button>
          <span className="mono muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
            {t("card.oldest", { ago: L.oldestQueuedAt ? f.relative(L.oldestQueuedAt, now) : t("card.none") })}
          </span>
        </div>
      </div>
    </section>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const t = useT("capacity");
  return (
    <label className="field">
      <span>{label}</span>
      <span className="stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label={t("stepper.dec", { label })}>
          −
        </button>
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value || 0)))} aria-label={label} />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} aria-label={t("stepper.inc", { label })}>
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
  const t = useT("capacity");
  return (
    <div className={clsx("note", items?.length ? "warn" : err ? "bad" : "")}>
      <b>{t("impact.title")}</b>{" "}
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
            <div>{t("impact.none")}</div>
          )
        ) : (
          <div>{t("impact.idle")}</div>
        )}
      </div>
    </div>
  );
}

function EditPanel({ L, tfMax, initial }: { L: LanguageCapacity; tfMax: unknown; initial?: Partial<Fields> }) {
  const t = useT("capacity");
  const locale = useLocale();
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
  const perm = CAP_PERM;
  const dry = useDryRun(JSON.stringify([L.code, body]), changed.length > 0, () => api.patchLanguageCapacity(L.code, { ...body, reason: reason || "dry-run" }, { dryRun: true }));
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.patchLanguageCapacity(L.code, { ...body, reason });
      toast.ok(
        <>
          {t("edit.applied", { lang: L.code, fields: changed.map((k) => LABEL[k]).join(", "), audit: r.audit.map((a) => a.audit_id).join(", ") })}
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
    <Plate id="atlas-cap-edit" title={t("edit.title", { lang: languageName(L.code, locale) })} refText={`PATCH /api/v1/languages/${L.code}/capacity`}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <Stepper label={t("edit.max")} value={v.max} min={0} max={100} onChange={(x) => setPatch((p) => ({ ...p, max: x }))} />
          <Stepper label={t("edit.starts")} value={v.starts} min={1} max={60} onChange={(x) => setPatch((p) => ({ ...p, starts: x }))} />
          <Stepper label={t("edit.weight")} value={v.weight} min={1} max={10} onChange={(x) => setPatch((p) => ({ ...p, weight: x }))} />
          <label className="field">
            <span>Admission</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", height: 31 }}>
              <input type="checkbox" className="switch" checked={v.paused} onChange={(e) => setPatch((p) => ({ ...p, paused: e.target.checked }))} aria-label={t("edit.pauseAria")} />
              <span style={{ fontSize: 12.5 }}>{v.paused ? t("edit.paused") : t("edit.running")}</span>
            </span>
          </label>
          <div className="mono muted" style={{ fontSize: 11 }}>
            {t("edit.tfDefault", { value: String(tfMax ?? "—") })}
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
            <span className="muted">{t("edit.noChange")}</span>
          )}
        </div>
        <Impact items={dry?.data?.impact} err={dry?.err} />
        <PermNote perm={perm} />
        <div className="split s-55" style={{ gap: 12 }}>
          <label className="field">
            <span>{t("edit.reason")}</span>
            <textarea id="atlas-cap-reason" className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("edit.reasonPh")} />
          </label>
          <OperatorSelect />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => (setPatch({}), setReason(""))}>
            <RotateCcw />
            {t("edit.revert")}
          </button>
          <button className="btn primary" disabled={busy || !changed.length || reason.trim().length < 4 || !can(perm)} onClick={apply} title={can(perm) ? undefined : t("edit.needPerm")}>
            <Check />
            {t("edit.apply")}
          </button>
        </div>
      </div>
    </Plate>
  );
}

function GlobalPanel({ g, sumL, tf }: { g: { active: number; max: number; utilization: number; maxStartsPerMinute: number; backlog: number }; sumL: number; tf: unknown }) {
  const t = useT("capacity");
  const f = useFmt();
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
      toast.ok(t("global.applied", { max: vMax, starts: vStarts }));
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
              {t("global.summary", { util: f.pct(g.utilization, 0), starts: g.maxStartsPerMinute, backlog: g.backlog, sum: sumL })}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <Stepper label={t("global.max")} value={vMax} min={1} max={200} onChange={setMax} />
          <Stepper label={t("global.starts")} value={vStarts} min={1} max={120} onChange={setStarts} />
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span>{t("global.reason")}</span>
            <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("global.reasonPh")} />
          </label>
          <button className="btn primary" disabled={busy || !changed || reason.trim().length < 4 || !can(CAP_PERM)} onClick={apply} title={can(CAP_PERM) ? undefined : t("edit.needPerm")}>
            <Check />
            {t("global.apply")}
          </button>
        </div>
        {changed ? <Impact items={dry?.data?.impact} err={dry?.err} /> : null}
        <div className="note">
          {t("global.note", { tf: String(tf ?? "—") })}
        </div>
      </div>
    </Plate>
  );
}

export function CapacityScreen() {
  const t = useT("capacity");
  const f = useFmt();
  const [q, setF] = useQueryStates(PARSERS);
  const { snapshot } = useLiveStream();
  const now = useSimNow();
  const toast = useToast();
  const reduced = useReducedMotionSafe();
  const tr = useTimeRange();
  const rh = useRangeHref();
  const capQ = useApi(["capacity"], () => api.capacity(), { revalidateOn: ["tick"], throttleMs: 3000 });
  const cfg = useApi(["config"], () => api.config(), { revalidateOn: ["audit"] });
  const hist = useApi(["capacity-history", tr.key], () => api.capacityHistory({ ...tr.params, granularity: "auto" }), { revalidateOn: ["tick"], throttleMs: 15000 });
  const cap = snapshot?.capacity ?? capQ.data;
  const sel = (LANG_CODES.includes(q.lang as LangCode) ? q.lang : "ko") as LangCode;
  const L = cap?.languages.find((l) => l.code === sel);
  const tf = cfg.data?.terraformDefaults ?? {};
  const sumL = (cap?.languages ?? []).reduce((s, l) => s + l.max, 0);
  const focusEdit = () => setTimeout(() => document.getElementById("atlas-cap-edit")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" }), 50);
  const [pauseReq, setPauseReq] = useState<{ code: string; n: number; paused: boolean } | null>(null);
  const capLangs = useMemo(() => cap?.languages ?? [], [cap]);
  const H = hist.data;
  const hx = (H?.ts ?? []).map((x) => (H && H.granularity !== "5m" ? `${f.date(x).slice(5)} ${f.hm(x)}` : f.hm(x)));
  const granLabel = H ? t(`history.gran.${H.granularity}`) : "";
  const peak = H ? LANG_CODES.map((c) => [c, Math.max(0, ...(H.queue[c] ?? [0]))] as const) : [];
  const peakActive = H ? Math.max(0, ...H.globalActive) : 0;
  const hEmpty = H && H.ts.length === 0;

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-02 · LANGUAGE CAPACITY"
        title={t("title")}
        desc={
          <>
            <span className="mono">language_active &lt; language_limit AND global_active &lt; global_limit</span>. {t("desc")}
          </>
        }
        acts={
          <Link className="btn" href={rh("/config")}>
            <SlidersHorizontal />
            {t("acts.config")}
          </Link>
        }
      />
      <ErrorNote error={capQ.error ?? hist.error} />
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
                  toast.ok(t("card.pauseHint"));
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
      <div className="cap-hist-head">
        <h2>{t("history.heading")}</h2>
        <RangeTag prefix={granLabel || undefined} />
        {H ? (
          <span className="mono muted cap-hist-stats">
            {t("history.peak", { active: peakActive, limit: H.globalLimit })}
            {peak.map(([c, v]) => ` · ${c.toUpperCase()} ${v}`)}
          </span>
        ) : null}
      </div>
      <div className="split s-55">
        <Plate title={t("history.activeTitle")} refText={t("history.activeRef")}>
          {hEmpty ? (
            <RangeEmpty hint={t("history.emptyHint")} />
          ) : (
            <EChart
              className="chart"
              ariaLabel={t("history.activeTitle")}
              loading={!H}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced),
                  xAxis: axisX(tk, hx),
                  yAxis: axisY(tk, { name: t("history.activeAxis"), minInterval: 1 }),
                  tooltip: tooltip(tk),
                  dataZoom: hx.length > 160 ? [{ type: "inside" }] : undefined,
                  series: [
                    ...LANG_CODES.map((c) => ({
                      name: c.toUpperCase(),
                      type: "line",
                      stack: "act",
                      showSymbol: false,
                      step: "end",
                      lineStyle: { width: 1 },
                      itemStyle: { color: tk.lang[c] },
                      areaStyle: { color: tk.lang[c], opacity: 0.32 },
                      data: H?.active[c] ?? [],
                    })),
                    {
                      name: t("history.globalLimit"),
                      type: "line",
                      showSymbol: false,
                      lineStyle: { width: 1.2, type: "dashed", color: tk.read("--mark") },
                      itemStyle: { color: tk.read("--mark") },
                      data: hx.map(() => H?.globalLimit ?? null),
                    },
                  ],
                })
              }
            />
          )}
        </Plate>
        <Plate title={t("history.queueTitle")} refText={t("history.queueRef")}>
          {hEmpty ? (
            <RangeEmpty hint={t("history.emptyHint")} />
          ) : (
            <EChart
              className="chart"
              ariaLabel={t("history.queueTitle")}
              loading={!H}
              option={(tk) =>
                opt({
                  ...baseOpt(tk, reduced),
                  xAxis: axisX(tk, hx),
                  yAxis: axisY(tk, { name: t("history.queueAxis"), minInterval: 1 }),
                  tooltip: tooltip(tk),
                  dataZoom: hx.length > 160 ? [{ type: "inside" }] : undefined,
                  series: LANG_CODES.map((c) => ({
                    name: c.toUpperCase(),
                    type: "line",
                    showSymbol: false,
                    step: "end",
                    lineStyle: { width: 1.4, color: tk.lang[c] },
                    itemStyle: { color: tk.lang[c] },
                    areaStyle: { color: tk.lang[c], opacity: 0.06 },
                    data: H?.queue[c] ?? [],
                  })),
                })
              }
            />
          )}
        </Plate>
      </div>
      <Plate title={t("compare.title")} right={<span className="live-tag"><span className="live-dot" />LIVE · {t("compare.ref")}</span>}>
        <EChart
          className="chart short"
          ariaLabel={t("compare.title")}
          option={(tk) =>
            opt({
              ...baseOpt(tk, reduced),
              legend: { show: false },
              xAxis: axisX(tk, capLangs.map((l) => l.code.toUpperCase()), { boundaryGap: true }),
              yAxis: axisY(tk),
              series: [
                {
                  name: "Pipeline /h",
                  type: "bar",
                  barWidth: 30,
                  data: capLangs.map((l) => ({ value: l.throughputPerHour, itemStyle: { color: tk.lang[l.code] } })),
                  label: {
                    show: true,
                    position: "top",
                    color: tk.text,
                    fontFamily: tk.mono,
                    fontSize: 11,
                    formatter: (p: { dataIndex: number; value: number }) => t("compare.label", { value: p.value, utt: f.number(capLangs[p.dataIndex]?.utterancesPerHour) }),
                  },
                },
              ],
            })
          }
        />
      </Plate>
    </Sheet>
  );
}
