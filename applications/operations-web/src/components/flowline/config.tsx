"use client";
/**
 * S6 System Configuration — Terraform default ↔ runtime drift, language/global capacity, retry +
 * timeout (inline validation, never silent clamping), queue priority, pipeline version promotion and
 * traffic, service enablement, alert policy, and the audit log of operator actions (live via SSE).
 */
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bell, Check, ChevronRight, Cpu, GitBranch, Gauge, Info, Layers, ListOrdered, RotateCcw, Shield, Users, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { api, parseAsString, revalidateKey, useApi, useQueryStates } from "@/lib/client";
import { fmt } from "@/lib/format";
import { OPERATORS } from "@/lib/catalog";
import type { AppConfig, ConfigPatch } from "@/lib/types";
import { VerPill } from "./analytics";
import { ErrorBox, Lang, Note, Panel, PermNote, Skel, Tag, Toggle, useApiErrorToast, usePerm, useToast } from "./ui";

const opName = (id: string | null | undefined) => OPERATORS.find((o) => o.id === id)?.name ?? id ?? "-";

function usePatch() {
  const toast = useToast();
  const onErr = useApiErrorToast();
  return async (body: ConfigPatch & { reason: string }, label: string) => {
    try {
      const r = await api.patchConfig(body);
      toast(
        <>
          {label} 변경을 적용했습니다 · <span className="mono">{r.changed.join(", ") || "변경 없음"}</span> · 감사 로그 기록
        </>,
        "success",
      );
      revalidateKey("config");
      revalidateKey("audit");
      return true;
    } catch (e) {
      onErr(e);
      return false;
    }
  };
}

export function ConfigScreen() {
  const { data: c, error, mutate } = useApi(["config"], () => api.config(), { revalidateOn: ["audit"] });
  if (error && !c)
    return (
      <div className="screen">
        <ErrorBox error={error} retry={() => mutate()} />
      </div>
    );
  return (
    <div className="screen enter">
      <div className="head-row">
        <div>
          <div className="eyebrow">Screen 6 · Runtime Config (Firestore)</div>
          <h1 className="h1">System Configuration</h1>
          <div className="sub">Terraform 기본값 대비 차이를 함께 표시합니다. 모든 변경은 config.write 권한과 운영자가 입력한 사유가 필요하며 감사 로그에 남습니다.</div>
        </div>
        <PermNote perm="config.write" label="설정 변경" />
      </div>
      {!c ? (
        <>
          <Skel h={260} />
          <div className="grid g2">
            <Skel h={260} />
            <Skel h={260} />
          </div>
        </>
      ) : (
        <>
          <Drift c={c} />
          <div className="grid g2">
            <CapacityTable c={c} />
            <RetryForm key={JSON.stringify([c.retry, c.workflowTimeoutMin, c.pipelineTimeoutMin])} c={c} />
            <QueueForm key={JSON.stringify(c.queuePolicy)} c={c} />
            <Roles c={c} />
          </div>
          <Versions key={JSON.stringify([c.defaultPipelineVersion, c.pipelineVersionDetails.map((v) => v.trafficPct)])} c={c} />
          <Services c={c} />
          <AlertPolicies c={c} />
        </>
      )}
      <AuditLog />
    </div>
  );
}

function Drift({ c }: { c: AppConfig }) {
  const keys = Object.keys(c.runtimeConfig);
  return (
    <Panel
      title="Terraform 기본값 ↔ Runtime 차이"
      icon={<GitBranch aria-hidden />}
      right={
        <span className="pill sm t-retry">
          <AlertTriangle aria-hidden />
          DRIFT {c.drift.length}
        </span>
      }
    >
      <div className="tbl-wrap">
        <table className="tbl fluid">
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
            <AnimatePresence initial={false}>
              {keys.map((k) => {
                const d = c.drift.find((x) => x.key === k);
                return (
                  <motion.tr key={k} layout="position" style={{ opacity: d ? 1 : 0.62 }}>
                    <td className="mono nw">{k}</td>
                    <td className="r mono nw">{JSON.stringify(c.terraformDefaults[k])}</td>
                    <td className={clsx("r mono nw", d && "drift")}>
                      {JSON.stringify(c.runtimeConfig[k])}
                      {d ? " ●" : ""}
                    </td>
                    <td className="nw">{d ? opName(d.changedBy) : <span className="sub">—</span>}</td>
                    <td className="mono nw">{d?.changedAt ? fmt.dateTime(d.changedAt).slice(5) : ""}</td>
                    <td style={{ minWidth: 220 }}>{d ? d.reason ?? "" : <span className="sub">기본값과 동일</span>}</td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ marginTop: 8 }}>
        ● 표시는 운영 중 변경된 값입니다. 다음 Terraform apply 전에 변수 파일(environments/prod)에 반영하거나 되돌리세요.
      </div>
    </Panel>
  );
}

function CapacityTable({ c }: { c: AppConfig }) {
  return (
    <Panel
      title="Language · Global Capacity"
      icon={<Gauge aria-hidden />}
      right={
        <Link className="btn sm" href="/flowline/capacity">
          Capacity 화면에서 편집 <ChevronRight aria-hidden />
        </Link>
      }
    >
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>언어</th>
              <th className="r">maxConcurrent</th>
              <th className="r">starts/min</th>
              <th className="r">weight</th>
              <th className="r">batch</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {c.languages.map((l) => (
              <tr key={l.code}>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <Lang code={l.code} />
                    {l.name}
                  </span>
                </td>
                <td className="r mono">{l.maxConcurrent}</td>
                <td className="r mono">{l.maxStartsPerMinute}</td>
                <td className="r mono">{l.priorityWeight}</td>
                <td className="r mono">{l.batchSize}</td>
                <td>
                  {l.paused ? (
                    <span className="pill sm t-cancelled">일시 중지</span>
                  ) : (
                    <span className="pill sm t-success">
                      <Check aria-hidden />
                      활성
                    </span>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Global</b>
              </td>
              <td className="r mono">
                <b>{c.global.maxConcurrent}</b>
              </td>
              <td className="r mono">{c.global.maxStartsPerMinute}</td>
              <td colSpan={3} className="sub">
                언어별 합계 <span className="mono">{c.languages.reduce((a, l) => a + l.maxConcurrent, 0)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function FieldErr({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <span className="field-err">
      <AlertTriangle aria-hidden />
      {msg}
    </span>
  );
}

function RetryForm({ c }: { c: AppConfig }) {
  const { can } = usePerm();
  const patch = usePatch();
  const toast = useToast();
  const [v, setV] = useState({ mr: String(c.retry.maxRetries), b1: String(c.retry.backoffSeconds[0] ?? 60), b2: String(c.retry.backoffSeconds[1] ?? 300), wto: String(c.workflowTimeoutMin), pto: String(c.pipelineTimeoutMin), reason: "" });
  const [busy, setBusy] = useState(false);
  const errs: Record<string, string> = {};
  const n = (s: string) => Number(s);
  const int = (s: string) => s.trim() !== "" && Number.isInteger(n(s));
  if (!int(v.mr) || n(v.mr) < 0 || n(v.mr) > 5) errs.mr = "0–5 정수만 허용";
  if (!int(v.b1) || n(v.b1) < 1 || n(v.b1) > 3600) errs.b1 = "1–3600초 정수";
  if (!int(v.b2) || n(v.b2) < 1 || n(v.b2) > 3600) errs.b2 = "1–3600초 정수";
  else if (!errs.b1 && n(v.b2) < n(v.b1)) errs.b2 = `backoff 2는 backoff 1(${v.b1}s) 이상이어야 합니다`;
  if (!int(v.wto) || n(v.wto) < 5 || n(v.wto) > 360) errs.wto = "5–360분 정수";
  if (!int(v.pto) || n(v.pto) < 5 || n(v.pto) > 360) errs.pto = "5–360분 정수";
  else if (!errs.wto && n(v.pto) > n(v.wto)) errs.pto = `Pipeline timeout은 Workflow timeout(${v.wto}분) 이하여야 합니다`;
  const body: ConfigPatch = {};
  if (n(v.mr) !== c.retry.maxRetries || n(v.b1) !== c.retry.backoffSeconds[0] || n(v.b2) !== c.retry.backoffSeconds[1]) body.retry = { maxRetries: n(v.mr), backoffSeconds: [n(v.b1), n(v.b2)] };
  if (n(v.wto) !== c.workflowTimeoutMin) body.workflowTimeoutMin = n(v.wto);
  if (n(v.pto) !== c.pipelineTimeoutMin) body.pipelineTimeoutMin = n(v.pto);
  const has = Object.keys(body).length > 0;
  const save = async () => {
    if (Object.keys(errs).length) return toast("입력값을 확인하세요 · " + Object.values(errs)[0], "failed");
    if (!has) return toast("변경된 값이 없습니다", "retry");
    if (!v.reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    setBusy(true);
    await patch({ ...body, reason: v.reason.trim() }, "Retry · Timeout");
    setBusy(false);
  };
  const fld = (k: keyof typeof v, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input className="inp mono" type="number" value={v[k]} aria-invalid={!!errs[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      <FieldErr msg={errs[k]} />
    </label>
  );
  return (
    <Panel title="Retry · Timeout" icon={<RotateCcw aria-hidden />} bodyClassName="stack">
      <div className="filters" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))" }}>
        {fld("mr", "maxRetries (자동 재실행)")}
        {fld("b1", "backoff 1 (s)")}
        {fld("b2", "backoff 2 (s)")}
        {fld("wto", "Workflow timeout (분)")}
        {fld("pto", "Pipeline timeout (분)")}
        <label className="field">
          <span>Reservation lease (분)</span>
          <input className="inp mono" type="number" value={c.reservationLeaseMin} disabled />
        </label>
      </div>
      <Note icon={<Info aria-hidden />}>
        최대 자동 실행 횟수 <b className="mono">{c.retry.maxAttempts}회</b>(계획서 §4.3) · 재시도 불가:{" "}
        {c.retry.nonRetryable.map((x) => (
          <Tag key={x}>{x}</Tag>
        ))}{" "}
        · 제한적 Retry:{" "}
        {Object.entries(c.retry.limitedRetry).map(([k, n2]) => (
          <Tag key={k}>
            {k} {n2}회
          </Tag>
        ))}
      </Note>
      <label className="field">
        <span>변경 사유 (필수)</span>
        <input className="inp" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="예: LLM Judge 지연 대응" />
      </label>
      <div className="row end">
        <span className="sub">{has ? "변경 대기: " + Object.keys(body).join(", ") : "변경 없음"}</span>
        <button className="btn sm primary" onClick={save} disabled={busy || !can("config.write") || Object.keys(errs).length > 0}>
          <Check aria-hidden />
          적용
        </button>
      </div>
    </Panel>
  );
}

function QueueForm({ c }: { c: AppConfig }) {
  const { can } = usePerm();
  const patch = usePatch();
  const toast = useToast();
  const q = c.queuePolicy;
  const [v, setV] = useState({ mode: q.mode, enabled: q.aging.enabled, boost: String(q.aging.boostPerMinutes), max: String(q.aging.maxBoost), reason: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const body: ConfigPatch = {};
    const aging: Partial<typeof q.aging> = {};
    if (v.enabled !== q.aging.enabled) aging.enabled = v.enabled;
    if (+v.boost !== q.aging.boostPerMinutes) aging.boostPerMinutes = +v.boost;
    if (+v.max !== q.aging.maxBoost) aging.maxBoost = +v.max;
    if (Object.keys(aging).length) body.queuePolicy = { aging };
    if (v.mode !== q.mode) body.queuePolicy = { ...(body.queuePolicy ?? {}), mode: v.mode };
    if (!Object.keys(body).length) return toast("변경된 값이 없습니다", "retry");
    if (!v.reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    setBusy(true);
    await patch({ ...body, reason: v.reason.trim() }, "Queue Priority");
    setBusy(false);
  };
  return (
    <Panel title="Queue Priority" icon={<ListOrdered aria-hidden />} bodyClassName="stack">
      <div className="filters" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>
        <label className="field">
          <span>언어 내 선택</span>
          <select className="inp" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
            <option>PRIORITY_THEN_FIFO</option>
            <option>FIFO</option>
          </select>
        </label>
        <label className="field">
          <span>언어 간 배분 (Terraform 관리)</span>
          <input className="inp mono" value={q.crossLanguage} disabled />
        </label>
        <label className="field">
          <span>Aging (+1 / N분)</span>
          <input className="inp mono" type="number" min={1} value={v.boost} onChange={(e) => setV({ ...v, boost: e.target.value })} />
        </label>
        <label className="field">
          <span>최대 boost</span>
          <input className="inp mono" type="number" min={0} value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
        </label>
      </div>
      <div className="row" style={{ gap: 8, fontSize: 12.5 }}>
        <Toggle checked={v.enabled} onClick={() => setV({ ...v, enabled: !v.enabled })} label="Aging 사용" />
        Starvation 방지 Aging 사용 <span className="sub">(아래 사유와 함께 적용)</span>
      </div>
      <label className="field">
        <span>변경 사유 (필수)</span>
        <input className="inp" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="예: ko 적체 시 es 기아 방지" />
      </label>
      <div className="row end">
        <button className="btn sm primary" onClick={save} disabled={busy || !can("config.write")}>
          <Check aria-hidden />
          적용
        </button>
      </div>
    </Panel>
  );
}

function Roles({ c }: { c: AppConfig }) {
  return (
    <Panel title="운영자 권한" icon={<Users aria-hidden />}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="ko">권한</th>
              <th>Viewer</th>
              <th>Operator</th>
              <th>Admin</th>
            </tr>
          </thead>
          <tbody>
            {c.rolePermissions.map((p) => (
              <tr key={p.key}>
                <td>
                  {p.permission} <span className="mono-sub">{p.key}</span>
                </td>
                {(["Viewer", "Operator", "Admin"] as const).map((r) => (
                  <td key={r}>{p[r] ? <Check size={14} style={{ color: "var(--st-success)" }} aria-label="허용" /> : <span style={{ color: "var(--faint)" }} aria-label="불가">—</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="stack" style={{ marginTop: 10, gap: 4 }}>
        {c.operators.map((o) => (
          <div key={o.id} className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
            <span>
              {o.name} <span className="sub">{o.team}</span>
            </span>
            <Tag>{o.role}</Tag>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Versions({ c }: { c: AppConfig }) {
  const { can } = usePerm();
  const patch = usePatch();
  const toast = useToast();
  const [promote, setPromote] = useState<{ v: string; reason: string } | null>(null);
  const [traffic, setTraffic] = useState<Record<string, string>>(() => Object.fromEntries(c.pipelineVersionDetails.map((v) => [v.version, String(v.trafficPct)])));
  const [tReason, setTReason] = useState("");
  const sum = Object.values(traffic).reduce((a, x) => a + (Number(x) || 0), 0);
  const tChanged = c.pipelineVersionDetails.some((v) => Number(traffic[v.version]) !== v.trafficPct);
  const vers = useApi(["analytics-versions"], () => api.versions());
  const doPromote = async () => {
    if (!promote) return;
    if (!promote.reason.trim()) return toast("승격 사유를 입력하세요", "retry");
    if (await patch({ defaultPipelineVersion: promote.v, reason: promote.reason.trim() }, `기본 버전 ${promote.v}`)) setPromote(null);
  };
  const doTraffic = async () => {
    if (sum !== 100) return toast(`트래픽 합계는 100이어야 합니다 (현재 ${sum})`, "failed");
    if (!tReason.trim()) return toast("변경 사유를 입력하세요", "retry");
    await patch({ versionTraffic: Object.fromEntries(Object.entries(traffic).map(([k, x]) => [k, Number(x) || 0])), reason: tReason.trim() }, "버전 트래픽");
  };
  return (
    <Panel title="Pipeline Version" icon={<Layers aria-hidden />} right={<span className="sub">default <span className="mono">{c.defaultPipelineVersion}</span> · 승격·트래픽 변경은 version.promote 권한 + 사유</span>}>
      <div className="tbl-wrap">
        <table className="tbl fluid">
          <thead>
            <tr>
              <th>버전</th>
              <th>상태</th>
              <th className="r">트래픽 %</th>
              <th>모델 · Judge</th>
              <th>릴리스</th>
              <th>메모 · Template</th>
              <th>기본 버전</th>
            </tr>
          </thead>
          <tbody>
            {c.pipelineVersionDetails.map((v) => (
              <tr key={v.version}>
                <td className="mono nw">
                  <b>{v.version}</b>
                </td>
                <td>
                  <VerPill status={v.status} />
                </td>
                <td className="r nw">
                  <input
                    className="inp mono"
                    style={{ width: 70, textAlign: "right" }}
                    type="number"
                    min={0}
                    max={100}
                    aria-label={`${v.version} 트래픽 %`}
                    value={traffic[v.version] ?? "0"}
                    disabled={v.status === "DEPRECATED"}
                    onChange={(e) => setTraffic({ ...traffic, [v.version]: e.target.value })}
                  />
                </td>
                <td style={{ minWidth: 170 }}>
                  <div className="mono" style={{ fontSize: 11.5 }}>
                    {v.modelUnderTest}
                  </div>
                  <div className="mono-sub">judge {v.judgeModel}</div>
                </td>
                <td className="mono nw">{fmt.date(v.releasedAt)}</td>
                <td style={{ minWidth: 260 }}>
                  {v.notes}
                  <div className="mono-sub">{v.templateUri}</div>
                </td>
                <td className="nw">
                  {v.version === c.defaultPipelineVersion ? (
                    <span className="pill sm t-success">
                      <Check aria-hidden />
                      현재 기본값
                    </span>
                  ) : v.status !== "DEPRECATED" ? (
                    <button className="btn sm" onClick={() => setPromote({ v: v.version, reason: "" })} disabled={!can("version.promote")}>
                      <ChevronRight aria-hidden />
                      기본값으로
                    </button>
                  ) : (
                    <span className="sub">승격 불가</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tChanged && (
        <div className="confirm" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5 }}>
            트래픽 분배 변경 · 합계 <b className={clsx("mono")} style={{ color: sum === 100 ? "var(--st-success)" : "var(--st-failed)" }}>{sum}%</b>
            {sum !== 100 && " — 100이 되어야 적용할 수 있습니다"}
          </div>
          <label className="field">
            <span>변경 사유 (필수)</span>
            <input className="inp" value={tReason} onChange={(e) => setTReason(e.target.value)} placeholder="예: v1.2-rc canary 확대 50%" />
          </label>
          <div className="row end">
            <button className="btn sm" onClick={() => setTraffic(Object.fromEntries(c.pipelineVersionDetails.map((v) => [v.version, String(v.trafficPct)])))}>
              되돌리기
            </button>
            <button className="btn sm primary" onClick={doTraffic} disabled={sum !== 100 || !can("version.promote")}>
              <Check aria-hidden />
              트래픽 적용
            </button>
          </div>
        </div>
      )}
      <AnimatePresence>
        {promote && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <div className="confirm" style={{ marginTop: 10 }}>
              <Note tone="retry" icon={<AlertTriangle aria-hidden />}>
                <b className="mono">{promote.v}</b>을 기본 버전으로 승격합니다. 실행 중 PipelineJob은 기존 버전을 유지하고 신규 배치부터 적용됩니다.
                {promote.v === "v1.2-rc" ? " device_control 캡슐 회귀(Analytics 참조)가 있습니다." : ""} 발화 Pass rate{" "}
                <span className="mono">{fmt.pct(vers.data?.find((x) => x.version === promote.v)?.utterancePassRate, 1)}</span>
              </Note>
              <label className="field">
                <span>승격 사유 (필수)</span>
                <input className="inp" value={promote.reason} onChange={(e) => setPromote({ ...promote, reason: e.target.value })} autoFocus />
              </label>
              <PermNote perm="version.promote" label="Pipeline 버전 승격" />
              <div className="row end">
                <button className="btn sm" onClick={() => setPromote(null)}>
                  닫기
                </button>
                <button className="btn sm primary" onClick={doPromote} disabled={!can("version.promote")}>
                  <Check aria-hidden />
                  승격
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

/** Switches never apply on click: an inline confirm row asks for a reason first. */
function useToggleConfirm() {
  const [pending, setPending] = useState<{ id: string; to: boolean; reason: string } | null>(null);
  return { pending, setPending };
}

function ConfirmRow({ cols, title, from, to, note, reason, setReason, onCancel, onApply }: { cols: number; title: string; from: string; to: string; note?: string; reason: string; setReason: (s: string) => void; onCancel: () => void; onApply: () => void }) {
  return (
    <tr className="confirm-row">
      <td colSpan={cols}>
        <div className="confirm" style={{ margin: "2px 0" }}>
          <div className="steps">
            <span>1 클릭</span>
            <ChevronRight aria-hidden />
            <b className="on">2 사유 입력 · 확인</b>
          </div>
          <div style={{ fontSize: 12.5 }}>
            <b>{title}</b> · {from} → <b>{to}</b>
            {note && (
              <div className="sub" style={{ marginTop: 2 }}>
                {note}
              </div>
            )}
          </div>
          <label className="field">
            <span>변경 사유 (필수 · 감사 로그 기록)</span>
            <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 점검 중 알림 소음 억제 (CHG-1234)" autoFocus />
          </label>
          <div className="row end">
            <button className="btn sm" onClick={onCancel}>
              취소
            </button>
            <button className="btn sm primary" onClick={onApply}>
              <Check aria-hidden />
              적용
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Services({ c }: { c: AppConfig }) {
  const { can } = usePerm();
  const patch = usePatch();
  const toast = useToast();
  const { pending, setPending } = useToggleConfirm();
  const apply = async () => {
    if (!pending) return;
    if (!pending.reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    if (await patch({ services: { [pending.id]: { enabled: pending.to } }, reason: pending.reason.trim() }, `서비스 ${pending.id} ${pending.to ? "활성화" : "비활성화"}`)) setPending(null);
  };
  return (
    <Panel title="서비스 활성화 상태" icon={<Cpu aria-hidden />} right={<span className="sub">스위치를 누르면 사유 입력 후 적용됩니다</span>}>
      <div className="tbl-wrap">
        <table className="tbl fluid">
          <thead>
            <tr>
              <th>활성</th>
              <th>서비스</th>
              <th>상태</th>
              <th>버전 · revision</th>
              <th className="r">인스턴스</th>
              <th className="r">오류율</th>
              <th className="r">p95</th>
            </tr>
          </thead>
          <tbody>
            {c.services.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td className="nw">
                    <span className="toggle-cell">
                      <Toggle
                        checked={s.enabled}
                        pending={pending?.id === s.id}
                        disabled={!can("config.write")}
                        label={`${s.name} 활성`}
                        onClick={() => setPending(pending?.id === s.id ? null : { id: s.id, to: !s.enabled, reason: "" })}
                      />
                      <small>{s.enabled ? "켜짐" : "꺼짐"}</small>
                    </span>
                  </td>
                  <td style={{ minWidth: 170 }}>
                    <b>{s.name}</b>
                    <div className="mono-sub">{s.runtime}</div>
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <span className={`pill sm t-${s.status === "HEALTHY" ? "success" : s.status === "DISABLED" ? "cancelled" : "retry"}`}>
                      {s.status === "HEALTHY" ? <ShieldCheck aria-hidden /> : <AlertTriangle aria-hidden />}
                      {s.status}
                    </span>
                    {s.note && (
                      <div className="sub" style={{ marginTop: 2 }}>
                        {s.note}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="mono-sub">
                      {s.version} · {s.revision}
                    </div>
                  </td>
                  <td className="r mono nw">
                    {s.instances} <span className="sub">({s.minInstances}–{s.maxInstances})</span>
                  </td>
                  <td className="r mono nw">{fmt.pct(s.errorRate, 2)}</td>
                  <td className="r mono nw">{s.p95LatencyMs}ms</td>
                </tr>
                {pending?.id === s.id && (
                  <ConfirmRow
                    cols={7}
                    title={s.name}
                    from={s.enabled ? "활성" : "비활성"}
                    to={pending.to ? "활성" : "비활성"}
                    note={pending.to ? undefined : "비활성화하면 이 서비스가 처리하던 단계의 신규 작업이 멈춥니다. 진행 중 작업은 끝까지 진행됩니다."}
                    reason={pending.reason}
                    setReason={(r) => setPending({ ...pending, reason: r })}
                    onCancel={() => setPending(null)}
                    onApply={apply}
                  />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AlertPolicies({ c }: { c: AppConfig }) {
  const { can } = usePerm();
  const patch = usePatch();
  const toast = useToast();
  const { pending, setPending } = useToggleConfirm();
  const apply = async () => {
    if (!pending) return;
    if (!pending.reason.trim()) return toast("변경 사유를 입력하세요", "retry");
    if (await patch({ alertPolicies: { [pending.id]: { enabled: pending.to } }, reason: pending.reason.trim() }, `알림 정책 ${pending.id}`)) setPending(null);
  };
  return (
    <Panel title="알림 정책" icon={<Bell aria-hidden />} right={<span className="sub">계획서 §7.5 · 스위치를 누르면 사유 입력 후 적용됩니다</span>}>
      <div className="tbl-wrap">
        <table className="tbl fluid">
          <thead>
            <tr>
              <th>사용</th>
              <th>정책</th>
              <th>조건</th>
              <th>심각도</th>
              <th>채널</th>
            </tr>
          </thead>
          <tbody>
            {c.alertPolicies.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <td className="nw">
                    <span className="toggle-cell">
                      <Toggle checked={p.enabled} pending={pending?.id === p.id} disabled={!can("config.write")} label={p.name} onClick={() => setPending(pending?.id === p.id ? null : { id: p.id, to: !p.enabled, reason: "" })} />
                      <small>{p.enabled ? "켜짐" : "꺼짐"}</small>
                    </span>
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <b>{p.name}</b>
                    <div className="mono-sub">{p.metric}</div>
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {p.condition}
                    </span>
                  </td>
                  <td>
                    <span className={`pill sm t-${p.severity === "CRITICAL" ? "failed" : p.severity === "INFO" ? "running" : "retry"}`}>
                      <AlertTriangle aria-hidden />
                      {p.severity}
                    </span>
                  </td>
                  <td className="nw">
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
                      {p.channels.map((ch) => (
                        <div key={ch}>{ch}</div>
                      ))}
                    </div>
                  </td>
                </tr>
                {pending?.id === p.id && (
                  <ConfirmRow
                    cols={5}
                    title={"알림 정책 · " + p.name}
                    from={p.enabled ? "사용" : "사용 안 함"}
                    to={pending.to ? "사용" : "사용 안 함"}
                    note={pending.to ? undefined : `끄면 ${p.channels.join(", ")}로 가는 알림이 중단됩니다.`}
                    reason={pending.reason}
                    setReason={(r) => setPending({ ...pending, reason: r })}
                    onCancel={() => setPending(null)}
                    onApply={apply}
                  />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const AUDIT_TONE: Record<string, string> = {
  CAPACITY_UPDATED: "running",
  GLOBAL_CAPACITY_UPDATED: "running",
  CONFIG_UPDATED: "running",
  LANGUAGE_PAUSED: "retry",
  LANGUAGE_RESUMED: "success",
  PIPELINE_VERSION_PROMOTED: "success",
  PIPELINE_VERSION_CANARY: "retry",
  PIPELINE_VERSION_DEPRECATED: "cancelled",
  DLQ_REPLAY_REQUESTED: "dlq",
  DLQ_REPLAY_APPROVED: "dlq",
  DLQ_CLOSED: "cancelled",
  DLQ_ASSIGNED: "dlq",
  WORKFLOW_CANCELLED: "cancelled",
  ROLE_GRANTED: "queued",
  ALERT_ACKNOWLEDGED: "queued",
  ALERT_RESOLVED: "success",
};
const AUDIT_PARSERS = { action: parseAsString, actor: parseAsString };

function AuditLog() {
  const [f, setF] = useQueryStates(AUDIT_PARSERS);
  const q = { action: f.action ?? undefined, actor: f.actor ?? undefined, pageSize: 60 };
  const { data } = useApi(["audit", q], () => api.audit(q), { revalidateOn: ["audit"], throttleMs: 600 });
  const allActions = useApi(["audit", "actions"], () => api.audit({ pageSize: 500 }), { revalidateOn: ["audit"], throttleMs: 3000 });
  const actions = useMemo(() => [...new Set([...Object.keys(AUDIT_TONE), ...(allActions.data?.items ?? []).map((a) => a.action)])].sort(), [allActions.data]);
  return (
    <Panel
      title="감사 로그"
      icon={<Shield aria-hidden />}
      right={
        <div className="row">
          <select className="inp" style={{ width: "auto" }} aria-label="작업자 필터" value={f.actor ?? ""} onChange={(e) => setF({ actor: e.target.value || null })}>
            <option value="">전체 작업자</option>
            {OPERATORS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
          <select className="inp mono" style={{ width: "auto" }} aria-label="Action 필터" value={f.action ?? ""} onChange={(e) => setF({ action: e.target.value || null })}>
            <option value="">전체 Action</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <div className="sub" style={{ marginBottom: 6 }}>
        <span className="mono">{data?.total ?? "-"}</span>건 · 실시간(SSE audit) · 최신순
      </div>
      <div className="tbl-wrap fade-end" style={{ maxHeight: 460, overflowY: "auto" }}>
        <table className="tbl fluid">
          <thead>
            <tr>
              <th>시각</th>
              <th>작업자</th>
              <th>Action</th>
              <th>대상</th>
              <th>변경 (before → after)</th>
              <th>사유</th>
              <th>request · IP</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {(data?.items ?? []).map((a) => (
                <motion.tr key={a.audit_id} layout="position" initial={{ opacity: 0, backgroundColor: "var(--accent-soft)" }} animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 1.2 }}>
                  <td className="mono nw">{fmt.dateTime(a.ts).slice(5)}</td>
                  <td className="nw">
                    {a.actorName} <span className="sub">{a.role}</span>
                  </td>
                  <td>
                    <span className={`pill sm t-${AUDIT_TONE[a.action] ?? "queued"}`}>{a.action === "CONFIG_UPDATED" ? <Info aria-hidden /> : a.action.startsWith("DLQ") ? <RotateCcw aria-hidden /> : <Lock aria-hidden />}{a.action}</span>
                  </td>
                  <td className="mono" style={{ minWidth: 120 }}>
                    {a.target}
                  </td>
                  <td style={{ minWidth: 200, maxWidth: 340 }}>
                    <div className="mono-sub">
                      {JSON.stringify(a.before)} → {JSON.stringify(a.after)}
                    </div>
                  </td>
                  <td style={{ minWidth: 180 }}>{a.reason ?? ""}</td>
                  <td className="nw">
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
                      {a.request_id}
                      <br />
                      {a.source_ip}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export type { ReactNode };
