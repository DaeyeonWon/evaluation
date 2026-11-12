"use client";
/**
 * S-05 · DLQ operations. Group by failure category, filter (URL), log preview + history, single
 * replay with in-page confirmation (POST /dead-letters/{id}/replay → REPLAYING → new replay cycle in
 * the simulator), close, assign, and batch replay of the checked rows.
 */
import clsx from "clsx";
import { Archive, Check, Map as MapIcon, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CatalogIcon, LangBadge, StatusPill, fmt } from "@/components/shared";
import { DLQ_STATUS_META, FAILURE_CATEGORY_META, LANG_CODES, OPERATORS } from "@/lib/catalog";
import { api, parseAsList, parseAsString, revalidateKey, useApi, useQueryStates, useSimNow } from "@/lib/client";
import type { DeadLetter, DlqStatus, FailureCategory, LangCode } from "@/lib/types";
import { Empty, ErrorNote, OperatorSelect, PermNote, Plate, Sheet, SheetHead, Skeleton, opName, usePerms, useToast } from "./ui";

const PARSERS = { sel: parseAsString, status: parseAsString, language: parseAsList, range: parseAsString, q: parseAsString, category: parseAsString };
const RANGES: [string, string, number][] = [
  ["", "전체 기간", 0],
  ["h1", "최근 1시간", 3600e3],
  ["h24", "최근 24시간", 86400e3],
  ["d7", "최근 7일", 7 * 86400e3],
];
const replayable = (d: DeadLetter | undefined) => !!d && (d.status === "PENDING_REVIEW" || d.status === "APPROVED");

function useVersions() {
  const cfg = useApi(["config"], () => api.config(), { revalidateOn: ["audit"] });
  return cfg.data?.pipelineVersionDetails ?? [];
}

function Detail({ id, mode, setMode }: { id: string; mode: null | "replay" | "close"; setMode: (m: null | "replay" | "close") => void }) {
  const q = useApi(["dead-letters", "detail", id], () => api.deadLetter(id), { revalidateOn: ["dlq", "transition"] });
  const now = useSimNow();
  const toast = useToast();
  const { can } = usePerms();
  const versions = useVersions();
  const [reason, setReason] = useState("");
  const [ver, setVer] = useState("");
  const [res, setRes] = useState("");
  const [busy, setBusy] = useState(false);
  const det = q.data?.deadLetter.dead_letter_id === id ? q.data : undefined;
  if (q.error && !det) return <ErrorNote error={q.error} />;
  if (!det) return <Skeleton rows={8} />;
  const d = det.deadLetter;
  const cat = FAILURE_CATEGORY_META[d.failure_category];
  const warn =
    d.failure_category === "INPUT_SCHEMA"
      ? "입력 스키마 오류는 원본 데이터를 수정하지 않는 한 같은 결과가 나옵니다. 새 입력 Artifact 버전을 만든 뒤 Replay하거나 종료 처리하세요."
      : d.failure_category === "AUTH_PERMISSION"
        ? "권한 오류는 IAM 바인딩을 먼저 수정해야 합니다. 수정 전 Replay는 같은 오류로 실패합니다."
        : d.failure_category === "CODE_DEFECT"
          ? "코드 결함은 수정된 Pipeline 버전으로 Replay해야 합니다. 아래에서 버전을 바꿀 수 있습니다."
          : "";
  const replay = async () => {
    setBusy(true);
    try {
      const r = await api.replayDeadLetter(d.dead_letter_id, { reason, pipeline_version: ver || undefined });
      toast.ok(
        <>
          Replay 승인 완료 · <b>{r.replay.replay_id}</b> → 새 Workflow <b>{r.workflow.workflow_id}</b> (cycle {r.workflow.replay_cycle})가 {r.workflow.status} 상태로 등록되었습니다.
        </>,
      );
      setMode(null);
      setReason("");
      revalidateKey("dead-letters");
      revalidateKey("replays");
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    setBusy(true);
    try {
      await api.closeDeadLetter(d.dead_letter_id, { resolution: res });
      toast.ok(`${d.dead_letter_id} 종료 처리했습니다.`);
      setMode(null);
      revalidateKey("dead-letters");
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };
  const wfCycle = det.workflow?.replay_cycle ?? 0;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b className="mono" style={{ fontSize: 16, fontWeight: 500 }}>
          {d.dead_letter_id}
        </b>
        <StatusPill kind="dlq" status={d.status} />
        <span className="chip">{cat?.label ?? d.failure_category}</span>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>
          {cat?.policy}
        </span>
      </div>
      <dl className="kv">
        <dt>Workflow</dt>
        <dd>
          <Link className="mono" href={`/workflows/${d.workflow_id}`}>
            {d.workflow_id}
          </Link>
        </dd>
        <dt>오류</dt>
        <dd className="mono">
          {d.error_code} @ {d.failed_node ?? "—"}
        </dd>
        <dt>원인</dt>
        <dd>{d.failure_reason}</dd>
        <dt>입력</dt>
        <dd className="mono">
          {d.input_uri} · {d.utterance_count} utt
        </dd>
        <dt>버전 · Attempts</dt>
        <dd className="mono">
          {d.pipeline_version} · {d.attempts}회
        </dd>
        <dt>마지막 PipelineJob</dt>
        <dd className="mono">{d.last_pipeline_job_id}</dd>
        <dt>발생</dt>
        <dd className="mono">
          {fmt.dateTime(d.created_at)} ({fmt.relative(d.created_at, now)})
        </dd>
        <dt>담당자</dt>
        <dd>
          <select
            className="in"
            style={{ height: 27, maxWidth: 240 }}
            value={d.assigned_operator ?? ""}
            aria-label="담당자 배정"
            onChange={async (e) => {
              try {
                await api.assignDeadLetter(d.dead_letter_id, { operator_id: e.target.value || null, reason: "DLQ 화면에서 담당자 배정" });
                toast.ok(`${d.dead_letter_id} 담당자를 ${opName(e.target.value) === "—" ? "미배정" : opName(e.target.value)}(으)로 지정했습니다.`);
                revalidateKey("dead-letters");
              } catch (err) {
                toast.err(err);
              }
            }}
          >
            <option value="">미배정</option>
            {OPERATORS.filter((o) => o.role !== "Viewer").map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </dd>
      </dl>
      {warn ? <div className="note warn">{warn}</div> : null}
      <div>
        <div className="grp-t" style={{ padding: "0 0 6px" }}>
          최근 실패 로그
        </div>
        <pre className="code wrap" style={{ maxHeight: 180 }}>
          {d.last_log_excerpt}
        </pre>
      </div>
      {d.last_stack_trace ? (
        <details>
          <summary className="mono" style={{ cursor: "pointer", fontSize: 11.5, color: "var(--st-failed)" }}>
            Stack trace 펼치기
          </summary>
          <pre className="code" style={{ color: "var(--st-failed)", marginTop: 6 }}>
            {d.last_stack_trace}
          </pre>
        </details>
      ) : null}
      <div>
        <div className="grp-t" style={{ padding: "0 0 6px" }}>
          이전 실행 이력
        </div>
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>PipelineJob</th>
                <th>상태</th>
                <th>오류</th>
                <th>시작</th>
                <th>소요</th>
              </tr>
            </thead>
            <tbody>
              {d.attempt_history.map((a) => (
                <tr key={a.attempt}>
                  <td className="mono">{a.attempt}</td>
                  <td className="idc">{a.pipeline_job_id}</td>
                  <td>
                    <StatusPill kind="attempt" status={a.status} />
                  </td>
                  <td className="mono sev-ERROR">{a.error_code ?? "—"}</td>
                  <td className="mono muted">{fmt.time(a.started_at)}</td>
                  <td className="mono">{a.started_at && a.completed_at ? fmt.duration(a.completed_at - a.started_at, { style: "short" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {d.notes.length ? (
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            운영 메모
          </div>
          {d.notes.map((n, i) => (
            <div className="obj" key={i}>
              <span>{n.text}</span>
              <span className="om">
                <span>{opName(n.by)}</span>
                <span>{fmt.dateTime(n.at)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {det.replays.length ? (
        <div>
          <div className="grp-t" style={{ padding: "0 0 6px" }}>
            Replay 결과
          </div>
          {det.replays.map((r) => {
            const rw = det.replayWorkflows.find((w) => w.workflow_id === r.replay_workflow_id);
            return (
              <div className="obj" key={r.replay_id}>
                <span className="on" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {r.replay_id} · {r.pipeline_version_from} → {r.pipeline_version_to} {rw ? <StatusPill status={rw.status} size="xs" /> : <span className="chip">{r.status}</span>}
                </span>
                <span className="om">
                  <span>{rw ? <Link href={`/workflows/${rw.workflow_id}`}>{rw.workflow_id}</Link> : "—"}</span>
                  <span>{opName(r.approved_by)}</span>
                  <span>{fmt.dateTime(r.created_at)}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {d.resolution ? (
        <div className="note">
          <Check aria-hidden />
          종료 사유: {d.resolution}
        </div>
      ) : null}
      {mode === "replay" ? (
        <div className="confirm" role="group" aria-label="Replay 승인">
          <div className="steps">
            <span className="done">1 로그·이력 검토</span>
            <span className="on">2 사유·버전</span>
            <span>3 승인 확정</span>
          </div>
          <div style={{ fontSize: 13 }}>
            새 Replay Cycle <b className="mono">cycle {wfCycle + 1}</b>을 만들어 <b>{d.language}</b> Language Queue에 우선순위 8로 다시 등록합니다. 원본 입력{" "}
            <span className="mono">{d.input_uri.split("/").pop()}</span>은 수정하지 않습니다.
          </div>
          <PermNote perm="replay.request" />
          <div className="split s-55" style={{ gap: 10 }}>
            <label className="field">
              <span>Pipeline 버전</span>
              <select className="in" value={ver || d.pipeline_version} onChange={(e) => setVer(e.target.value)}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version} disabled={v.status === "DEPRECATED" && v.version !== d.pipeline_version}>
                    {v.version} · {v.status}
                    {v.version === d.pipeline_version ? " (원본)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <OperatorSelect />
          </div>
          <label className="field">
            <span>재실행 사유 (필수 · 감사 기록)</span>
            <textarea className="in" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: GPU quota 증설 확인 (INC-20261110-01 해소) 후 재실행" />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setMode(null)}>
              취소
            </button>
            <button className="btn primary" disabled={busy || reason.trim().length < 4 || !can("replay.request")} onClick={replay}>
              <Check />
              Replay 승인 확정
            </button>
          </div>
        </div>
      ) : mode === "close" ? (
        <div className="confirm" role="group" aria-label="종료 처리">
          <div className="steps">
            <span className="done">1 검토</span>
            <span className="on">2 종료 사유</span>
          </div>
          <label className="field">
            <span>종료 사유 (필수)</span>
            <input className="in" autoFocus value={res} onChange={(e) => setRes(e.target.value)} placeholder="예: 영구 실패 — 입력 배치 폐기" />
          </label>
          <PermNote perm="replay.request" />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setMode(null)}>
              취소
            </button>
            <button className="btn danger" disabled={busy || res.trim().length < 4 || !can("replay.request")} onClick={close}>
              <Archive />
              종료 처리
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn primary" disabled={!replayable(d)} onClick={() => setMode("replay")}>
            <RefreshCw />
            Replay 승인…
          </button>
          <button className="btn" disabled={d.status === "CLOSED" || d.status === "REPLAYING"} onClick={() => setMode("close")}>
            <Archive />
            종료 처리…
          </button>
          {!replayable(d) ? (
            <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
              {d.status === "REPLAYING" ? "Replay 진행 중이라 중복 승인이 차단됩니다." : "이미 처리된 항목입니다."}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function DlqScreen() {
  const [f, setF] = useQueryStates(PARSERS);
  const now = useSimNow();
  const toast = useToast();
  const { can } = usePerms();
  const versions = useVersions();
  const rangeMs = RANGES.find((r) => r[0] === (f.range ?? ""))?.[2] ?? 0;
  // bucket "now" to the minute so the query key is stable between ticks
  const nowMin = Math.floor(now / 60000) * 60000;
  const query = useMemo(
    () => ({
      status: f.status ?? undefined,
      language: f.language.length ? (f.language as LangCode[]) : undefined,
      category: f.category ?? undefined,
      q: f.q ?? undefined,
      from: rangeMs ? nowMin - rangeMs : undefined,
      pageSize: 200,
    }),
    [f.status, f.language, f.category, f.q, rangeMs, nowMin],
  );
  const list = useApi(["dead-letters", "list", query], () => api.deadLetters(query), { revalidateOn: ["dlq"] });
  const allQ = useApi(["dead-letters", "all"], () => api.deadLetters({ pageSize: 200 }), { revalidateOn: ["dlq"] });
  const replays = useApi(["replays", "all"], () => api.replays(), { revalidateOn: ["dlq", "transition"] });
  const replayWfs = useApi(["workflows", "replays"], () => api.workflows({ replay: true, pageSize: 100 }), { revalidateOn: ["transition"] });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<null | "replay" | "close" | "batch">(null);
  const [bReason, setBReason] = useState("");
  const [bVer, setBVer] = useState("");
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const all = allQ.data?.items ?? [];
  const sel = f.sel ?? all.filter((d) => d.status === "PENDING_REVIEW").sort((a, b) => b.created_at - a.created_at)[0]?.dead_letter_id ?? null;
  const groups = useMemo(() => {
    const g: Record<string, DeadLetter[]> = {};
    items.forEach((d) => (g[d.failure_category] ??= []).push(d));
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length) as [FailureCategory, DeadLetter[]][];
  }, [items]);
  const byStatus = allQ.data?.facets.status ?? {};
  const chkItems = [...checked].map((id) => all.find((d) => d.dead_letter_id === id)).filter((d): d is DeadLetter => !!d && replayable(d));

  const batch = async () => {
    setBusy(true);
    try {
      const r = await api.replayBatch({ ids: chkItems.map((d) => d.dead_letter_id), reason: bReason, pipeline_version: bVer || undefined });
      const okIds = r.results.filter((x) => x.ok).map((x) => fmt.shortWorkflowId(x.workflow?.workflow_id));
      toast.ok(
        <>
          Batch Replay {r.succeeded}건 승인{r.failed ? ` · 실패 ${r.failed}건` : ""} · 새 Workflow {okIds.join(", ")}
        </>,
      );
      r.results.filter((x) => !x.ok).forEach((x) => toast.err(`${x.id}: ${x.error}`));
      setChecked(new Set());
      setMode(null);
      setBReason("");
      revalidateKey("dead-letters");
      revalidateKey("replays");
    } catch (e) {
      toast.err(e);
    } finally {
      setBusy(false);
    }
  };

  const rws = new Map((replayWfs.data?.items ?? []).map((w) => [w.workflow_id, w]));

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET S-05 · DLQ OPERATIONS"
        title="DLQ Operations"
        desc="최종 실패와 재시도 불가 오류가 격리됩니다. 로그를 검토한 뒤 종료하거나, 사유를 남기고 수동 Replay를 승인합니다."
        acts={
          <Link className="btn" href="/?stage=dlq">
            <MapIcon />
            DLQ 분기 보기
          </Link>
        }
      />
      <div className="kpis">
        <div className="kpi">
          <div className="k">
            <CatalogIcon name="archive-x" /> DLQ 누적
          </div>
          <div className="v">{allQ.data?.total ?? "—"}</div>
          <div className="s">dead_letters/*</div>
        </div>
        {(Object.keys(DLQ_STATUS_META) as DlqStatus[]).map((s) => {
          const m = DLQ_STATUS_META[s];
          return (
            <button
              key={s}
              className={clsx("kpi", f.status === s && "on")}
              data-tone
              style={{ ["--tc" as string]: `var(--st-${m.tone})` }}
              aria-pressed={f.status === s}
              onClick={() => setF({ status: f.status === s ? null : s })}
            >
              <div className="k">
                <CatalogIcon name={m.icon} /> {m.label}
              </div>
              <div className="v">{byStatus[s] ?? 0}</div>
              <div className="s">{s}</div>
            </button>
          );
        })}
      </div>
      <Plate>
        <div className="filters">
          <label className="field">
            <span>검색</span>
            <input className="in mono" value={f.q ?? ""} onChange={(e) => setF({ q: e.target.value || null })} placeholder="dlq id · workflow · error code" />
          </label>
          <label className="field">
            <span>상태</span>
            <select className="in" value={f.status ?? ""} onChange={(e) => setF({ status: e.target.value || null })}>
              <option value="">전체</option>
              {(Object.keys(DLQ_STATUS_META) as DlqStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DLQ_STATUS_META[s].label} · {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>실패 유형</span>
            <select className="in" value={f.category ?? ""} onChange={(e) => setF({ category: e.target.value || null })}>
              <option value="">전체</option>
              {(Object.keys(FAILURE_CATEGORY_META) as FailureCategory[]).map((c) => (
                <option key={c} value={c}>
                  {FAILURE_CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>발생 시각</span>
            <select className="in" value={f.range ?? ""} onChange={(e) => setF({ range: e.target.value || null })}>
              {RANGES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="field f-wide">
            <span>Language</span>
            <div className="chipset">
              {LANG_CODES.map((c) => (
                <button key={c} aria-pressed={f.language.includes(c)} onClick={() => setF({ language: f.language.includes(c) ? f.language.filter((x) => x !== c) : [...f.language, c] })}>
                  <LangBadge lang={c} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </Plate>
      <div className="split s-46">
        <Plate
          flush
          title="실패 유형별 그룹"
          right={
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {checked.size ? `${checked.size}건 선택` : `${items.length}건`}
              </span>
              <button
                className="btn sm primary"
                onClick={() => {
                  if (!chkItems.length) return toast.err("Batch Replay할 항목을 체크박스로 먼저 선택하세요. (검토 대기·승인 상태만 선택 가능)");
                  setMode("batch");
                }}
              >
                <RefreshCw />
                선택 Batch Replay
              </button>
            </span>
          }
        >
          {mode === "batch" ? (
            <div className="confirm" style={{ margin: 12 }}>
              <div className="steps">
                <span className="done">1 대상 선택 {chkItems.length}건</span>
                <span className="on">2 사유·버전</span>
                <span>3 일괄 승인</span>
              </div>
              <div className="mono" style={{ fontSize: 11.5, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {chkItems.map((d) => (
                  <span className="chip" key={d.dead_letter_id}>
                    {d.dead_letter_id} · {d.language} · {d.error_code}
                  </span>
                ))}
              </div>
              {chkItems.some((d) => d.failure_category === "INPUT_SCHEMA" || d.failure_category === "AUTH_PERMISSION") ? (
                <div className="note warn">선택 항목에 재시도 불가 유형(입력 스키마/권한)이 포함되어 있습니다. 원인을 고치지 않았다면 해당 항목은 같은 오류로 실패합니다.</div>
              ) : null}
              <PermNote perm="replay.request" />
              <div className="split s-55" style={{ gap: 10 }}>
                <label className="field">
                  <span>Pipeline 버전</span>
                  <select className="in" value={bVer} onChange={(e) => setBVer(e.target.value)}>
                    <option value="">각 항목의 원본 버전 유지</option>
                    {versions
                      .filter((v) => v.status !== "DEPRECATED")
                      .map((v) => (
                        <option key={v.version} value={v.version}>
                          {v.version} · {v.status}
                        </option>
                      ))}
                  </select>
                </label>
                <OperatorSelect />
              </div>
              <label className="field">
                <span>일괄 재실행 사유 (필수)</span>
                <textarea className="in" value={bReason} onChange={(e) => setBReason(e.target.value)} placeholder="예: LLM Judge 엔드포인트 복구 확인 후 일괄 재처리" />
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setMode(null)}>
                  취소
                </button>
                <button className="btn primary" disabled={busy || bReason.trim().length < 4 || !chkItems.length || !can("replay.request")} onClick={batch}>
                  <RefreshCw />
                  {chkItems.length}건 Batch Replay 승인
                </button>
              </div>
            </div>
          ) : null}
          <div style={{ maxHeight: 780, overflow: "auto" }}>
            {!list.data ? (
              <Skeleton rows={8} />
            ) : groups.length ? (
              groups.map(([cat, arr]) => {
                const m = FAILURE_CATEGORY_META[cat];
                return (
                  <details className="dlq-grp" open key={cat}>
                    <summary>
                      <CatalogIcon name={m?.icon ?? "alert-triangle"} />
                      <span>{m?.label ?? cat}</span>
                      <span className="pol">
                        {cat} · {m?.policy}
                      </span>
                      <span className="n">{arr.length}</span>
                    </summary>
                    {arr.map((d) => (
                      <div
                        key={d.dead_letter_id}
                        className={clsx("dlq-row", sel === d.dead_letter_id && "sel")}
                        tabIndex={0}
                        role="button"
                        aria-pressed={sel === d.dead_letter_id}
                        onClick={(e) => {
                          if ((e.target as Element).closest("input")) return;
                          setF({ sel: d.dead_letter_id }, { history: "push" });
                          if (mode !== "batch") setMode(null);
                        }}
                        onKeyDown={(e) => e.key === "Enter" && setF({ sel: d.dead_letter_id }, { history: "push" })}
                      >
                        <input
                          type="checkbox"
                          aria-label={`${d.dead_letter_id} 선택`}
                          disabled={!replayable(d)}
                          checked={checked.has(d.dead_letter_id)}
                          onChange={(e) =>
                            setChecked((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(d.dead_letter_id);
                              else n.delete(d.dead_letter_id);
                              return n;
                            })
                          }
                        />
                        <div style={{ minWidth: 0 }}>
                          <div className="t1">
                            <span className="idc">{d.dead_letter_id}</span>
                            <LangBadge lang={d.language} />
                            <span className="mono sev-ERROR" style={{ fontSize: 11 }}>
                              {d.error_code}
                            </span>
                            <span className="mono muted" style={{ fontSize: 10.5 }}>
                              {d.attempts} attempts · {d.failed_node ?? "—"}
                            </span>
                          </div>
                          <div className="t2">{d.failure_reason}</div>
                        </div>
                        <div style={{ textAlign: "right", display: "grid", gap: 3, justifyItems: "end" }}>
                          <StatusPill kind="dlq" status={d.status} size="xs" />
                          <span className="mono muted" style={{ fontSize: 10.5 }}>
                            {fmt.relative(d.created_at, now)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </details>
                );
              })
            ) : (
              <Empty title="조건에 맞는 DLQ 항목이 없습니다">언어나 기간 필터를 넓혀 보세요.</Empty>
            )}
          </div>
        </Plate>
        <Plate title="상세 · 복구" refText="POST /api/v1/dead-letters/{id}/replay">
          {sel ? (
            <Detail key={sel} id={sel} mode={mode === "batch" ? null : mode} setMode={setMode} />
          ) : (
            <Empty title="왼쪽에서 DLQ 항목을 선택하세요">실패 로그, 이전 실행 이력, Replay 승인이 여기에 표시됩니다.</Empty>
          )}
        </Plate>
      </div>
      <Plate flush title="Replay 결과" refText="replays/{replay_id} · 원본 작업 연결 · 실시간 상태">
        <div className="tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Replay</th>
                <th>DLQ</th>
                <th>원본 → Replay Workflow</th>
                <th>버전</th>
                <th>상태</th>
                <th>요청 / 승인</th>
                <th>사유</th>
                <th>시각</th>
              </tr>
            </thead>
            <tbody>
              {(replays.data ?? []).map((r) => {
                const rw = r.replay_workflow_id ? rws.get(r.replay_workflow_id) : undefined;
                return (
                  <tr key={r.replay_id}>
                    <td className="idc">{r.replay_id}</td>
                    <td className="mono">
                      <button className="btn sm ghost" style={{ padding: 0, color: "var(--accent)" }} onClick={() => setF({ sel: r.dead_letter_id })}>
                        {r.dead_letter_id}
                      </button>
                    </td>
                    <td className="mono">
                      <Link href={`/workflows/${r.original_workflow_id}`}>{r.original_workflow_id}</Link> →{" "}
                      {r.replay_workflow_id ? <Link href={`/workflows/${r.replay_workflow_id}`}>{r.replay_workflow_id}</Link> : "—"}
                    </td>
                    <td className="mono">
                      {r.pipeline_version_from} → {r.pipeline_version_to}
                    </td>
                    <td>{rw ? <StatusPill status={rw.status} /> : <span className="chip">{r.status}</span>}</td>
                    <td>
                      {opName(r.requested_by)} / {opName(r.approved_by)}
                    </td>
                    <td className="wrap" style={{ fontSize: 12 }}>
                      {r.reason}
                    </td>
                    <td className="mono muted">{fmt.dateTime(r.created_at).slice(5)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Plate>
    </Sheet>
  );
}
