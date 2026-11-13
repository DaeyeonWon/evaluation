"use client";
/**
 * S-06 · System configuration. Every change is PATCH /api/v1/config (or the capacity endpoints)
 * with a mandatory reason; Terraform-default vs runtime drift (changedBy/changedAt/reason come from
 * the API) and the audit trail (ranged by the global period) are live.
 */
import clsx from "clsx";
import { Check, GitBranch, History, SlidersHorizontal, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CatalogIcon, LangBadge, TonePill } from "@/components/shared";
import { failureCategoryLabel, failureCategoryPolicy, languageName, statusHelp, statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { FAILURE_CATEGORY_META } from "@/lib/catalog";
import { api, revalidateKey, useApi, useTimeRange } from "@/lib/client";
import { reasonText } from "@/lib/reason";
import type { AppConfig, AuditResult, ConfigPatch, FailureCategory, Tone } from "@/lib/types";
import { RangeEmpty, RangeTag, useRangeHref } from "./time-range";
import { ErrorNote, PermNote, Plate, Sheet, SheetHead, Skeleton, opName, usePerms, useToast } from "./ui";

type OperatorsWithRoles = Awaited<ReturnType<typeof api.operators>> & {
  roles?: { name: string; label?: string; description?: string; permissions: string[] }[];
  permissions?: { key: string; label: string }[];
};

const RESULT_TONE: Record<AuditResult, Tone> = { success: "success", denied: "failed", error: "retry" };

/** PATCH /config needs `config:write` (Admin) on the server */
const CFG_PERM = "config:write";

function useSave() {
  const toast = useToast();
  const t = useT("config");
  const [busy, setBusy] = useState(false);
  const save = async (body: ConfigPatch, reason: string, okMsg: string) => {
    if (reason.trim().length < 4) {
      toast.err(t("save.reasonShort"));
      return false;
    }
    setBusy(true);
    try {
      const r = await api.patchConfig({ ...body, reason });
      toast.ok(
        <>
          {t("save.ok", { msg: okMsg, changed: r.changed.join(", ") || t("save.none"), audit: r.audit.map((a) => a.audit_id).join(", ") })}
        </>,
      );
      revalidateKey("config");
      revalidateKey("audit");
      return true;
    } catch (e) {
      toast.err(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}

function RetryPanel({ c }: { c: AppConfig }) {
  const t = useT("config");
  const locale = useLocale();
  const { save, busy } = useSave();
  const { can } = usePerms();
  const [b0, setB0] = useState<number | null>(null);
  const [b1, setB1] = useState<number | null>(null);
  const [mr, setMr] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const v0 = b0 ?? c.retry.backoffSeconds[0];
  const v1 = b1 ?? c.retry.backoffSeconds[1];
  const vm = mr ?? c.retry.maxRetries;
  const changed = v0 !== c.retry.backoffSeconds[0] || v1 !== c.retry.backoffSeconds[1] || vm !== c.retry.maxRetries;
  return (
    <Plate title={t("retry.title")} refText={t("retry.ref", { n: c.retry.maxAttempts })}>
      <div style={{ display: "grid", gap: 12 }}>
        <pre className="code">{`retry:
  max_retries: ${c.retry.maxRetries}        # ${t("retry.comment", { n: c.retry.maxRetries })}
  backoff_seconds: [${c.retry.backoffSeconds.join(", ")}]
  non_retryable: [${c.retry.nonRetryable.join(", ")}]
  limited_retry: ${JSON.stringify(c.retry.limitedRetry)}`}</pre>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field">
            <span>max_retries</span>
            <input className="in mono" type="number" min={0} max={5} value={vm} onChange={(e) => setMr(+e.target.value)} style={{ width: 84 }} />
          </label>
          <label className="field">
            <span>{t("retry.backoff1")}</span>
            <input className="in mono" type="number" min={1} max={3600} value={v0} onChange={(e) => setB0(+e.target.value)} style={{ width: 100 }} />
          </label>
          <label className="field">
            <span>{t("retry.backoff2")}</span>
            <input className="in mono" type="number" min={1} max={3600} value={v1} onChange={(e) => setB1(+e.target.value)} style={{ width: 100 }} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span>{t("reason")}</span>
            <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("retry.reasonPh")} />
          </label>
          <button
            className="btn primary"
            disabled={busy || !changed || !can(CFG_PERM)}
            title={can(CFG_PERM) ? undefined : t("needPerm")}
            onClick={async () => {
              if (await save({ retry: { maxRetries: vm, backoffSeconds: [v0, v1] } }, reason, t("retry.saved", { b0: v0, b1: v1 }))) {
                setB0(null);
                setB1(null);
                setMr(null);
                setReason("");
              }
            }}
          >
            <Check />
            {t("apply")}
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t("retry.cols.category")}</th>
                <th>{t("retry.cols.policy")}</th>
                <th>Retry</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(FAILURE_CATEGORY_META) as FailureCategory[]).map((k) => {
                const m = FAILURE_CATEGORY_META[k];
                return (
                  <tr key={k}>
                    <td>
                      <CatalogIcon name={m.icon} size={13} /> {failureCategoryLabel(k, locale)}{" "}
                      <span className="mono muted" style={{ fontSize: 10.5 }}>
                        {k}
                      </span>
                    </td>
                    <td className="cellwrap" style={{ minWidth: 200 }}>
                      {failureCategoryPolicy(k, locale)}
                    </td>
                    <td>
                      {m.retryable ? (
                        <TonePill tone="retry" icon="rotate-ccw">
                          {m.maxRetries != null ? t("retry.times", { count: m.maxRetries }) : t("retry.upTo", { n: c.retry.maxRetries })}
                        </TonePill>
                      ) : (
                        <TonePill tone="dlq" icon="archive-x">
                          {t("retry.straightDlq")}
                        </TonePill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Plate>
  );
}

function TimeoutPanel({ c }: { c: AppConfig }) {
  const t = useT("config");
  const c8 = useT("common");
  const { save, busy } = useSave();
  const { can } = usePerms();
  const tf = c.terraformDefaults;
  const [wt, setWt] = useState<number | null>(null);
  const [pt, setPt] = useState<number | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [aging, setAging] = useState<boolean | null>(null);
  const [boost, setBoost] = useState<number | null>(null);
  const [maxBoost, setMaxBoost] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const v = {
    wt: wt ?? c.workflowTimeoutMin,
    pt: pt ?? c.pipelineTimeoutMin,
    mode: mode ?? c.queuePolicy.mode,
    aging: aging ?? c.queuePolicy.aging.enabled,
    boost: boost ?? c.queuePolicy.aging.boostPerMinutes,
    maxBoost: maxBoost ?? c.queuePolicy.aging.maxBoost,
  };
  const body: ConfigPatch = {};
  if (v.wt !== c.workflowTimeoutMin) body.workflowTimeoutMin = v.wt;
  if (v.pt !== c.pipelineTimeoutMin) body.pipelineTimeoutMin = v.pt;
  if (v.mode !== c.queuePolicy.mode || v.aging !== c.queuePolicy.aging.enabled || v.boost !== c.queuePolicy.aging.boostPerMinutes || v.maxBoost !== c.queuePolicy.aging.maxBoost)
    body.queuePolicy = { mode: v.mode, aging: { enabled: v.aging, boostPerMinutes: v.boost, maxBoost: v.maxBoost } };
  const changed = Object.keys(body).length > 0;
  const reset = () => {
    setWt(null);
    setPt(null);
    setMode(null);
    setAging(null);
    setBoost(null);
    setMaxBoost(null);
    setReason("");
  };
  return (
    <Plate title={t("timeout.title")} refText="PATCH /api/v1/config">
      <div style={{ display: "grid", gap: 12 }}>
        <div className="filters">
          <label className="field">
            <span>{t("timeout.workflow")}</span>
            <input className="in mono" type="number" min={5} max={360} value={v.wt} onChange={(e) => setWt(+e.target.value)} />
          </label>
          <label className="field">
            <span>{t("timeout.pipeline")}</span>
            <input className="in mono" type="number" min={5} max={360} value={v.pt} onChange={(e) => setPt(+e.target.value)} />
          </label>
          <label className="field">
            <span>{t("timeout.queue")}</span>
            <select className="in" value={v.mode} onChange={(e) => setMode(e.target.value)}>
              <option>PRIORITY_THEN_FIFO</option>
              <option>FIFO</option>
            </select>
          </label>
          <label className="field">
            <span>Aging</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", height: 31 }}>
              <input type="checkbox" className="switch" checked={v.aging} onChange={(e) => setAging(e.target.checked)} aria-label={t("timeout.agingAria")} />
              <span style={{ fontSize: 12 }}>{v.aging ? c8("bool.on") : c8("bool.off")}</span>
            </span>
          </label>
          <label className="field">
            <span>{t("timeout.agingEvery")}</span>
            <input className="in mono" type="number" min={1} value={v.boost} onChange={(e) => setBoost(+e.target.value)} disabled={!v.aging} />
          </label>
          <label className="field">
            <span>{t("timeout.maxBoost")}</span>
            <input className="in mono" type="number" min={0} value={v.maxBoost} onChange={(e) => setMaxBoost(+e.target.value)} disabled={!v.aging} />
          </label>
        </div>
        <dl className="kv">
          <dt>Workflow timeout</dt>
          <dd className="mono">
            {t("min", { n: c.workflowTimeoutMin })}{" "}
            {tf.workflowTimeoutMin !== c.workflowTimeoutMin ? <span className="sev-WARNING">{t("timeout.tfDrift", { n: String(tf.workflowTimeoutMin) })}</span> : null}
          </dd>
          <dt>PipelineJob timeout</dt>
          <dd className="mono">{t("timeout.pipelineNote", { n: c.pipelineTimeoutMin })}</dd>
          <dt>Reservation lease</dt>
          <dd className="mono">{t("timeout.leaseNote", { n: c.reservationLeaseMin })}</dd>
          <dt>{t("timeout.crossLang")}</dt>
          <dd className="mono">{c.queuePolicy.crossLanguage}</dd>
          <dt>{t("timeout.order")}</dt>
          <dd>{t("timeout.orderValue")}</dd>
        </dl>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span>{t("reason")}</span>
            <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("timeout.reasonPh")} />
          </label>
          <button className="btn" onClick={reset} disabled={!changed}>
            {t("revert")}
          </button>
          <button
            className="btn primary"
            disabled={busy || !changed || !can(CFG_PERM)}
            title={can(CFG_PERM) ? undefined : t("needPerm")}
            onClick={async () => (await save(body, reason, t("timeout.saved"))) && reset()}
          >
            <Check />
            {t("apply")}
          </button>
        </div>
      </div>
    </Plate>
  );
}

function VersionPanel({ c }: { c: AppConfig }) {
  const t = useT("config");
  const locale = useLocale();
  const { save, busy } = useSave();
  const { can } = usePerms();
  const [def, setDef] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<Record<string, number> | null>(null);
  const [reason, setReason] = useState("");
  const tr = traffic ?? Object.fromEntries(c.pipelineVersionDetails.map((v) => [v.version, v.trafficPct]));
  const total = Object.values(tr).reduce((a, b) => a + b, 0);
  const vDef = def ?? c.defaultPipelineVersion;
  const body: ConfigPatch = {};
  if (vDef !== c.defaultPipelineVersion) body.defaultPipelineVersion = vDef;
  if (traffic && c.pipelineVersionDetails.some((v) => traffic[v.version] !== v.trafficPct)) body.versionTraffic = traffic;
  const changed = Object.keys(body).length > 0;
  return (
    <Plate flush title={t("version.title")} refText={t("version.ref", { v: c.defaultPipelineVersion })}>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Version</th>
              <th>{t("version.cols.status")}</th>
              <th className="r">{t("version.cols.traffic")}</th>
              <th>{t("version.cols.model")}</th>
              <th>Template</th>
              <th>{t("version.cols.notes")}</th>
            </tr>
          </thead>
          <tbody>
            {c.pipelineVersionDetails.map((v) => (
              <tr key={v.version}>
                <td className="idc">
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name="atlas-defver" checked={vDef === v.version} disabled={v.status === "DEPRECATED"} onChange={() => setDef(v.version)} aria-label={t("version.defaultAria", { v: v.version })} />
                    {v.version}
                  </label>
                </td>
                <td>
                  <span title={statusHelp("version", v.status, locale)}>
                    <TonePill tone={v.status === "STABLE" ? "success" : v.status === "CANARY" ? "running" : "cancelled"}>{statusLabel("version", v.status, locale)}</TonePill>
                  </span>
                </td>
                <td className="r">
                  <input
                    className="in mono"
                    type="number"
                    min={0}
                    max={100}
                    style={{ width: 70, height: 26, textAlign: "right" }}
                    value={tr[v.version] ?? 0}
                    disabled={v.status === "DEPRECATED"}
                    aria-label={t("version.trafficAria", { v: v.version })}
                    onChange={(e) => setTraffic({ ...tr, [v.version]: Math.max(0, Math.min(100, +e.target.value || 0)) })}
                  />
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {v.modelUnderTest}
                  <br />
                  <span className="muted">{v.judgeModel}</span>
                </td>
                <td className="mono muted cellwrap" style={{ fontSize: 10.5, minWidth: 190 }}>
                  {v.templateUri}
                </td>
                <td className="wrap" style={{ fontSize: 12 }}>
                  {v.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="body" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", borderTop: "1px solid var(--rule-2)" }}>
        <span className={clsx("mono", total !== 100 ? "sev-ERROR" : "muted")} style={{ fontSize: 12, alignSelf: "center" }}>
          {t("version.total", { n: total })}
          {total !== 100 ? ` · ${t("version.must100")}` : ""}
        </span>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>{t("reason")}</span>
          <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("version.reasonPh")} />
        </label>
        <button
          className="btn primary"
          disabled={busy || !changed || total !== 100 || !can(CFG_PERM)}
          title={can(CFG_PERM) ? undefined : t("needPerm")}
          onClick={async () => {
            if (await save(body, reason, t("version.saved"))) {
              setDef(null);
              setTraffic(null);
              setReason("");
            }
          }}
        >
          <Check />
          {t("version.apply")}
        </button>
      </div>
    </Plate>
  );
}

function ToggleTables({ c }: { c: AppConfig }) {
  const t = useT("config");
  const f = useFmt();
  const locale = useLocale();
  const { save, busy } = useSave();
  const { can } = usePerms();
  const [reason, setReason] = useState("");
  const ops = useApi(["operators"], () => api.operators() as Promise<OperatorsWithRoles>, { revalidateOnFocus: false });
  const toggleSvc = (id: string, enabled: boolean) => save({ services: { [id]: { enabled } } }, reason, enabled ? t("toggles.svcOn", { id }) : t("toggles.svcOff", { id }));
  const toggleAp = (id: string, enabled: boolean) => save({ alertPolicies: { [id]: { enabled } } }, reason, enabled ? t("toggles.apOn", { id }) : t("toggles.apOff", { id }));
  const disabled = busy || !can(CFG_PERM);
  const roles = ops.data?.roles ?? [];
  const perms = ops.data?.permissions ?? [];
  return (
    <>
      <div className="note warn" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b>{t("toggles.reason")}</b>
        <input className="in" style={{ flex: 1, minWidth: 220 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("toggles.reasonPh")} aria-label={t("toggles.reason")} />
      </div>
      <Plate flush title={t("services.title")} refText="Cloud Run · asia-northeast3">
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t("services.cols.enabled")}</th>
                <th>{t("services.cols.service")}</th>
                <th>{t("services.cols.status")}</th>
                <th>Version · Revision</th>
                <th className="r">Instances</th>
                <th className="r">{t("services.cols.errorRate")}</th>
                <th className="r">p95</th>
                <th>{t("services.cols.deployed")}</th>
                <th>Service Account</th>
              </tr>
            </thead>
            <tbody>
              {c.services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input type="checkbox" className="switch" checked={s.enabled} disabled={disabled} onChange={(e) => void toggleSvc(s.id, e.target.checked)} aria-label={t("services.enableAria", { name: s.name })} />
                  </td>
                  <td>
                    <b>{s.name}</b>
                    {s.note ? (
                      <div className="muted" style={{ fontSize: 11, whiteSpace: "normal", maxWidth: 260 }}>
                        {s.note}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span title={statusHelp("service", s.status, locale)}>
                      <TonePill tone={s.status === "HEALTHY" ? "success" : s.status === "DISABLED" ? "cancelled" : "retry"} icon={s.status === "HEALTHY" ? "check-circle" : "alert-triangle"}>
                        {statusLabel("service", s.status, locale)}
                      </TonePill>
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {s.version}
                    <br />
                    <span className="muted">{s.revision}</span>
                  </td>
                  <td className="mono r">
                    {s.instances}{" "}
                    <span className="muted">
                      ({s.minInstances}–{s.maxInstances})
                    </span>
                  </td>
                  <td className={clsx("mono r", s.errorRate > 0.01 && "sev-ERROR")}>{f.pct(s.errorRate, 2)}</td>
                  <td className="mono r">{s.p95LatencyMs}ms</td>
                  <td className="mono muted">{f.dateTime(s.lastDeployAt).slice(5)}</td>
                  <td className="mono muted" style={{ fontSize: 10.5 }}>
                    {s.serviceAccount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Plate>
      <div className="split s-55">
        <Plate flush title={t("policies.title")} refText="§7.5">
          <div className="tbl-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>{t("policies.cols.on")}</th>
                  <th>{t("policies.cols.policy")}</th>
                  <th>{t("policies.cols.condition")}</th>
                  <th>{t("policies.cols.severity")}</th>
                  <th>{t("policies.cols.channels")}</th>
                </tr>
              </thead>
              <tbody>
                {c.alertPolicies.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" className="switch" checked={p.enabled} disabled={disabled} onChange={(e) => void toggleAp(p.id, e.target.checked)} aria-label={p.name} />
                    </td>
                    <td>
                      <b>{p.name}</b>
                      <div className="mono muted" style={{ fontSize: 10.5 }}>
                        {p.metric}
                      </div>
                    </td>
                    <td className="mono cellwrap" style={{ fontSize: 11, minWidth: 170 }}>
                      {p.condition}
                    </td>
                    <td>
                      <TonePill tone={p.severity === "CRITICAL" ? "failed" : "retry"}>{statusLabel("severity", p.severity, locale)}</TonePill>
                    </td>
                    <td className="mono muted" style={{ fontSize: 10.5 }}>
                      {p.channels.map((ch) => (
                        <div key={ch}>{ch}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Plate>
        <Plate flush title={t("rbac.title")} refText="console.config.ts · /api/v1/operators">
          <div className="tbl-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>{t("rbac.permission")}</th>
                  {roles.map((r) => (
                    <th key={r.name} title={r.description}>
                      {r.label ?? r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perms.map((p) => (
                  <tr key={p.key}>
                    <td>
                      {t.dynamic(`rbac.perms.${p.key.replace(":", "_")}`, undefined, p.label)}{" "}
                      <span className="mono muted" style={{ fontSize: 10 }}>
                        {p.key}
                      </span>
                    </td>
                    {roles.map((r) => (
                      <td key={r.name}>
                        {r.permissions.includes(p.key) || r.permissions.includes("admin") ? (
                          <Check size={14} style={{ color: "var(--st-success)" }} aria-label={t("rbac.allowed")} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!ops.data ? <Skeleton /> : null}
          </div>
          <div className="body" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(ops.data?.operators ?? c.operators).map((o) => (
              <span className="chip" key={o.id}>
                <User size={12} /> {o.name} · {o.role} · {o.team}
              </span>
            ))}
          </div>
          <div className="body" style={{ paddingTop: 0 }}>
            <div className="note">{t("rbac.note")}</div>
          </div>
        </Plate>
      </div>
    </>
  );
}

function AuditLog() {
  const t = useT("config");
  const f = useFmt();
  const tr = useTimeRange();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(h);
  }, [q]);
  const te = useT("errors");
  const a = useApi(["audit", tr.key, dq], () => api.audit({ q: dq || undefined, pageSize: 50, ...tr.params }), { revalidateOn: ["audit"] });
  return (
    <Plate
      flush
      title={
        <>
          <History /> {t("audit.title")}
        </>
      }
      right={
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <RangeTag />
          <label className="field" style={{ minWidth: 240 }}>
            <input className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("audit.searchPh")} aria-label={t("audit.search")} />
          </label>
        </div>
      }
    >
      <ErrorNote error={a.error} />
      <div className="tbl-wrap" style={{ maxHeight: 480 }}>
        <table className="t">
          <thead>
            <tr>
              <th>{t("audit.cols.time")}</th>
              <th>{t("audit.cols.actor")}</th>
              <th>Action</th>
              <th>{t("audit.cols.target")}</th>
              <th>Before → After</th>
              <th>{t("audit.cols.reason")}</th>
              <th>{t("audit.cols.request")}</th>
            </tr>
          </thead>
          <tbody>
            {(a.data?.items ?? []).map((x) => (
              <tr key={x.audit_id}>
                <td className="mono muted">{f.dateTime(x.ts).slice(5)}</td>
                <td>
                  {x.actorName}{" "}
                  <span className="muted mono" style={{ fontSize: 10.5 }}>
                    {x.role}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
                  {x.action}
                  {x.result && x.result !== "success" ? (
                    <>
                      {" "}
                      <TonePill tone={RESULT_TONE[x.result]}>{t(`audit.result.${x.result}`)}</TonePill>
                    </>
                  ) : null}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {x.target}
                </td>
                <td className="mono cellwrap" style={{ fontSize: 10.5, minWidth: 220, maxWidth: 320 }}>
                  <span className="muted">{JSON.stringify(x.before)}</span> → {JSON.stringify(x.after)}
                </td>
                <td className="wrap" style={{ fontSize: 12 }}>
                  {reasonText(x.reason, te) ?? "—"}
                </td>
                <td className="mono muted" style={{ fontSize: 10.5 }} title={x.user_agent ?? undefined}>
                  {x.audit_id} · {x.request_id}
                  <br />
                  {x.source_ip}
                  {x.idempotency_key ? (
                    <>
                      <br />
                      <span title={t("audit.idempotencyKey")}>idem {x.idempotency_key.slice(0, 8)}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!a.data ? <Skeleton /> : !a.data.items.length ? <RangeEmpty title={dq ? t("audit.emptyQuery") : t("audit.empty")} hint={t("audit.emptyHint")} /> : null}
      </div>
      <div className="pager">
        <span className="muted">{a.data ? t("audit.footer", { shown: Math.min(50, a.data.total), total: f.number(a.data.total) }) : ""}</span>
      </div>
    </Plate>
  );
}

export function ConfigScreen() {
  const t = useT("config");
  const f = useFmt();
  const locale = useLocale();
  const rh = useRangeHref();
  const cfg = useApi(["config"], () => api.config(), { revalidateOn: ["audit"] });
  const { op } = usePerms();
  const c = cfg.data;
  const drift = c?.drift ?? [];
  const tf = c?.terraformDefaults ?? {};
  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-06 · SYSTEM CONFIGURATION"
        title={t("title")}
        desc={
          <>
            {t("desc")} {t("account")} <b>{op.name}</b> ({op.role})
          </>
        }
      />
      <ErrorNote error={cfg.error} />
      <PermNote perm={CFG_PERM} />
      {!c ? (
        <Skeleton rows={10} />
      ) : (
        <>
          <Plate
            flush
            style={{ borderColor: "var(--st-retry)" }}
            title={
              <>
                <GitBranch /> {t("drift.title")}
              </>
            }
            refText={t("drift.ref", { count: drift.length })}
          >
            <div className="tbl-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th className="r">Terraform</th>
                    <th className="r">Runtime</th>
                    <th>{t("drift.cols.by")}</th>
                    <th>{t("drift.cols.at")}</th>
                    <th>{t("drift.cols.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {drift.length ? (
                    drift.map((d) => (
                      <tr key={d.key}>
                        <td className="idc">{d.key}</td>
                        <td className="mono r muted">{JSON.stringify(d.terraform)}</td>
                        <td className="mono r" style={{ color: "var(--st-retry)", fontWeight: 700 }}>
                          {JSON.stringify(d.runtime)}
                        </td>
                        <td>
                          {opName(d.changedBy)}
                          {d.changedBy && opName(d.changedBy) !== d.changedBy ? (
                            <span className="mono muted" style={{ fontSize: 10, marginLeft: 4 }}>
                              {d.changedBy}
                            </span>
                          ) : null}
                        </td>
                        <td className="mono muted" title={d.changedAt ? f.dateTimeLabel(d.changedAt) : undefined}>
                          {d.changedAt ? f.dateTime(d.changedAt) : "—"}
                        </td>
                        <td className="wrap" style={{ fontSize: 12 }}>
                          {d.reason ?? "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty">
                          <b>{t("drift.none")}</b>
                          {t("drift.noneHint")}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="body">
              <div className="note warn">
                {t("drift.noteBefore")} <span className="mono">infrastructure/environments/prod/terraform.tfvars</span> {t("drift.noteMiddle")}{" "}
                <span className="mono">languages/*</span>, <span className="mono">capacity/*</span> {t("drift.noteAfter")}
              </div>
            </div>
          </Plate>
          <div className="split s-55">
            <Plate
              flush
              title={t("capacity.title")}
              right={
                <Link className="btn sm" href={rh("/capacity")}>
                  <SlidersHorizontal />
                  {t("capacity.edit")}
                </Link>
              }
            >
              <div className="tbl-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>{t("capacity.cols.lang")}</th>
                      <th className="r">{t("capacity.cols.max")}</th>
                      <th className="r">{t("capacity.cols.tf")}</th>
                      <th className="r">Batch</th>
                      <th className="r">{t("capacity.cols.weight")}</th>
                      <th className="r">{t("capacity.cols.starts")}</th>
                      <th>{t("capacity.cols.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.languages.map((l) => {
                      const tfv = tf[`languages.${l.code}.maxConcurrent`];
                      return (
                        <tr key={l.code}>
                          <td>
                            <LangBadge lang={l.code} /> {languageName(l.code, locale)}
                          </td>
                          <td className="mono r">{l.maxConcurrent}</td>
                          <td className={clsx("mono r", tfv !== l.maxConcurrent ? "sev-WARNING" : "muted")}>{String(tfv ?? "—")}</td>
                          <td className="mono r">{l.batchSize}</td>
                          <td className="mono r">{l.priorityWeight}</td>
                          <td className="mono r">{l.maxStartsPerMinute}</td>
                          <td>
                            {l.paused ? (
                              <TonePill tone="cancelled">{statusLabel("capacity", "PAUSED", locale)}</TonePill>
                            ) : l.enabled ? (
                              <TonePill tone="success">{statusLabel("capacity", "OK", locale)}</TonePill>
                            ) : (
                              <TonePill tone="cancelled">{statusLabel("capacity", "DISABLED", locale)}</TonePill>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td>
                        <b>Global</b>
                      </td>
                      <td className="mono r">
                        <b>{c.global.maxConcurrent}</b>
                      </td>
                      <td className={clsx("mono r", tf["global.maxConcurrent"] !== c.global.maxConcurrent ? "sev-WARNING" : "muted")}>{String(tf["global.maxConcurrent"] ?? "—")}</td>
                      <td />
                      <td />
                      <td className="mono r">{c.global.maxStartsPerMinute}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Plate>
            <RetryPanel key={JSON.stringify(c.retry)} c={c} />
          </div>
          <div className="split s-55">
            <TimeoutPanel key={`${c.workflowTimeoutMin}-${c.pipelineTimeoutMin}-${JSON.stringify(c.queuePolicy)}`} c={c} />
            <VersionPanel key={c.defaultPipelineVersion + c.pipelineVersionDetails.map((v) => v.trafficPct).join()} c={c} />
          </div>
          <ToggleTables c={c} />
        </>
      )}
      <AuditLog />
    </Sheet>
  );
}
