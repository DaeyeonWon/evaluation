"use client";
/**
 * S-06 · System configuration. Every change is PATCH /api/v1/config (or the capacity endpoints)
 * with a mandatory reason; Terraform-default vs runtime drift and the audit trail are live.
 */
import clsx from "clsx";
import { Check, GitBranch, History, SlidersHorizontal, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CatalogIcon, LangBadge, TonePill, fmt } from "@/components/shared";
import { FAILURE_CATEGORY_META } from "@/lib/catalog";
import { api, revalidateKey, useApi } from "@/lib/client";
import type { AppConfig, ConfigPatch, FailureCategory } from "@/lib/types";
import { Empty, OperatorSelect, PermNote, Plate, Sheet, SheetHead, Skeleton, opName, usePerms, useToast } from "./ui";

function useSave() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (body: ConfigPatch, reason: string, okMsg: string) => {
    if (reason.trim().length < 4) {
      toast.err("변경 사유를 4자 이상 입력하세요. (감사 로그에 기록됩니다)");
      return false;
    }
    setBusy(true);
    try {
      const r = await api.patchConfig({ ...body, reason });
      toast.ok(
        <>
          {okMsg} · 변경 {r.changed.join(", ") || "없음"} · 감사 {r.audit.map((a) => a.audit_id).join(", ")}
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
    <Plate title="Retry Configuration" refText={`§4.3 · 자동 실행 최대 ${c.retry.maxAttempts}회`}>
      <div style={{ display: "grid", gap: 12 }}>
        <pre className="code">{`retry:
  max_retries: ${c.retry.maxRetries}        # Attempt 1 + 재실행 ${c.retry.maxRetries}
  backoff_seconds: [${c.retry.backoffSeconds.join(", ")}]
  non_retryable: [${c.retry.nonRetryable.join(", ")}]
  limited_retry: ${JSON.stringify(c.retry.limitedRetry)}`}</pre>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field">
            <span>max_retries</span>
            <input className="in mono" type="number" min={0} max={5} value={vm} onChange={(e) => setMr(+e.target.value)} style={{ width: 84 }} />
          </label>
          <label className="field">
            <span>Backoff #1 (초)</span>
            <input className="in mono" type="number" min={1} max={3600} value={v0} onChange={(e) => setB0(+e.target.value)} style={{ width: 100 }} />
          </label>
          <label className="field">
            <span>Backoff #2 (초)</span>
            <input className="in mono" type="number" min={1} max={3600} value={v1} onChange={(e) => setB1(+e.target.value)} style={{ width: 100 }} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span>변경 사유 (필수)</span>
            <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: quota 회복 시간 고려해 2차 backoff 연장" />
          </label>
          <button
            className="btn primary"
            disabled={busy || !changed || !can("config.write")}
            onClick={async () => {
              if (await save({ retry: { maxRetries: vm, backoffSeconds: [v0, v1] } }, reason, `Retry 정책 변경 (backoff ${v0}s → ${v1}s)`)) {
                setB0(null);
                setB1(null);
                setMr(null);
                setReason("");
              }
            }}
          >
            <Check />
            적용
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>오류 유형</th>
                <th>처리 정책</th>
                <th>Retry</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(FAILURE_CATEGORY_META) as FailureCategory[]).map((k) => {
                const m = FAILURE_CATEGORY_META[k];
                return (
                  <tr key={k}>
                    <td>
                      <CatalogIcon name={m.icon} size={13} /> {m.label}{" "}
                      <span className="mono muted" style={{ fontSize: 10.5 }}>
                        {k}
                      </span>
                    </td>
                    <td className="cellwrap" style={{ minWidth: 200 }}>
                      {m.policy}
                    </td>
                    <td>
                      {m.retryable ? (
                        <TonePill tone="retry" icon="rotate-ccw">
                          {m.maxRetries != null ? `${m.maxRetries}회` : `최대 ${c.retry.maxRetries}회`}
                        </TonePill>
                      ) : (
                        <TonePill tone="dlq" icon="archive-x">
                          즉시 DLQ
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
    <Plate title="Workflow Timeout · Queue Priority" refText="PATCH /api/v1/config">
      <div style={{ display: "grid", gap: 12 }}>
        <div className="filters">
          <label className="field">
            <span>Workflow timeout (분)</span>
            <input className="in mono" type="number" min={5} max={360} value={v.wt} onChange={(e) => setWt(+e.target.value)} />
          </label>
          <label className="field">
            <span>PipelineJob timeout (분)</span>
            <input className="in mono" type="number" min={5} max={360} value={v.pt} onChange={(e) => setPt(+e.target.value)} />
          </label>
          <label className="field">
            <span>Queue 정책</span>
            <select className="in" value={v.mode} onChange={(e) => setMode(e.target.value)}>
              <option>PRIORITY_THEN_FIFO</option>
              <option>FIFO</option>
            </select>
          </label>
          <label className="field">
            <span>Aging</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", height: 31 }}>
              <input type="checkbox" className="switch" checked={v.aging} onChange={(e) => setAging(e.target.checked)} aria-label="Aging 사용" />
              <span style={{ fontSize: 12 }}>{v.aging ? "켜짐" : "꺼짐"}</span>
            </span>
          </label>
          <label className="field">
            <span>Aging 간격 (분마다 +1)</span>
            <input className="in mono" type="number" min={1} value={v.boost} onChange={(e) => setBoost(+e.target.value)} disabled={!v.aging} />
          </label>
          <label className="field">
            <span>최대 boost</span>
            <input className="in mono" type="number" min={0} value={v.maxBoost} onChange={(e) => setMaxBoost(+e.target.value)} disabled={!v.aging} />
          </label>
        </div>
        <dl className="kv">
          <dt>Workflow timeout</dt>
          <dd className="mono">
            {c.workflowTimeoutMin}분 {tf.workflowTimeoutMin !== c.workflowTimeoutMin ? <span className="sev-WARNING">(TF {String(tf.workflowTimeoutMin)}분 · DRIFT)</span> : null}
          </dd>
          <dt>PipelineJob timeout</dt>
          <dd className="mono">{c.pipelineTimeoutMin}분 · 초과 시 취소 확인 후 Retry 판정</dd>
          <dt>Reservation lease</dt>
          <dd className="mono">{c.reservationLeaseMin}분 · Lease 만료만으로 Slot 반환하지 않음 (Reconciler 확인)</dd>
          <dt>언어 간</dt>
          <dd className="mono">{c.queuePolicy.crossLanguage}</dd>
          <dt>선택 순서</dt>
          <dd>높은 Priority → 오래 대기 → FIFO</dd>
        </dl>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span>변경 사유 (필수)</span>
            <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: v1.2-rc 응답 평가 시간 증가 반영" />
          </label>
          <button className="btn" onClick={reset} disabled={!changed}>
            되돌리기
          </button>
          <button className="btn primary" disabled={busy || !changed || !can("config.write")} onClick={async () => (await save(body, reason, "Timeout · Queue 정책 변경")) && reset()}>
            <Check />
            적용
          </button>
        </div>
      </div>
    </Plate>
  );
}

function VersionPanel({ c }: { c: AppConfig }) {
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
    <Plate flush title="Pipeline Version" refText={`기본 ${c.defaultPipelineVersion} · version.promote 권한`}>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>버전</th>
              <th>상태</th>
              <th className="r">트래픽 %</th>
              <th>모델 / Judge</th>
              <th>Template</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            {c.pipelineVersionDetails.map((v) => (
              <tr key={v.version}>
                <td className="idc">
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name="atlas-defver" checked={vDef === v.version} disabled={v.status === "DEPRECATED"} onChange={() => setDef(v.version)} aria-label={`${v.version} 기본 버전`} />
                    {v.version}
                  </label>
                </td>
                <td>
                  <TonePill tone={v.status === "STABLE" ? "success" : v.status === "CANARY" ? "running" : "cancelled"}>{v.status}</TonePill>
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
                    aria-label={`${v.version} 트래픽`}
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
          트래픽 합계 {total}%{total !== 100 ? " · 100이어야 합니다" : ""}
        </span>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>변경 사유 (필수)</span>
          <input className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: v1.2-rc canary 50% 확대 (기기제어 회귀 수정 확인)" />
        </label>
        <button
          className="btn primary"
          disabled={busy || !changed || total !== 100 || !can("version.promote")}
          onClick={async () => {
            if (await save(body, reason, "Pipeline 버전 설정 변경")) {
              setDef(null);
              setTraffic(null);
              setReason("");
            }
          }}
        >
          <Check />
          버전 적용
        </button>
      </div>
    </Plate>
  );
}

function ToggleTables({ c }: { c: AppConfig }) {
  const { save, busy } = useSave();
  const { can } = usePerms();
  const [reason, setReason] = useState("");
  const toggleSvc = (id: string, enabled: boolean) => save({ services: { [id]: { enabled } } }, reason, `서비스 ${id} ${enabled ? "활성화" : "비활성화"}`);
  const toggleAp = (id: string, enabled: boolean) => save({ alertPolicies: { [id]: { enabled } } }, reason, `알림 정책 ${id} ${enabled ? "켜짐" : "꺼짐"}`);
  const disabled = busy || !can("config.write");
  return (
    <>
      <div className="note warn" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b>토글 변경 사유</b>
        <input className="in" style={{ flex: 1, minWidth: 220 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="서비스·알림 정책 스위치를 바꾸기 전에 사유를 입력하세요 (필수 · 감사 로그)" aria-label="토글 변경 사유" />
      </div>
      <Plate flush title="서비스 활성화 상태" refText="Cloud Run · asia-northeast3">
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>활성</th>
                <th>서비스</th>
                <th>상태</th>
                <th>버전 · Revision</th>
                <th className="r">Instances</th>
                <th className="r">Error rate</th>
                <th className="r">p95</th>
                <th>최근 배포</th>
                <th>Service Account</th>
              </tr>
            </thead>
            <tbody>
              {c.services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input type="checkbox" className="switch" checked={s.enabled} disabled={disabled} onChange={(e) => void toggleSvc(s.id, e.target.checked)} aria-label={`${s.name} 활성화`} />
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
                    <TonePill tone={s.status === "HEALTHY" ? "success" : s.status === "DISABLED" ? "cancelled" : "retry"} icon={s.status === "HEALTHY" ? "check-circle" : "alert-triangle"}>
                      {s.status}
                    </TonePill>
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
                  <td className={clsx("mono r", s.errorRate > 0.01 && "sev-ERROR")}>{fmt.pct(s.errorRate, 2)}</td>
                  <td className="mono r">{s.p95LatencyMs}ms</td>
                  <td className="mono muted">{fmt.dateTime(s.lastDeployAt).slice(5)}</td>
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
        <Plate flush title="알림 정책" refText="§7.5">
          <div className="tbl-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>켜기</th>
                  <th>정책</th>
                  <th>조건</th>
                  <th>심각도</th>
                  <th>채널</th>
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
                      <TonePill tone={p.severity === "CRITICAL" ? "failed" : "retry"}>{p.severity}</TonePill>
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
        <Plate flush title="운영자 권한 (RBAC)" refText="x-operator · /api/v1/me">
          <div className="tbl-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>권한</th>
                  <th>Viewer</th>
                  <th>Operator</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {c.rolePermissions.map((p) => (
                  <tr key={p.key}>
                    <td>
                      {p.permission}{" "}
                      <span className="mono muted" style={{ fontSize: 10 }}>
                        {p.key}
                      </span>
                    </td>
                    {(["Viewer", "Operator", "Admin"] as const).map((r) => (
                      <td key={r}>{p[r] ? <Check size={14} style={{ color: "var(--st-success)" }} aria-label="허용" /> : <span className="muted">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="body" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {c.operators.map((o) => (
              <span className="chip" key={o.id}>
                <User size={12} /> {o.name} · {o.role} · {o.team}
              </span>
            ))}
          </div>
        </Plate>
      </div>
    </>
  );
}

function AuditLog() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const a = useApi(["audit", dq], () => api.audit({ q: dq || undefined, pageSize: 50 }), { revalidateOn: ["audit"] });
  return (
    <Plate
      flush
      title={
        <>
          <History /> 감사 로그
        </>
      }
      right={
        <label className="field" style={{ minWidth: 240 }}>
          <input className="in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action, 대상, 운영자, 사유 검색" aria-label="감사 로그 검색" />
        </label>
      }
    >
      <div className="tbl-wrap" style={{ maxHeight: 480 }}>
        <table className="t">
          <thead>
            <tr>
              <th>시각</th>
              <th>운영자</th>
              <th>Action</th>
              <th>대상</th>
              <th>Before → After</th>
              <th>사유</th>
              <th>요청</th>
            </tr>
          </thead>
          <tbody>
            {(a.data?.items ?? []).map((x) => (
              <tr key={x.audit_id}>
                <td className="mono muted">{fmt.dateTime(x.ts).slice(5)}</td>
                <td>
                  {x.actorName}{" "}
                  <span className="muted mono" style={{ fontSize: 10.5 }}>
                    {x.role}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
                  {x.action}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {x.target}
                </td>
                <td className="mono cellwrap" style={{ fontSize: 10.5, minWidth: 220, maxWidth: 320 }}>
                  <span className="muted">{JSON.stringify(x.before)}</span> → {JSON.stringify(x.after)}
                </td>
                <td className="wrap" style={{ fontSize: 12 }}>
                  {x.reason ?? "—"}
                </td>
                <td className="mono muted" style={{ fontSize: 10.5 }}>
                  {x.audit_id} · {x.request_id}
                  <br />
                  {x.source_ip}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!a.data ? <Skeleton /> : !a.data.items.length ? <Empty title="일치하는 감사 기록이 없습니다" /> : null}
      </div>
      <div className="pager">
        <span className="muted">{a.data ? `${Math.min(50, a.data.total)} / ${fmt.number(a.data.total)}건 · 최신순 · 실시간 (SSE audit)` : ""}</span>
      </div>
    </Plate>
  );
}

export function ConfigScreen() {
  const cfg = useApi(["config"], () => api.config(), { revalidateOn: ["audit"] });
  // Drifts created at runtime carry no changedBy/changedAt/reason in /config; fill them from the
  // newest audit entry that touched the same key (also when it is newer than the seeded note) (e.g. target "retry" → "retry.backoffSeconds").
  const auditQ = useApi(["audit", "atlas-drift"], () => api.audit({ pageSize: 200 }), { revalidateOn: ["audit"] });
  const { op } = usePerms();
  const c = cfg.data;
  const drift = useMemo(() => {
    const items = auditQ.data?.items ?? [];
    return (c?.drift ?? []).map((d) => {
      const hit = items
        .filter((a) => {
          const t = a.target.replace(/^language:/, "languages.");
          if (d.key === t) return true;
          if (!d.key.startsWith(t + ".")) return false;
          // target covers several fields (e.g. "retry", "language:ko"): only count it when this field changed
          const f = d.key.slice(t.length + 1);
          const pick = (o: unknown) => {
            if (!o || typeof o !== "object") return undefined;
            const r = o as Record<string, unknown>;
            return r[f] ?? r[f.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase())];
          };
          const b = pick(a.before);
          const af = pick(a.after);
          return af !== undefined && JSON.stringify(b) !== JSON.stringify(af);
        })
        .sort((a, b) => b.ts - a.ts)[0];
      if (!hit || (d.changedAt && d.changedAt >= hit.ts)) return d;
      return { ...d, changedBy: hit.actor, changedAt: hit.ts, reason: hit.reason };
    });
  }, [c, auditQ.data]);
  const tf = c?.terraformDefaults ?? {};
  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-06 · SYSTEM CONFIGURATION"
        title="시스템 설정"
        desc={
          <>
            Terraform 변수가 기본값이고, 운영 중 바꾼 값은 Runtime Configuration에 저장됩니다. 두 값이 다르면 Drift로 표시합니다. 현재 계정: <b>{op.name}</b> ({op.role})
          </>
        }
        acts={
          <div style={{ minWidth: 220 }}>
            <OperatorSelect />
          </div>
        }
      />
      <PermNote perm="config.write" />
      {!c ? (
        <Skeleton rows={10} />
      ) : (
        <>
          <Plate
            flush
            style={{ borderColor: "var(--st-retry)" }}
            title={
              <>
                <GitBranch /> Terraform 기본값 ↔ Runtime 설정 Drift
              </>
            }
            refText={`${drift.length} keys drifted`}
          >
            <div className="tbl-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th className="r">Terraform</th>
                    <th className="r">Runtime</th>
                    <th>변경자</th>
                    <th>변경 시각</th>
                    <th>사유</th>
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
                        <td>{opName(d.changedBy)}</td>
                        <td className="mono muted">{d.changedAt ? fmt.dateTime(d.changedAt) : "—"}</td>
                        <td className="wrap" style={{ fontSize: 12 }}>
                          {d.reason ?? "—"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <Empty title="Drift 없음">Runtime 값이 Terraform 기본값과 같습니다.</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="body">
              <div className="note warn">
                Drift를 유지하려면 <span className="mono">infrastructure/environments/prod/terraform.tfvars</span>에 반영하는 PR을 올리세요. 운영 값은 Firestore <span className="mono">languages/*</span>,{" "}
                <span className="mono">capacity/*</span>가 우선합니다.
              </div>
            </div>
          </Plate>
          <div className="split s-55">
            <Plate
              flush
              title="Language · Global Capacity"
              right={
                <Link className="btn sm" href="/atlas/capacity">
                  <SlidersHorizontal />
                  Capacity 화면에서 변경
                </Link>
              }
            >
              <div className="tbl-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>언어</th>
                      <th className="r">동시 상한</th>
                      <th className="r">TF 기본</th>
                      <th className="r">Batch</th>
                      <th className="r">가중치</th>
                      <th className="r">시작/분</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.languages.map((l) => {
                      const t = tf[`languages.${l.code}.maxConcurrent`];
                      return (
                        <tr key={l.code}>
                          <td>
                            <LangBadge lang={l.code} /> {l.name}
                          </td>
                          <td className="mono r">{l.maxConcurrent}</td>
                          <td className={clsx("mono r", t !== l.maxConcurrent ? "sev-WARNING" : "muted")}>{String(t ?? "—")}</td>
                          <td className="mono r">{l.batchSize}</td>
                          <td className="mono r">{l.priorityWeight}</td>
                          <td className="mono r">{l.maxStartsPerMinute}</td>
                          <td>{l.paused ? <TonePill tone="cancelled">일시 중지</TonePill> : l.enabled ? <TonePill tone="success">활성</TonePill> : <TonePill tone="cancelled">비활성</TonePill>}</td>
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
