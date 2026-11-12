"use client";
/**
 * S6 — System configuration. Terraform defaults vs runtime drift, language/global capacity, retry, timeouts,
 * queue priority, pipeline versions (default + traffic), service enablement, alert policies, role simulation,
 * audit log. Every change → PATCH /config | /languages/[lang]/capacity | /capacity/global with a reason.
 */
import clsx from "clsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Bell, Check, CheckCircle2, Cpu, Gauge, GitBranch, History, Layers, ListOrdered, Minus, RotateCcw, Shield, TimerOff } from "lucide-react";
import { FAILURE_CATEGORY_META, OPERATORS, ROLE_PERMISSIONS } from "@/lib/catalog";
import { api, clearApiCache, parseAsString, revalidateKey, useApi, useOperator, useQueryState } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon } from "@/components/shared";
import type { AppConfig, AuditEntry, ConfigPatch, FailureCategory, LangCode } from "@/lib/types";
import { Empty, ErrorBox, LangTag, Pill, dur, opName, pct, useAction, useCan, useToast } from "./core";

const SECTIONS: [string, string][] = [
  ["drift", "Terraform Drift"],
  ["lang", "Language Capacity"],
  ["global", "Global Capacity"],
  ["retry", "Retry"],
  ["timeout", "Workflow Timeout"],
  ["queue", "Queue Priority"],
  ["versions", "Pipeline Version"],
  ["services", "서비스 상태"],
  ["alerts", "알림 정책"],
  ["roles", "권한 · 역할"],
  ["audit", "감사 로그"],
];

function Sec({ id, title, icon, children }: { id: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="panel" style={{ marginBottom: 14, scrollMarginTop: "calc(var(--hdr) + 12px)" }}>
      <div className="panel-h">
        <h2 className="sec">
          {icon}
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function ReasonApply({ reason, setReason, onApply, disabled, label }: { reason: string; setReason: (s: string) => void; onApply: () => void; disabled?: boolean; label: string }) {
  return (
    <form
      style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="변경 사유 (필수 · 감사 로그 기록)" style={{ flex: 1, minWidth: 200 }} />
      <button type="submit" className="btn pri" disabled={disabled}>
        <Check />
        {label}
      </button>
    </form>
  );
}

export function ConfigScreen() {
  const cfg = useApi(["lanes-config"], () => api.config(), { revalidateOn: ["audit"] });
  const { can, operator, role } = useCan();
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h && cfg.data) document.getElementById(h)?.scrollIntoView();
  }, [cfg.data]);
  if (cfg.error && !cfg.data) return <ErrorBox error={cfg.error} retry={() => cfg.mutate()} />;
  const c = cfg.data;
  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Screen 6 · Runtime configuration</div>
          <h1>System Configuration</h1>
          <p>Terraform 기본값과 Runtime Configuration의 차이를 확인하고 운영 정책을 변경합니다. 모든 변경은 사유와 함께 감사 로그에 기록되며, 서버에 저장되어 다른 화면·변형에도 반영됩니다.</p>
        </div>
        <div className={`note t-${can("config.write") ? "success" : "retry"}`}>
          <Shield className="i sm" /> {operator.name} · <b>{role}</b> — 설정 변경 {can("config.write") ? "허용" : "불가 (읽기 전용)"}
        </div>
      </div>
      <div className="cfg">
        <nav className="cfg-nav" aria-label="설정 섹션">
          {SECTIONS.map(([k, l]) => (
            <a
              key={k}
              href={`#${k}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(k)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                history.replaceState(null, "", `#${k}`);
              }}
            >
              {l}
            </a>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          {!c ? (
            <div className="skel" style={{ height: 600 }} />
          ) : (
            <>
              <Drift c={c} />
              <LangSection c={c} />
              <GlobalSection c={c} />
              <RetrySection c={c} />
              <TimeoutSection c={c} />
              <QueueSection c={c} />
              <VersionSection c={c} />
              <ToggleSection c={c} kind="services" />
              <ToggleSection c={c} kind="alertPolicies" />
              <Roles />
              <Audit />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function usePatch() {
  const act = useAction();
  const toast = useToast();
  return async (body: ConfigPatch, reason: string, ok: string) => {
    if (!reason.trim()) {
      toast("변경 사유를 입력하세요", "retry");
      return false;
    }
    const r = await act(() => api.patchConfig({ ...body, reason: reason.trim() }), (x) => `${ok} · 변경 ${x.changed.length}건 (${x.changed.join(", ") || "없음"})`);
    if (r) revalidateKey("lanes-config");
    return !!r;
  };
}

/** Map an audit entry to the runtime_config keys it changed (CONFIG_UPDATED target = key; CAPACITY_UPDATED
 *  target = "language:xx" with camelCase fields in `after`, or a "global.*" key). */
function auditKeys(a: AuditEntry): string[] {
  if (a.action !== "CONFIG_UPDATED" && a.action !== "CAPACITY_UPDATED") return [];
  const m = /^language:([a-z]{2})$/.exec(a.target);
  if (m && a.after && typeof a.after === "object") return Object.keys(a.after as object).map((k) => `languages.${m[1]}.${k}`);
  return [a.target];
}

function Drift({ c }: { c: AppConfig }) {
  // /config's drift notes are seeded once; overlay the newest audited change per key so 변경자/시각/사유 follow the runtime value.
  const audit = useApi(["lanes-drift-audit"], () => api.audit({ action: ["CONFIG_UPDATED", "CAPACITY_UPDATED"], pageSize: 200 }), { revalidateOn: ["audit"] });
  const dr = useMemo(() => {
    const latest = new Map<string, AuditEntry>();
    for (const a of audit.data?.items ?? []) for (const k of auditKeys(a)) if (!latest.get(k) || latest.get(k)!.ts < a.ts) latest.set(k, a);
    return c.drift.map((d) => {
      const a = latest.get(d.key);
      return a && (d.changedAt == null || a.ts > d.changedAt) ? { ...d, changedBy: a.actor, changedAt: a.ts, reason: a.reason } : d;
    });
  }, [c.drift, audit.data]);
  return (
    <Sec id="drift" title="Terraform 기본값 vs Runtime Config" icon={<GitBranch className="i" />}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <Pill tone={dr.length ? "retry" : "success"} icon={dr.length ? <AlertTriangle /> : <CheckCircle2 />}>
          {dr.length}개 키 drift
        </Pill>
        <span className="muted" style={{ fontSize: 11.5 }}>
          infrastructure/environments/prod/terraform.tfvars ↔ Firestore runtime_config
        </span>
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Key</th>
              <th>Terraform → Runtime</th>
              <th>변경자</th>
              <th>시각</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {dr.map((d) => (
              <tr key={d.key}>
                <td className="mono">{d.key}</td>
                <td>
                  <span className="drift-v">
                    <s>{JSON.stringify(d.terraform)}</s>
                    <ArrowRight className="i sm" />
                    <b>{JSON.stringify(d.runtime)}</b>
                  </span>
                </td>
                <td>{opName(d.changedBy)}</td>
                <td className="mono muted">{d.changedAt ? fmt.dateTime(d.changedAt) : "—"}</td>
                <td style={{ fontSize: 11.5 }}>{d.reason ?? ""}</td>
              </tr>
            ))}
            {!dr.length && (
              <tr>
                <td colSpan={5}>
                  <Empty>drift 없음</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 11.5 }}>
          terraform plan 미리보기 (runtime 값을 기본값으로 반영할 경우)
        </summary>
        <pre className="code" style={{ marginTop: 6 }}>
          {(dr.map((d) => `  ~ ${d.key}\n      - ${JSON.stringify(d.terraform)}\n      + ${JSON.stringify(d.runtime)}`).join("\n") || "No changes.") +
            `\n\nPlan: 0 to add, ${dr.length} to change, 0 to destroy.`}
        </pre>
      </details>
    </Sec>
  );
}

type LangField = "maxConcurrent" | "maxStartsPerMinute" | "priorityWeight";
const LF_API: Record<LangField, "max_concurrent" | "max_starts_per_minute" | "priority_weight"> = {
  maxConcurrent: "max_concurrent",
  maxStartsPerMinute: "max_starts_per_minute",
  priorityWeight: "priority_weight",
};

function LangSection({ c }: { c: AppConfig }) {
  const { can } = useCan();
  const act = useAction();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, number | boolean>>({});
  const [reason, setReason] = useState("");
  const tf = (code: string, k: string) => c.terraformDefaults[`languages.${code}.${k}`];
  const apply = async () => {
    if (!reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    let n = 0;
    for (const l of c.languages) {
      const body: Record<string, number | boolean> = {};
      (Object.keys(LF_API) as LangField[]).forEach((k) => {
        const v = draft[`${l.code}:${k}`];
        if (v != null && v !== l[k]) body[LF_API[k]] = v as number;
      });
      const en = draft[`${l.code}:enabled`];
      if (en != null && en !== l.enabled) body.enabled = en as boolean;
      if (Object.keys(body).length) {
        const r = await act(() => api.patchLanguageCapacity(l.code as LangCode, { ...body, reason: reason.trim() }));
        if (r) n++;
      }
    }
    toast(n ? `${n}개 언어 설정 변경 · drift 갱신` : "변경 없음", n ? "success" : "queued");
    setDraft({});
    setReason("");
    revalidateKey("lanes-config");
  };
  return (
    <Sec id="lang" title="Language Capacity" icon={<Gauge className="i" />}>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>언어</th>
              <th>Enabled</th>
              <th>상태</th>
              <th>maxConcurrent</th>
              <th>maxStarts/분</th>
              <th>priorityWeight</th>
              <th className="r">batchSize</th>
              <th className="r">Backlog 임계</th>
              <th className="r">p95 대기 SLO</th>
            </tr>
          </thead>
          <tbody>
            {c.languages.map((l) => {
              const inp = (k: LangField) => {
                const v = (draft[`${l.code}:${k}`] as number | undefined) ?? l[k];
                const t = tf(l.code, k);
                return (
                  <span style={{ whiteSpace: "nowrap" }}>
                    <input
                      className={clsx("inp mono", t != null && t !== l[k] && "dirty")}
                      type="number"
                      value={v}
                      disabled={!can("config.write")}
                      onChange={(e) => setDraft({ ...draft, [`${l.code}:${k}`]: +e.target.value })}
                      style={{ width: 70 }}
                      title={`Terraform 기본값 ${String(t)}`}
                      aria-label={`${l.name} ${k}`}
                    />{" "}
                    <span className="dim mono" style={{ fontSize: 10 }}>
                      tf {String(t ?? "—")}
                    </span>
                  </span>
                );
              };
              const en = (draft[`${l.code}:enabled`] as boolean | undefined) ?? l.enabled;
              return (
                <tr key={l.code}>
                  <td>
                    <LangTag code={l.code} />
                  </td>
                  <td>
                    <span className="toggle">
                      <input type="checkbox" checked={en} disabled={!can("config.write")} onChange={(e) => setDraft({ ...draft, [`${l.code}:enabled`]: e.target.checked })} aria-label={`${l.name} enabled`} />
                      <i />
                    </span>
                  </td>
                  <td>{l.paused ? <Pill tone="cancelled">PAUSED</Pill> : <Pill tone="success">ACTIVE</Pill>}</td>
                  <td>{inp("maxConcurrent")}</td>
                  <td>{inp("maxStartsPerMinute")}</td>
                  <td>{inp("priorityWeight")}</td>
                  <td className="r mono">{l.batchSize}</td>
                  <td className="r mono">{l.backlogAlertThreshold}</td>
                  <td className="r mono">{dur(l.p95WaitSloSec * 1000)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ReasonApply reason={reason} setReason={setReason} onApply={() => void apply()} disabled={!can("config.write") || !Object.keys(draft).length} label="변경 적용" />
    </Sec>
  );
}

function GlobalSection({ c }: { c: AppConfig }) {
  const { can } = useCan();
  const act = useAction();
  const toast = useToast();
  const [max, setMax] = useState<number | null>(null);
  const [spm, setSpm] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const apply = async () => {
    if (!reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    const body = { ...(max != null ? { max_concurrent: max } : {}), ...(spm != null ? { max_starts_per_minute: spm } : {}) };
    const r = await act(() => api.patchGlobalCapacity({ ...body, reason: reason.trim() }), (x) => `Global Capacity ${x.global.maxConcurrent} · ${x.global.maxStartsPerMinute}/분 적용`);
    if (r) {
      setMax(null);
      setSpm(null);
      setReason("");
      revalidateKey("lanes-config");
    }
  };
  return (
    <Sec id="global" title="Global Capacity" icon={<Layers className="i" />}>
      <div className="formrow">
        <span>
          global.maxConcurrent <span className="muted">(Terraform {String(c.terraformDefaults["global.maxConcurrent"])})</span>
        </span>
        <input className="inp mono" type="number" value={max ?? c.global.maxConcurrent} disabled={!can("config.write")} onChange={(e) => setMax(+e.target.value)} style={{ width: 90 }} aria-label="global maxConcurrent" />
      </div>
      <div className="formrow">
        <span>
          global.maxStartsPerMinute <span className="muted">(Terraform {String(c.terraformDefaults["global.maxStartsPerMinute"] ?? "—")})</span>
        </span>
        <input className="inp mono" type="number" value={spm ?? c.global.maxStartsPerMinute} disabled={!can("config.write")} onChange={(e) => setSpm(+e.target.value)} style={{ width: 90 }} aria-label="global maxStartsPerMinute" />
      </div>
      <ReasonApply reason={reason} setReason={setReason} onApply={() => void apply()} disabled={!can("config.write") || (max == null && spm == null)} label="Global 적용" />
    </Sec>
  );
}

function RetrySection({ c }: { c: AppConfig }) {
  const { can } = useCan();
  const patch = usePatch();
  const [mr, setMr] = useState<number | null>(null);
  const [b0, setB0] = useState<number | null>(null);
  const [b1, setB1] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const dirty = mr != null || b0 != null || b1 != null;
  return (
    <Sec id="retry" title="Retry Configuration" icon={<RotateCcw className="i" />}>
      <div className="grid g3">
        <label className="fld">
          <span>max_retries (0–5)</span>
          <input className="inp mono" type="number" min={0} max={5} value={mr ?? c.retry.maxRetries} disabled={!can("config.write")} onChange={(e) => setMr(+e.target.value)} />
        </label>
        <label className="fld">
          <span>backoff_seconds[0]</span>
          <input className="inp mono" type="number" value={b0 ?? c.retry.backoffSeconds[0]} disabled={!can("config.write")} onChange={(e) => setB0(+e.target.value)} />
        </label>
        <label className="fld">
          <span>backoff_seconds[1]</span>
          <input className="inp mono" type="number" value={b1 ?? c.retry.backoffSeconds[1]} disabled={!can("config.write")} onChange={(e) => setB1(+e.target.value)} />
        </label>
      </div>
      <div style={{ marginTop: 10 }}>
        <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
          유형별 정책 (plan §4.3) · 총 실행 {c.retry.maxAttempts}회
        </span>
        <div className="scroll-x">
          <table className="tbl" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>유형</th>
                <th>정책</th>
                <th>Retry</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(FAILURE_CATEGORY_META) as [FailureCategory, (typeof FAILURE_CATEGORY_META)[FailureCategory]][]).map(([k, m]) => (
                <tr key={k}>
                  <td>
                    <CatalogIcon name={m.icon} className="i sm" /> {m.label} <span className="mono dim">{k}</span>
                  </td>
                  <td>{m.policy}</td>
                  <td>
                    {c.retry.nonRetryable.includes(k) ? (
                      <Pill tone="dlq">즉시 DLQ</Pill>
                    ) : c.retry.limitedRetry[k] != null ? (
                      <Pill tone="retry">최대 {c.retry.limitedRetry[k]}회</Pill>
                    ) : (
                      <Pill tone="success">Retry</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ReasonApply
        reason={reason}
        setReason={setReason}
        disabled={!can("config.write") || !dirty}
        label="Retry 정책 적용"
        onApply={async () => {
          const ok = await patch(
            { retry: { maxRetries: mr ?? c.retry.maxRetries, backoffSeconds: [b0 ?? c.retry.backoffSeconds[0], b1 ?? c.retry.backoffSeconds[1]] } },
            reason,
            "Retry 정책 변경",
          );
          if (ok) {
            setMr(null);
            setB0(null);
            setB1(null);
            setReason("");
          }
        }}
      />
    </Sec>
  );
}

function TimeoutSection({ c }: { c: AppConfig }) {
  const { can } = useCan();
  const patch = usePatch();
  const [wt, setWt] = useState<number | null>(null);
  const [pt, setPt] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Sec id="timeout" title="Workflow Timeout" icon={<TimerOff className="i" />}>
      <div className="grid g3">
        <label className="fld">
          <span>workflowTimeoutMin (Terraform {String(c.terraformDefaults.workflowTimeoutMin)})</span>
          <input className="inp mono" type="number" value={wt ?? c.workflowTimeoutMin} disabled={!can("config.write")} onChange={(e) => setWt(+e.target.value)} />
        </label>
        <label className="fld">
          <span>pipelineTimeoutMin (≤ workflow)</span>
          <input className="inp mono" type="number" value={pt ?? c.pipelineTimeoutMin} disabled={!can("config.write")} onChange={(e) => setPt(+e.target.value)} />
        </label>
        <label className="fld">
          <span>reservationLeaseMin (읽기 전용)</span>
          <input className="inp mono" type="number" value={c.reservationLeaseMin} disabled readOnly />
        </label>
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        실행 중 Workflow에는 기존 timeout이 유지되고, 신규 Execution부터 적용됩니다 (§4.3 실행 제약).
      </div>
      <ReasonApply
        reason={reason}
        setReason={setReason}
        disabled={!can("config.write") || (wt == null && pt == null)}
        label="Timeout 적용"
        onApply={async () => {
          const ok = await patch({ ...(wt != null ? { workflowTimeoutMin: wt } : {}), ...(pt != null ? { pipelineTimeoutMin: pt } : {}) }, reason, "Timeout 변경 · 신규 Execution부터 적용");
          if (ok) {
            setWt(null);
            setPt(null);
            setReason("");
          }
        }}
      />
    </Sec>
  );
}

function QueueSection({ c }: { c: AppConfig }) {
  const { can } = useCan();
  const patch = usePatch();
  const [mode, setMode] = useState<string | null>(null);
  const [aging, setAging] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const qp = c.queuePolicy;
  return (
    <Sec id="queue" title="Queue Priority" icon={<ListOrdered className="i" />}>
      <div className="grid g3">
        <label className="fld">
          <span>언어 내 선택</span>
          <select className="inp" value={mode ?? qp.mode} disabled={!can("config.write")} onChange={(e) => setMode(e.target.value)}>
            {["PRIORITY_THEN_FIFO", "FIFO"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>언어 간 분배 (읽기 전용)</span>
          <input className="inp mono" value={qp.crossLanguage} disabled readOnly />
        </label>
        <div className="fld">
          <span>Aging (Starvation 방지)</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="toggle">
              <input type="checkbox" checked={aging ?? qp.aging.enabled} disabled={!can("config.write")} onChange={(e) => setAging(e.target.checked)} aria-label="Aging" />
              <i />
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {qp.aging.boostPerMinutes}분마다 +1, 최대 +{qp.aging.maxBoost}
            </span>
          </span>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        선택 순서: 1) 높은 Priority 2) 오래 대기 3) 동일 우선순위 FIFO · 가중치 {c.languages.map((l) => `${l.code}=${l.priorityWeight}`).join(" · ")}
      </div>
      <ReasonApply
        reason={reason}
        setReason={setReason}
        disabled={!can("config.write") || (mode == null && aging == null)}
        label="Queue 정책 적용"
        onApply={async () => {
          const ok = await patch({ queuePolicy: { ...(mode != null ? { mode } : {}), ...(aging != null ? { aging: { enabled: aging } } : {}) } }, reason, "Queue 정책 변경");
          if (ok) {
            setMode(null);
            setAging(null);
            setReason("");
          }
        }}
      />
    </Sec>
  );
}

function VersionSection({ c }: { c: AppConfig }) {
  const { can } = useCan();
  const patch = usePatch();
  const [def, setDef] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<Record<string, number> | null>(null);
  const [reason, setReason] = useState("");
  const tr = traffic ?? Object.fromEntries(c.pipelineVersionDetails.map((v) => [v.version, v.trafficPct]));
  const sum = Object.values(tr).reduce((a, b) => a + b, 0);
  return (
    <Sec id="versions" title="Pipeline Version" icon={<GitBranch className="i" />}>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Version</th>
              <th>상태</th>
              <th className="r">Traffic %</th>
              <th>Model</th>
              <th>Judge</th>
              <th>Template</th>
              <th>출시</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            {c.pipelineVersionDetails.map((v) => (
              <tr key={v.version}>
                <td className="mono">
                  <b>{v.version}</b> {v.version === c.defaultPipelineVersion && <Pill tone="success">default</Pill>}
                </td>
                <td>
                  <Pill tone={v.status === "CANARY" ? "retry" : v.status === "STABLE" ? "success" : "cancelled"}>{v.status}</Pill>
                </td>
                <td className="r">
                  <input
                    className={clsx("inp mono", traffic && tr[v.version] !== v.trafficPct && "dirty")}
                    type="number"
                    min={0}
                    max={100}
                    value={tr[v.version]}
                    disabled={!can("version.promote")}
                    onChange={(e) => setTraffic({ ...tr, [v.version]: +e.target.value })}
                    style={{ width: 70, textAlign: "right" }}
                    aria-label={`${v.version} traffic`}
                  />
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {v.modelUnderTest}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {v.judgeModel}
                </td>
                <td className="mono muted" style={{ fontSize: 10.5 }}>
                  {v.templateUri}
                </td>
                <td className="mono muted">{fmt.date(v.releasedAt)}</td>
                <td style={{ fontSize: 11.5 }}>{v.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="formrow" style={{ marginTop: 8 }}>
        <span>
          defaultPipelineVersion · traffic 합계 <b className="mono" style={{ color: sum === 100 ? "var(--st-success)" : "var(--st-failed)" }}>{sum}%</b>
        </span>
        <select className="inp" style={{ width: "auto" }} value={def ?? c.defaultPipelineVersion} disabled={!can("version.promote")} onChange={(e) => setDef(e.target.value)} aria-label="default version">
          {c.pipelineVersionDetails.map((v) => (
            <option key={v.version} disabled={v.status === "DEPRECATED"}>
              {v.version}
            </option>
          ))}
        </select>
      </div>
      <ReasonApply
        reason={reason}
        setReason={setReason}
        disabled={!can("version.promote") || (def == null && traffic == null)}
        label="버전 정책 적용 (version.promote)"
        onApply={async () => {
          const ok = await patch({ ...(def != null ? { defaultPipelineVersion: def } : {}), ...(traffic ? { versionTraffic: traffic } : {}) }, reason, "Pipeline 버전 정책 변경");
          if (ok) {
            setDef(null);
            setTraffic(null);
            setReason("");
          }
        }}
      />
    </Sec>
  );
}

function ToggleSection({ c, kind }: { c: AppConfig; kind: "services" | "alertPolicies" }) {
  const { can } = useCan();
  const patch = usePatch();
  const [reason, setReason] = useState("");
  const toast = useToast();
  const alerts = useApi(kind === "alertPolicies" ? ["lanes-alerts"] : null, () => api.alerts(), { revalidateOn: ["alert"] });
  const toggle = async (id: string, enabled: boolean, name: string) => {
    const r = reason.trim() || `Lanes 콘솔 토글 — ${name} ${enabled ? "활성화" : "비활성화"}`;
    if (!can("config.write")) return toast("권한 없음 — 설정 변경은 Admin 역할이 필요합니다", "failed");
    await patch({ [kind]: { [id]: { enabled } } } as ConfigPatch, r, `${name} ${enabled ? "ON" : "OFF"}`);
  };
  return (
    <Sec id={kind === "services" ? "services" : "alerts"} title={kind === "services" ? "서비스 활성화 상태" : "알림 정책 (§7.5)"} icon={kind === "services" ? <Cpu className="i" /> : <Bell className="i" />}>
      <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="토글 사유 (비우면 기본 사유가 감사 로그에 기록됩니다)" style={{ marginBottom: 8 }} />
      <div className="scroll-x">
        {kind === "services" ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>서비스</th>
                <th>Enabled</th>
                <th>상태</th>
                <th>버전 · Revision</th>
                <th className="r">Instances</th>
                <th className="r">Error rate</th>
                <th className="r">p95</th>
                <th>Service Account</th>
              </tr>
            </thead>
            <tbody>
              {c.services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <div className="muted mono" style={{ fontSize: 10 }}>
                      {s.runtime} · {s.region}
                    </div>
                    {s.note && <div style={{ fontSize: 10.5, color: "var(--st-retry)" }}>{s.note}</div>}
                  </td>
                  <td>
                    <span className="toggle">
                      <input type="checkbox" checked={s.enabled} disabled={!can("config.write")} onChange={(e) => void toggle(s.id, e.target.checked, s.name)} aria-label={s.name} />
                      <i />
                    </span>
                  </td>
                  <td>
                    <Pill tone={s.status === "HEALTHY" ? "success" : s.status === "DISABLED" ? "cancelled" : "retry"} icon={s.status === "HEALTHY" ? <CheckCircle2 /> : <AlertTriangle />}>
                      {s.status}
                    </Pill>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {s.version} · {s.revision}
                  </td>
                  <td className="r mono">
                    {s.instances} <span className="dim">({s.minInstances}–{s.maxInstances})</span>
                  </td>
                  <td className="r mono">{pct(s.errorRate, 2)}</td>
                  <td className="r mono">{fmt.number(s.p95LatencyMs)}ms</td>
                  <td className="mono muted" style={{ fontSize: 10 }}>
                    {s.serviceAccount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>정책</th>
                <th>Enabled</th>
                <th>Metric · 조건</th>
                <th>심각도</th>
                <th>채널</th>
                <th className="r">열린 알림</th>
              </tr>
            </thead>
            <tbody>
              {c.alertPolicies.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{p.name}</b>
                    <div className="mono dim" style={{ fontSize: 10 }}>
                      {p.id}
                    </div>
                  </td>
                  <td>
                    <span className="toggle">
                      <input type="checkbox" checked={p.enabled} disabled={!can("config.write")} onChange={(e) => void toggle(p.id, e.target.checked, p.name)} aria-label={p.name} />
                      <i />
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {p.metric}
                    <div className="muted">{p.condition}</div>
                  </td>
                  <td>
                    <Pill tone={p.severity === "CRITICAL" ? "failed" : "retry"}>{p.severity}</Pill>
                  </td>
                  <td className="mono muted" style={{ fontSize: 10.5 }}>
                    {p.channels.map((x) => (
                      <div key={x}>{x}</div>
                    ))}
                  </td>
                  <td className="r mono">{(alerts.data ?? []).filter((a) => a.policy_id === p.id && a.status !== "RESOLVED").length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Sec>
  );
}

function Roles() {
  const [op, setOp] = useOperator();
  const toast = useToast();
  return (
    <Sec id="roles" title="운영자 권한 · 역할 시뮬레이션" icon={<Shield className="i" />}>
      <div className="formrow">
        <span>현재 운영자 / 역할 (x-operator 헤더로 서버 RBAC 적용 — Viewer는 변경 시 403)</span>
        <select
          className="inp"
          style={{ width: "auto" }}
          value={op.id}
          onChange={(e) => {
            setOp(e.target.value);
            clearApiCache();
            const o = OPERATORS.find((x) => x.id === e.target.value)!;
            toast(`${o.name} (${o.role}) 로 전환 — 권한에 따라 버튼이 비활성화되고 서버가 요청을 거부합니다`, "queued");
          }}
          aria-label="운영자 전환"
        >
          {OPERATORS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.role}
            </option>
          ))}
        </select>
      </div>
      <div className="scroll-x">
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>권한</th>
              <th>key</th>
              <th>Viewer</th>
              <th>Operator</th>
              <th>Admin</th>
            </tr>
          </thead>
          <tbody>
            {ROLE_PERMISSIONS.map((p) => (
              <tr key={p.key}>
                <td>{p.permission}</td>
                <td className="mono muted">{p.key}</td>
                {(["Viewer", "Operator", "Admin"] as const).map((r) => (
                  <td key={r} style={r === op.role ? { background: "var(--surface-2)" } : undefined}>
                    {p[r] ? <Check className="i sm perm-y" aria-label="허용" /> : <Minus className="i sm perm-n" aria-label="불가" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

function Audit() {
  const [actor, setActor] = useQueryState("actor", parseAsString);
  const q = useApi(["lanes-audit", actor], () => api.audit({ pageSize: 60, actor: actor ?? undefined }), { revalidateOn: ["audit"] });
  return (
    <Sec id="audit" title="감사 로그 (Auditability)" icon={<History className="i" />}>
      <div className="formrow">
        <span className="muted">
          총 {q.data ? fmt.number(q.data.total) : "—"}건 · 최신순 · 실시간(SSE audit)
        </span>
        <select className="inp" style={{ width: "auto" }} value={actor ?? ""} onChange={(e) => setActor(e.target.value || null)} aria-label="운영자 필터">
          <option value="">전체 운영자</option>
          {OPERATORS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="scroll-x" style={{ maxHeight: 480, overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>시각</th>
              <th>운영자</th>
              <th>Action</th>
              <th>대상</th>
              <th>Before → After</th>
              <th>사유</th>
              <th>Request</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.items ?? []).map((x) => (
              <tr key={x.audit_id}>
                <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
                  {fmt.date(x.ts).slice(5)} {fmt.time(x.ts)}
                </td>
                <td>
                  <b>{x.actorName || opName(x.actor)}</b>
                  <div className="muted" style={{ fontSize: 10.5 }}>
                    {x.role}
                  </div>
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {x.action}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {x.target}
                </td>
                <td className="mono" style={{ fontSize: 10.5, maxWidth: 280, overflowWrap: "anywhere" }}>
                  <span className="dim">{JSON.stringify(x.before)}</span> → {JSON.stringify(x.after)}
                </td>
                <td style={{ fontSize: 11.5 }}>{x.reason ?? ""}</td>
                <td className="mono dim" style={{ fontSize: 10 }}>
                  {x.request_id}
                  <br />
                  {x.source_ip}
                </td>
              </tr>
            ))}
            {q.isLoading && (
              <tr>
                <td colSpan={7}>
                  <div className="skel" style={{ height: 120 }} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}


