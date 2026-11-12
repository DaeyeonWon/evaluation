"use client";
/**
 * S5 — DLQ operations. Category strip (group by failure type) · filters (URL) · grouped table with
 * multi-select → batch replay (2-step confirm) · inspector (log preview, stack, attempt history, replays)
 * with single replay (reason → confirm → POST, item becomes REPLAYING; new replay workflow enters the board),
 * close (resolution) and assignment. Replay results table follows replay workflows live.
 */
import clsx from "clsx";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { AlertTriangle, Archive, ArchiveX, ArrowRight, CheckCircle2, RefreshCw, Repeat } from "lucide-react";
import { DLQ_STATUS_META, FAILURE_CATEGORY_META, LANG_CODES, OPERATORS, PIPELINE_VERSIONS } from "@/lib/catalog";
import { api, parseAsString, revalidateKey, useApi, useQueryStates, useSimNow, type DeadLetterQuery } from "@/lib/client";
import { fmt } from "@/lib/format";
import { CatalogIcon, StatusPill } from "@/components/shared";
import type { DeadLetter, DlqStatus, FailureCategory, LangCode } from "@/lib/types";
import { CopyId, Empty, ErrorBox, LangTag, Pill, langName, opName, shortWf, useAction, useCan, useHere, useToast, wfHref } from "./core";

const PARSERS = { cat: parseAsString, lang: parseAsString, status: parseAsString, since: parseAsString, id: parseAsString };
const BUSY: DlqStatus[] = ["REPLAYING", "APPROVED"];
const NOSEL: DlqStatus[] = ["REPLAYING", "APPROVED", "CLOSED", "REPLAYED"];

export function DlqScreen() {
  const [f, setF] = useQueryStates(PARSERS);
  const now = useSimNow();
  const here = useHere();
  const all = useApi(["lanes-dl-all"], () => api.deadLetters({ pageSize: 500 }), { revalidateOn: ["dlq", "transition"] });
  const query: DeadLetterQuery = {
    category: f.cat ?? undefined,
    language: (f.lang as LangCode) ?? undefined,
    status: f.status ?? undefined,
    from: f.since ? now - Number(f.since) : undefined,
    pageSize: 500,
  };
  const list = useApi(["lanes-dl-list", { ...query, from: f.since ? Math.floor((now - Number(f.since)) / 600000) : null }], () => api.deadLetters(query), {
    revalidateOn: ["dlq", "transition"],
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const firstPending = all.data?.items.filter((d) => d.status === "PENDING_REVIEW").sort((a, b) => b.created_at - a.created_at)[0]?.dead_letter_id;
  const activeId = f.id ?? firstPending ?? null;
  const groups = useMemo(() => {
    const g = new Map<FailureCategory, DeadLetter[]>();
    items
      .slice()
      .sort((a, b) => b.created_at - a.created_at)
      .forEach((d) => (g.get(d.failure_category) ?? g.set(d.failure_category, []).get(d.failure_category)!).push(d));
    return [...g.entries()];
  }, [items]);
  const by: Partial<Record<DlqStatus, number>> = all.data?.facets.status ?? {};
  const catStat = useMemo(() => {
    const c: Record<string, { n: number; p: number }> = {};
    all.data?.items.forEach((d) => {
      const x = (c[d.failure_category] ??= { n: 0, p: 0 });
      x.n++;
      if (d.status === "PENDING_REVIEW") x.p++;
    });
    return c;
  }, [all.data]);

  return (
    <section className="screen stagger">
      <div className="s-head">
        <div>
          <div className="eyebrow">Screen 5 · Recovery</div>
          <h1>DLQ Operations</h1>
          <p>
            최종 실패와 비복구성 오류가 격리된 Dead Letter. 로그를 확인한 뒤 <b>영구 실패 → 종료</b>, <b>일시 장애 → 수동 Replay</b> (새 Replay Cycle 생성 → 언어 대기열 재등록 → Capacity 확보 → Workflows 재실행).
          </p>
        </div>
        <div className="fchips">
          {(Object.entries(DLQ_STATUS_META) as [DlqStatus, (typeof DLQ_STATUS_META)[DlqStatus]][]).map(([k, m]) => (
            <Pill key={k} tone={m.tone} icon={<CatalogIcon name={m.icon} />}>
              {m.label} <b className="mono">{by[k] ?? 0}</b>
            </Pill>
          ))}
        </div>
      </div>
      <div className="dlqcats">
        {(Object.entries(FAILURE_CATEGORY_META) as [FailureCategory, (typeof FAILURE_CATEGORY_META)[FailureCategory]][]).map(([k, m]) => (
          <button key={k} type="button" aria-pressed={f.cat === k} onClick={() => setF({ cat: f.cat === k ? null : k }, { history: "push" })}>
            <span>
              <CatalogIcon name={m.icon} />
              {m.label}
            </span>
            <b>{catStat[k]?.n ?? 0}</b>
            <small>
              {catStat[k]?.p ? <span style={{ color: "var(--st-dlq)", display: "inline" }}>검토 대기 {catStat[k].p} · </span> : null}
              {m.policy}
            </small>
          </button>
        ))}
      </div>
      <div className="filters f4">
        <label className="fld">
          <span>Language</span>
          <select className="inp" value={f.lang ?? ""} onChange={(e) => setF({ lang: e.target.value || null }, { history: "push" })}>
            <option value="">전체</option>
            {LANG_CODES.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>상태</span>
          <select className="inp" value={f.status ?? ""} onChange={(e) => setF({ status: e.target.value || null }, { history: "push" })}>
            <option value="">전체</option>
            {Object.entries(DLQ_STATUS_META).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>발생 시각</span>
          <select className="inp" value={f.since ?? ""} onChange={(e) => setF({ since: e.target.value || null }, { history: "push" })}>
            <option value="">전체 기간</option>
            <option value="3600000">최근 1시간</option>
            <option value="86400000">최근 24시간</option>
            <option value="259200000">최근 3일</option>
          </select>
        </label>
        <div className="fld">
          <span>선택</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className="btn" onClick={() => setSel(new Set(items.filter((d) => d.status === "PENDING_REVIEW").map((d) => d.dead_letter_id)))}>
              검토 대기 전체 선택
            </button>
            <button type="button" className="btn ghost" onClick={() => setSel(new Set())}>
              해제
            </button>
          </span>
        </div>
      </div>
      <div className="split">
        <div style={{ minWidth: 0 }}>
          <div className="panel flush">
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Dead Letter</th>
                    <th>언어</th>
                    <th>Error Code</th>
                    <th className="r">Attempts</th>
                    <th>상태</th>
                    <th>담당</th>
                    <th>발생</th>
                  </tr>
                </thead>
                <tbody>
                  {list.error && !list.data ? (
                    <tr>
                      <td colSpan={8}>
                        <ErrorBox error={list.error} retry={() => list.mutate()} />
                      </td>
                    </tr>
                  ) : !list.data ? (
                    Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={8}>
                          <div className="skel" />
                        </td>
                      </tr>
                    ))
                  ) : groups.length ? (
                    groups.map(([cat, ds]) => (
                      <GroupRows key={cat} cat={cat} ds={ds} sel={sel} setSel={setSel} active={activeId} onOpen={(id) => setF({ id })} />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <Empty icon={<CheckCircle2 className="i" />}>조건에 맞는 DLQ 항목이 없습니다</Empty>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <AnimatePresence>{sel.size > 0 && <BatchBar ids={[...sel]} onDone={() => setSel(new Set())} />}</AnimatePresence>
          <ReplayTable here={here} />
        </div>
        <aside className="panel inspector" aria-label="DLQ 상세">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeId ?? "none"} initial={{ opacity: 0.3, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              {activeId ? (
                <Inspector id={activeId} />
              ) : (
                <Empty icon={<ArchiveX className="i" />}>
                  왼쪽 목록에서 DLQ 항목을 선택하면
                  <br />
                  실패 로그 미리보기 · 실행 이력 · Replay 요청이 표시됩니다
                </Empty>
              )}
            </motion.div>
          </AnimatePresence>
        </aside>
      </div>
    </section>
  );
}

function GroupRows({
  cat,
  ds,
  sel,
  setSel,
  active,
  onOpen,
}: {
  cat: FailureCategory;
  ds: DeadLetter[];
  sel: Set<string>;
  setSel: (f: (s: Set<string>) => Set<string>) => void;
  active: string | null;
  onOpen: (id: string) => void;
}) {
  const m = FAILURE_CATEGORY_META[cat];
  return (
    <>
      <tr className="grp">
        <td colSpan={8}>
          <CatalogIcon name={m.icon} className="i sm" /> {m.label}{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            · {ds.length}건 · 정책: {m.policy}
          </span>
        </td>
      </tr>
      {ds.map((d) => (
        <tr key={d.dead_letter_id} className={clsx("click", active === d.dead_letter_id && "sel")} onClick={() => onOpen(d.dead_letter_id)}>
          <td onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="chk"
              checked={sel.has(d.dead_letter_id)}
              disabled={NOSEL.includes(d.status)}
              title={NOSEL.includes(d.status) ? "Replay 진행/종료된 항목은 선택 불가" : undefined}
              aria-label={`${d.dead_letter_id} 선택`}
              onChange={(e) =>
                setSel((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(d.dead_letter_id);
                  else n.delete(d.dead_letter_id);
                  return n;
                })
              }
            />
          </td>
          <td className="mono">
            {d.dead_letter_id}
            <div className="dim" style={{ fontSize: 10 }}>
              {d.workflow_id}
            </div>
          </td>
          <td>
            <LangTag code={d.language} />
          </td>
          <td>
            <span className="mono" style={{ color: "var(--st-failed)", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle className="i sm" />
              {d.error_code}
            </span>
            <div className="muted trunc" style={{ fontSize: 10.5, maxWidth: 240 }}>
              {d.failure_reason}
            </div>
          </td>
          <td className="r mono">{d.attempts}</td>
          <td>
            <StatusPill kind="dlq" status={d.status} />
          </td>
          <td className="muted">{d.assigned_operator ? opName(d.assigned_operator) : "—"}</td>
          <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
            {fmt.date(d.created_at).slice(5)} {fmt.hm(d.created_at)}
          </td>
        </tr>
      ))}
    </>
  );
}

function BatchBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const { can } = useCan();
  const act = useAction();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState("");
  const [ver, setVer] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await act(() => api.replayBatch({ ids, reason, pipeline_version: ver || undefined }));
    setBusy(false);
    if (!r) return;
    toast(
      <>
        Batch Replay — 성공 <b>{r.succeeded}</b>건{r.failed ? <> · 실패 {r.failed}건 ({r.results.filter((x) => !x.ok).map((x) => `${x.id}: ${x.error}`).join(", ")})</> : null} · 언어 대기열 재등록
      </>,
      r.failed ? "retry" : "success",
    );
    revalidateKey("lanes-dl");
    revalidateKey("lanes-replays");
    onDone();
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
      {step === 1 ? (
        <div className="confirm" style={{ marginTop: 12 }}>
          <div className="steps">
            <span className="on" />
            <span className="on" />
            <span />
          </div>
          <b>Batch Replay 확인 — {ids.length}건</b>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
            각 항목마다 새 Replay Cycle과 Workflow가 생성되어 언어 대기열에 재등록됩니다. 원본 입력은 수정하지 않습니다. 사유: <b>{reason}</b> · 버전: <b>{ver || "원본 유지"}</b>
          </p>
          <div className="mono" style={{ fontSize: 11, marginBottom: 8, overflowWrap: "anywhere" }}>
            {ids.join(", ")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn" onClick={() => setStep(0)}>
              돌아가기
            </button>
            <button type="button" className="btn dlqb" disabled={!can("replay.request") || busy} onClick={() => void go()}>
              <Repeat />
              승인 및 {ids.length}건 Replay 실행
            </button>
            {!can("replay.request") && <span className="muted" style={{ fontSize: 11 }}>Replay는 Operator 이상 권한 필요</span>}
          </div>
        </div>
      ) : (
        <form
          className="batchbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return toast("Batch Replay 사유를 입력하세요", "retry");
            setStep(1);
          }}
        >
          <b>{ids.length}건 선택</b>
          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Batch Replay 사유 (필수)" aria-label="Batch Replay 사유" />
          <select className="inp" value={ver} onChange={(e) => setVer(e.target.value)} aria-label="Pipeline 버전">
            <option value="">버전 유지</option>
            {PIPELINE_VERSIONS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <button type="submit" className="btn" style={{ color: "var(--ink)" }}>
            <ArrowRight />
            다음: 확인
          </button>
        </form>
      )}
    </motion.div>
  );
}

function Inspector({ id }: { id: string }) {
  const { can, operator } = useCan();
  const act = useAction();
  const toast = useToast();
  const here = useHere();
  const now = useSimNow();
  const q = useApi(["lanes-dl", id], () => api.deadLetter(id), { revalidateOn: ["dlq", "transition"] });
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState("");
  const [ver, setVer] = useState("");
  const [pri, setPri] = useState(8);
  const [res, setRes] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.error && !q.data) return <ErrorBox error={q.error} retry={() => q.mutate()} />;
  const det = q.data && q.data.deadLetter.dead_letter_id === id ? q.data : undefined;
  if (!det) return <div className="skel" style={{ height: 420 }} />;
  const d = det.deadLetter;
  const cat = FAILURE_CATEGORY_META[d.failure_category];
  const busyDl = BUSY.includes(d.status);
  const closed = d.status === "CLOSED";
  const verTo = ver || d.pipeline_version;
  const refresh = () => {
    revalidateKey("lanes-dl");
    revalidateKey("lanes-replays");
  };
  const doReplay = async () => {
    setBusy(true);
    const r = await act(() => api.replayDeadLetter(d.dead_letter_id, { reason, pipeline_version: verTo, priority: pri }));
    setBusy(false);
    if (!r) return;
    toast(
      <>
        Replay {r.replay.replay_id} 승인 — 새 Workflow{" "}
        <Link className="mono" href={wfHref(r.workflow.workflow_id, here)} style={{ textDecoration: "underline" }}>
          {r.workflow.workflow_id}
        </Link>{" "}
        대기열 등록 · DLQ → {DLQ_STATUS_META[r.deadLetter.status].label}
      </>,
      "success",
    );
    setStep(0);
    setReason("");
    void q.mutate(); // ensures the inspector reflects REPLAYING immediately
    refresh();
  };
  const doClose = async () => {
    if (!res.trim()) return toast("Resolution을 입력하세요", "retry");
    setBusy(true);
    const r = await act(() => api.closeDeadLetter(d.dead_letter_id, { resolution: res.trim() }), () => "DLQ 종료 처리 · 감사 로그 기록");
    setBusy(false);
    if (r) {
      setStep(0);
      setRes("");
      void q.mutate();
      refresh();
    }
  };
  let actEl;
  if (step === 1)
    actEl = (
      <form
        className="confirm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return toast("재실행 사유를 입력하세요", "retry");
          setStep(2);
        }}
      >
        <div className="steps">
          <span className="on" />
          <span />
          <span />
        </div>
        <b>Replay 요청</b>
        <label className="fld" style={{ marginTop: 8 }}>
          <span>재실행 사유 (필수)</span>
          <textarea className="inp" rows={2} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: Vertex quota 회복 확인 — 동일 입력으로 재실행" />
        </label>
        <div className="grid g2" style={{ marginTop: 8 }}>
          <label className="fld">
            <span>Pipeline 버전</span>
            <select className="inp" value={verTo} onChange={(e) => setVer(e.target.value)}>
              {PIPELINE_VERSIONS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="fld">
            <span>Priority (1–10)</span>
            <input className="inp" type="number" min={1} max={10} value={pri} onChange={(e) => setPri(Math.max(1, Math.min(10, +e.target.value || 8)))} />
          </label>
        </div>
        {!cat.retryable && (
          <div className="note t-retry" style={{ marginTop: 8 }}>
            <AlertTriangle className="i sm" /> <b>{cat.label}</b>는 비복구성 오류입니다. 입력/권한을 수정한 뒤 Replay 하세요.
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => setStep(0)}>
            취소
          </button>
          <button type="submit" className="btn pri">
            <ArrowRight />
            다음: 확인
          </button>
        </div>
      </form>
    );
  else if (step === 2)
    actEl = (
      <div className="confirm">
        <div className="steps">
          <span className="on" />
          <span className="on" />
          <span />
        </div>
        <b>Replay 승인 확인</b>
        <ol style={{ margin: "6px 0 8px 18px", padding: 0, fontSize: 12, lineHeight: 1.7 }}>
          <li>
            새 Replay Cycle <b>{(det.workflow?.replay_cycle ?? 0) + 1}</b> · event <span className="mono">pipeline.batch.replay.requested</span>
          </li>
          <li>
            <LangTag code={d.language} /> 대기열 재등록 (priority {pri})
          </li>
          <li>
            Capacity 확보 → Cloud Workflows 재실행 ({d.pipeline_version} → <b>{verTo}</b>)
          </li>
          <li>
            원본 입력{" "}
            <span className="mono" style={{ fontSize: 10.5 }}>
              {d.input_uri}
            </span>{" "}
            유지
          </li>
        </ol>
        <div className="note" style={{ marginBottom: 8 }}>
          사유: {reason}
          <br />
          요청자: <b>{operator.name}</b> ({operator.role}) — 감사 로그에 기록됩니다
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setStep(1)}>
            돌아가기
          </button>
          <button type="button" className="btn dlqb" disabled={!can("replay.request") || busy} onClick={() => void doReplay()}>
            <Repeat />
            승인 및 Replay 실행
          </button>
        </div>
        {!can("replay.request") && (
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Replay는 Operator 이상 권한이 필요합니다 (현재 {operator.role})
          </div>
        )}
      </div>
    );
  else if (step === 3)
    actEl = (
      <div className="confirm warn">
        <b>종료 처리 (영구 실패)</b>
        <label className="fld" style={{ marginTop: 8 }}>
          <span>Resolution (필수)</span>
          <textarea className="inp" rows={2} autoFocus value={res} onChange={(e) => setRes(e.target.value)} placeholder="예: 원천 데이터 결함 — 상위 팀 이관" />
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button type="button" className="btn" onClick={() => setStep(0)}>
            취소
          </button>
          <button type="button" className="btn warn" disabled={busy} onClick={() => void doClose()}>
            <Archive />
            종료 확정
          </button>
        </div>
      </div>
    );
  else
    actEl = (
      <>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn dlqb" disabled={busyDl || closed || d.status === "REPLAYED" || !can("replay.request")} onClick={() => setStep(1)}>
            <Repeat />
            Replay 요청
          </button>
          <button type="button" className="btn" disabled={closed || busyDl || !can("replay.request")} onClick={() => setStep(3)}>
            <Archive />
            종료 처리
          </button>
          <select
            className="inp"
            style={{ width: "auto", height: 30 }}
            aria-label="담당자 지정"
            value={d.assigned_operator ?? ""}
            disabled={!can("replay.request")}
            onChange={async (e) => {
              const v = e.target.value || null;
              const r = await act(() => api.assignDeadLetter(d.dead_letter_id, { operator_id: v, reason: "UI 담당자 지정" }), () => `담당자: ${v ? opName(v) : "미지정"}`);
              if (r) {
                void q.mutate();
                refresh();
              }
            }}
          >
            <option value="">담당자 미지정</option>
            {OPERATORS.filter((o) => o.role !== "Viewer").map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {busyDl && (
          <div className="note t-running" style={{ marginTop: 8 }}>
            <RefreshCw className="i sm" /> Replay 진행 중 — 중복 요청이 차단됩니다 (409)
          </div>
        )}
        {!can("replay.request") && (
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            현재 역할 {operator.role} — 조회만 가능
          </div>
        )}
      </>
    );
  return (
    <>
      <div className="panel-h">
        <h2 className="sec mono">{d.dead_letter_id}</h2>
        <span className="r">
          <StatusPill kind="dlq" status={d.status} />
        </span>
      </div>
      <dl className="kv" style={{ marginBottom: 10 }}>
        <dt>Workflow</dt>
        <dd>
          <Link className="copy-id mono link" href={wfHref(d.workflow_id, here)}>
            {d.workflow_id} ↗
          </Link>
        </dd>
        <dt>유형</dt>
        <dd>
          <CatalogIcon name={cat.icon} className="i sm" /> {cat.label} · <span className="mono">{d.error_code}</span>
        </dd>
        <dt>원인</dt>
        <dd>{d.failure_reason}</dd>
        <dt>실패 노드</dt>
        <dd className="mono">{d.failed_node ?? "—"}</dd>
        <dt>입력</dt>
        <dd>
          <CopyId text={d.input_uri} /> <span className="muted">{fmt.number(d.utterance_count)}건</span>
        </dd>
        <dt>버전</dt>
        <dd className="mono">{d.pipeline_version}</dd>
        <dt>Last Exec</dt>
        <dd className="mono" style={{ fontSize: 10.5 }}>
          {d.last_pipeline_job_id}
        </dd>
        <dt>발생</dt>
        <dd className="mono">
          {fmt.dateTime(d.created_at)} <span className="muted">({fmt.relative(d.created_at, now)})</span>
        </dd>
        <dt>담당</dt>
        <dd>{d.assigned_operator ? opName(d.assigned_operator) : <span className="muted">미지정</span>}</dd>
      </dl>
      {actEl}
      <div className="eyebrow" style={{ margin: "14px 0 6px" }}>
        최근 실패 로그 미리보기
      </div>
      <pre className="code" style={{ maxHeight: 180, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {d.last_log_excerpt}
      </pre>
      {d.last_stack_trace && (
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 11.5 }}>
            Stack trace
          </summary>
          <pre className="code" style={{ color: "var(--st-failed)", marginTop: 6 }}>
            {d.last_stack_trace}
          </pre>
        </details>
      )}
      {det.recentLogs.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 11.5 }}>
            최근 로그 {det.recentLogs.length}줄
          </summary>
          <div className="stream" style={{ marginTop: 6, maxHeight: 220 }}>
            {det.recentLogs.map((l) => (
              <div key={l.log_id} className="ln" style={{ gridTemplateColumns: "80px 60px minmax(0,1fr)" }}>
                <span className="muted">{fmt.time(l.ts)}</span>
                <span style={{ color: `var(--st-${l.severity === "ERROR" || l.severity === "CRITICAL" ? "failed" : l.severity === "WARNING" ? "retry" : "queued"})` }}>{l.severity}</span>
                <span className="msg">{l.message}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div className="eyebrow" style={{ margin: "14px 0 6px" }}>
        이전 실행 이력
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>A</th>
            <th>PipelineJob</th>
            <th>상태</th>
            <th>오류</th>
          </tr>
        </thead>
        <tbody>
          {d.attempt_history.map((a) => (
            <tr key={a.attempt}>
              <td className="mono">{a.attempt}</td>
              <td className="mono" style={{ fontSize: 10.5 }}>
                {a.pipeline_job_id.replace(d.workflow_id + "-", "…")}
              </td>
              <td>
                <StatusPill kind="attempt" status={a.status} />
              </td>
              <td className="mono" style={{ fontSize: 10.5, color: "var(--st-failed)" }}>
                {a.error_code ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {det.replays.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>
            Replay
          </div>
          {det.replays.map((r) => {
            const rw = det.replayWorkflows.find((x) => x.workflow_id === r.replay_workflow_id);
            return (
              <div key={r.replay_id} className="note t-dlq" style={{ marginBottom: 6 }}>
                <b className="mono">{r.replay_id}</b> {r.status} · {r.pipeline_version_from}→{r.pipeline_version_to}
                {r.replay_workflow_id && (
                  <>
                    {" "}
                    ·{" "}
                    <Link className="copy-id mono link" href={wfHref(r.replay_workflow_id, here)}>
                      {shortWf(r.replay_workflow_id)} ↗
                    </Link>
                  </>
                )}
                {rw && (
                  <>
                    {" "}
                    <StatusPill status={rw.status} size="xs" />
                  </>
                )}
                <div className="muted">{r.reason}</div>
              </div>
            );
          })}
        </>
      )}
      {d.notes.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>
            메모
          </div>
          {d.notes.map((n, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
              <span className="mono muted">{fmt.hm(n.at)}</span> <b>{opName(n.by)}</b> {n.text}
            </div>
          ))}
        </>
      )}
      {d.resolution && (
        <div className="note t-success" style={{ marginTop: 10 }}>
          Resolution: {d.resolution}
        </div>
      )}
    </>
  );
}

const R_TONE: Record<string, string> = { APPROVED: "queued", QUEUED: "queued", RUNNING: "running", SUCCEEDED: "success", FAILED: "failed", CANCELLED: "cancelled", SUPERSEDED: "cancelled" };
const R_LBL: Record<string, string> = { APPROVED: "승인됨", QUEUED: "대기 중", RUNNING: "실행 중", SUCCEEDED: "성공", FAILED: "실패", CANCELLED: "취소됨", SUPERSEDED: "대체됨" };

function ReplayTable({ here }: { here: string }) {
  const reps = useApi(["lanes-replays"], () => api.replays(), { revalidateOn: ["dlq", "transition"] });
  const rws = useApi(["lanes-replay-wfs"], () => api.workflows({ replay: true, pageSize: 500 }), { revalidateOn: ["transition"] });
  const st = new Map(rws.data?.items.map((w) => [w.workflow_id, w.status]) ?? []);
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-h">
        <h2 className="sec">
          <Repeat className="i" />
          Replay 결과
        </h2>
        <span className="r muted" style={{ fontSize: 11 }}>
          replays/{"{replay_id}"} · 실시간
        </span>
      </div>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Replay</th>
              <th>Dead Letter</th>
              <th>원본 → Replay</th>
              <th>버전</th>
              <th>상태</th>
              <th>요청 · 승인</th>
              <th>시각</th>
            </tr>
          </thead>
          <tbody>
            {(reps.data ?? []).map((r) => {
              const s = r.replay_workflow_id ? st.get(r.replay_workflow_id) : undefined;
              return (
                <tr key={r.replay_id}>
                  <td className="mono">
                    {r.replay_id}
                    <div className="dim" style={{ fontSize: 10 }}>
                      cycle {r.replay_cycle}
                    </div>
                  </td>
                  <td className="mono">
                    <Link className="copy-id" href={`/lanes/dlq?id=${r.dead_letter_id}`}>
                      {r.dead_letter_id}
                    </Link>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    <Link className="copy-id" href={wfHref(r.original_workflow_id, here)}>
                      {shortWf(r.original_workflow_id)}
                    </Link>{" "}
                    →{" "}
                    {r.replay_workflow_id ? (
                      <Link className="copy-id link" href={wfHref(r.replay_workflow_id, here)}>
                        {shortWf(r.replay_workflow_id)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="mono">
                    {r.pipeline_version_from} → {r.pipeline_version_to}
                  </td>
                  <td title={`replays/${r.replay_id}.status = ${r.status}`}>
                    {s ? <StatusPill status={s} /> : <Pill tone={(R_TONE[r.status] ?? "queued") as never}>{R_LBL[r.status] ?? r.status}</Pill>}
                  </td>
                  <td>
                    {opName(r.requested_by)} · {opName(r.approved_by)}
                  </td>
                  <td className="mono muted" style={{ whiteSpace: "nowrap" }}>
                    {fmt.date(r.created_at).slice(5)} {fmt.hm(r.created_at)}
                  </td>
                </tr>
              );
            })}
            {reps.data && !reps.data.length && (
              <tr>
                <td colSpan={7}>
                  <Empty>Replay 기록 없음</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
