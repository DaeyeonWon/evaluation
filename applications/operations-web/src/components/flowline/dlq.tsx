"use client";
/**
 * S5 DLQ Operations — counts by status, grouping by failure type, filters (URL), record detail with
 * log preview + attempt history, single replay with an in-page 2-step confirmation, batch replay,
 * close and assign. Every action goes through the mock API and is audited server-side.
 */
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Archive, ChevronRight, Eye, RefreshCw, Send, User, X, Check, Info } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CatalogIcon, StatusPill } from "@/components/shared";
import { DEFAULT_PIPELINE_VERSION, DLQ_STATUS_META, FAILURE_CATEGORY_META, LANG_CODES, OPERATORS, PIPELINE_VERSIONS } from "@/lib/catalog";
import { api, parseAsString, revalidateKey, useApi, useQueryStates, useSimNow } from "@/lib/client";
import { fmt, kstDayStart } from "@/lib/format";
import type { DeadLetter, DlqStatus, FailureCategory, LangCode } from "@/lib/types";
import { ReplayStatusPill } from "./detail/detail";
import { wfHref } from "./nav-store";
import { Empty, ErrorBox, Lang, Note, Panel, PermNote, Skel, Tag, useApiErrorToast, usePerm, useToast } from "./ui";

const PARSERS = { cat: parseAsString, status: parseAsString, language: parseAsString, range: parseAsString, focus: parseAsString };
const opName = (id: string | null | undefined) => OPERATORS.find((o) => o.id === id)?.name ?? id ?? "-";
const ACTIONABLE: DlqStatus[] = ["PENDING_REVIEW", "APPROVED"];

type Confirm =
  | { kind: "replay"; ids: string[]; batch: boolean; step: 1 | 2; reason: string; version: string; priority: number }
  | { kind: "close"; id: string; reason: string };

export function DlqOps() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const now = useSimNow();
  const [f, setF] = useQueryStates(PARSERS);
  const range = f.range ?? "all";
  const from = range === "today" ? kstDayStart(now) : range === "24h" ? now - 86400e3 : range === "7d" ? now - 7 * 86400e3 : undefined;
  const fromKey = from ? Math.floor(from / 60000) * 60000 : undefined; // stable-ish cache key

  const all = useApi(["dead-letters", "facets"], () => api.deadLetters({ pageSize: 1 }), { revalidateOn: ["dlq"] });
  const pendingFacets = useApi(["dead-letters", "facets-pending"], () => api.deadLetters({ status: "PENDING_REVIEW", pageSize: 1 }), { revalidateOn: ["dlq"] });
  const query = { status: f.status ?? undefined, category: f.cat ?? undefined, language: (f.language as LangCode) ?? undefined, from: fromKey, pageSize: 200 };
  const list = useApi(["dead-letters", "list", query], () => api.deadLetters(query), { revalidateOn: ["dlq"] });
  const rows = list.data?.items ?? [];
  const focusId = f.focus ?? rows.find((d) => d.status === "PENDING_REVIEW")?.dead_letter_id ?? rows[0]?.dead_letter_id ?? null;

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const pend = rows.filter((d) => d.status === "PENDING_REVIEW");
  const filtered = !!(f.cat || f.status || f.language || (f.range && f.range !== "all"));
  const toggleSel = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const totalByStatus = all.data?.facets.status ?? {};
  const cats = Object.entries(all.data?.facets.category ?? {}).filter(([, n]) => n) as [FailureCategory, number][];

  return (
    <div className="screen enter">
      <div className="head-row">
        <div>
          <div className="eyebrow">Screen 5 · Dead Letter Queue</div>
          <h1 className="h1">DLQ Operations</h1>
          <div className="sub">최종 실패·재시도 불가 작업을 검토하고 Replay 또는 종료합니다. 모든 조작은 감사 로그에 기록됩니다.</div>
        </div>
        <div className="row">
          {(Object.keys(DLQ_STATUS_META) as DlqStatus[]).map((s) => (
            <button key={s} className={clsx("btn sm", f.status === s && "primary")} aria-pressed={f.status === s} onClick={() => setF({ status: f.status === s ? null : s, focus: null })}>
              <StatusPill kind="dlq" status={s} size="sm" />
              <b className="mono">{totalByStatus[s] ?? 0}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="cat-groups">
        {cats.map(([c, n]) => {
          const m = FAILURE_CATEGORY_META[c];
          return (
            <button key={c} className="cat" aria-pressed={f.cat === c} onClick={() => setF({ cat: f.cat === c ? null : c, focus: null })}>
              <span className="ch">
                <CatalogIcon name={m.icon} aria-hidden />
                {m.label}
              </span>
              <span className="cn">{n}</span>
              <small>
                {m.policy} · 검토 대기 {pendingFacets.data?.facets.category[c] ?? 0}
              </small>
            </button>
          );
        })}
      </div>
      <div className="grid g-7-5">
        <section className="panel">
          <div className="panel-h">
            <div className="row" style={{ gap: 8, alignItems: "end" }}>
              <label className="field">
                <span>Language</span>
                <select className="inp" style={{ width: 120 }} value={f.language ?? ""} onChange={(e) => setF({ language: e.target.value || null, focus: null })}>
                  <option value="">전체</option>
                  {LANG_CODES.map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>발생 시각</span>
                <select className="inp" style={{ width: 120 }} value={range} onChange={(e) => setF({ range: e.target.value === "all" ? null : e.target.value, focus: null })}>
                  <option value="all">전체</option>
                  <option value="today">오늘</option>
                  <option value="24h">최근 24시간</option>
                  <option value="7d">최근 7일</option>
                </select>
              </label>
              {filtered && (
                <button className="btn sm ghost" onClick={() => router.replace(pathname, { scroll: false })}>
                  <X aria-hidden />
                  필터 해제
                </button>
              )}
            </div>
            <div className="row">
              <span className="sub">
                <span className="mono">{sel.size}</span>건 선택
              </span>
              <button
                className="btn sm primary"
                disabled={!sel.size}
                onClick={() => setConfirm({ kind: "replay", ids: [...sel], batch: true, step: 1, reason: "", version: DEFAULT_PIPELINE_VERSION, priority: 8 })}
              >
                <RefreshCw aria-hidden />
                선택 일괄 Replay
              </button>
            </div>
          </div>
          <div className="panel-b">
            <AnimatePresence>
              {confirm?.kind === "replay" && confirm.batch && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden", marginBottom: 10 }}>
                  <ReplayConfirm
                    c={confirm}
                    setC={setConfirm}
                    onDone={() => {
                      setSel(new Set());
                      setConfirm(null);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {list.error && !list.data ? (
              <ErrorBox error={list.error} retry={() => list.mutate()} />
            ) : !list.data ? (
              <Skel h={360} />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl fluid">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="검토 대기 전체 선택"
                          checked={pend.length > 0 && pend.every((d) => sel.has(d.dead_letter_id))}
                          onChange={(e) => pend.forEach((d) => toggleSel(d.dead_letter_id, e.target.checked))}
                        />
                      </th>
                      <th>DLQ ID · 언어</th>
                      <th>상태</th>
                      <th>유형 · 코드 · 노드</th>
                      <th className="r">시도</th>
                      <th>발생 · 담당</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((d) => (
                        <motion.tr
                          layout="position"
                          key={d.dead_letter_id}
                          className={clsx("clickable", focusId === d.dead_letter_id && "sel")}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("input,button,a")) return;
                            setF({ focus: d.dead_letter_id });
                            if (confirm && !(confirm.kind === "replay" && confirm.batch)) setConfirm(null);
                          }}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={sel.has(d.dead_letter_id)}
                              disabled={!ACTIONABLE.includes(d.status)}
                              aria-label={`${d.dead_letter_id} 선택`}
                              onChange={(e) => toggleSel(d.dead_letter_id, e.target.checked)}
                            />
                          </td>
                          <td className="nw">
                            <span className="mono">{d.dead_letter_id}</span>
                            <div>
                              <Lang code={d.language} />
                            </div>
                          </td>
                          <td>
                            <StatusPill kind="dlq" status={d.status} size="sm" />
                          </td>
                          <td>
                            <span className="row" style={{ gap: 5, flexWrap: "nowrap" }}>
                              <CatalogIcon name={FAILURE_CATEGORY_META[d.failure_category]?.icon} size={14} style={{ color: "var(--st-dlq)", flex: "none" }} aria-hidden />
                              <span className="mono" style={{ fontSize: 11.5 }}>
                                {d.error_code}
                              </span>
                            </span>
                            <div className="mono-sub">
                              {FAILURE_CATEGORY_META[d.failure_category]?.label} · {d.failed_node ?? "-"}
                            </div>
                          </td>
                          <td className="r mono">{d.attempts}</td>
                          <td className="nw">
                            <span className="mono">
                              {fmt.date(d.created_at).slice(5)} {fmt.hm(d.created_at)}
                            </span>
                            <div className="sub">{d.assigned_operator ? opName(d.assigned_operator) : "미지정"}</div>
                          </td>
                        </motion.tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty">조건에 맞는 DLQ 레코드가 없습니다</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        <Panel title="레코드 상세" icon={<Eye aria-hidden />}>
          {focusId ? <DlqDetail id={focusId} confirm={confirm && !(confirm.kind === "replay" && confirm.batch) ? confirm : null} setConfirm={setConfirm} fq={sp.toString()} /> : <Empty>왼쪽 목록에서 DLQ 레코드를 선택하세요</Empty>}
        </Panel>
      </div>
      <ReplayTable />
    </div>
  );
}

function DlqDetail({ id, confirm, setConfirm, fq }: { id: string; confirm: Confirm | null; setConfirm: (c: Confirm | null) => void; fq: string }) {
  const now = useSimNow();
  const toast = useToast();
  const onErr = useApiErrorToast();
  const { op, can } = usePerm();
  const { data, error, mutate } = useApi(["dead-letter", id], () => api.deadLetter(id), { revalidateOn: ["dlq", "transition"], throttleMs: 2000 });
  if (error && !data) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!data || data.deadLetter.dead_letter_id !== id) return <Skel h={420} />;
  const d = data.deadLetter;
  const cm = FAILURE_CATEGORY_META[d.failure_category];
  const canAct = ACTIONABLE.includes(d.status);
  const assign = async () => {
    try {
      await api.assignDeadLetter(d.dead_letter_id, { operator_id: op.id, reason: "DLQ 화면에서 담당 지정" });
      toast(`${d.dead_letter_id} 담당자를 ${op.name}로 지정`, "success");
      revalidateKey("dead-letter");
    } catch (e) {
      onErr(e);
    }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="head-row" style={{ alignItems: "center" }}>
        <div>
          <div className="eyebrow">{d.dead_letter_id}</div>
          <div className="h2" style={{ fontSize: 15 }}>
            <CatalogIcon name={cm?.icon} aria-hidden />
            {cm?.label ?? d.failure_category} · <span className="mono">{d.error_code}</span>
          </div>
        </div>
        <StatusPill kind="dlq" status={d.status} size="md" />
      </div>
      <Note tone={cm?.retryable ? "retry" : "failed"}>
        처리 정책: <b>{cm?.policy ?? "-"}</b> · {cm?.retryable ? "일시 장애로 판단되면 Replay" : "재시도 불가 유형 — 원인 수정 후 Replay 또는 종료"}
      </Note>
      <dl className="kv">
        <dt>Workflow</dt>
        <dd className="row" style={{ gap: 6 }}>
          <Link className="idlink" href={wfHref(d.workflow_id, { screen: "dlq", fq })}>
            {d.workflow_id}
          </Link>
          <Lang code={d.language} />
        </dd>
        <dt>실패 원인</dt>
        <dd>{d.failure_reason}</dd>
        <dt>실패 노드 · Attempt</dt>
        <dd className="mono">
          {d.failed_node ?? "-"} · {d.attempts}회
        </dd>
        <dt>버전</dt>
        <dd className="mono">{d.pipeline_version}</dd>
        <dt>입력</dt>
        <dd className="mono">
          {d.input_uri} ({d.utterance_count}건)
        </dd>
        <dt>마지막 PipelineJob</dt>
        <dd className="mono">{d.last_pipeline_job_id}</dd>
        <dt>담당</dt>
        <dd className="row" style={{ gap: 6 }}>
          {d.assigned_operator ? opName(d.assigned_operator) : "미지정"}
          {d.assigned_operator !== op.id && can("replay.request") && d.status !== "CLOSED" && (
            <button className="btn sm ghost" onClick={assign}>
              <User aria-hidden />
              나에게 할당
            </button>
          )}
        </dd>
        <dt>발생</dt>
        <dd className="mono">
          {fmt.dateTime(d.created_at)} <span className="sub">{fmt.relative(d.created_at, now)}</span>
        </dd>
      </dl>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          최근 실패 로그
        </div>
        <div className="term" style={{ height: "auto", maxHeight: 170 }}>
          {d.last_log_excerpt.split("\n").map((l, i) => {
            const m = / (ERROR|WARNING|INFO|CRITICAL) /.exec(l);
            return (
              <div className="ln" key={i}>
                {m ? (
                  <>
                    {l.slice(0, m.index)} <span className={`sv-${m[1]}`}>{m[1]}</span> {l.slice(m.index + m[0].length)}
                  </>
                ) : (
                  l
                )}
              </div>
            );
          })}
        </div>
      </div>
      {d.last_stack_trace && (
        <details>
          <summary className="sub">Stack trace 펼치기</summary>
          <pre className="trace" style={{ marginTop: 6 }}>
            {d.last_stack_trace}
          </pre>
        </details>
      )}
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          이전 실행 이력
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Attempt</th>
                <th>PipelineJob</th>
                <th>상태</th>
                <th>오류</th>
                <th>시작</th>
              </tr>
            </thead>
            <tbody>
              {d.attempt_history.map((a) => (
                <tr key={a.attempt}>
                  <td className="mono">{a.attempt}</td>
                  <td className="mono sub" title={a.pipeline_job_id}>
                    {a.pipeline_job_id.replace(d.workflow_id + "-", "").replace("cycle-", "c").replace("attempt-", "a")}
                  </td>
                  <td>
                    <StatusPill kind="attempt" status={a.status} size="sm" />
                  </td>
                  <td className="mono" style={{ color: "var(--st-failed)", whiteSpace: "normal", overflowWrap: "anywhere", minWidth: 120, fontSize: 11.5 }}>
                    {a.error_code ?? "-"}
                  </td>
                  <td className="mono">{fmt.time(a.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {d.notes?.length ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            운영 메모
          </div>
          {d.notes.map((n, i) => (
            <div key={i} className="sub" style={{ padding: "3px 0" }}>
              <b style={{ color: "var(--text)" }}>{opName(n.by)}</b> {fmt.relative(n.at, now)} — {n.text}
            </div>
          ))}
        </div>
      ) : null}
      {data.replays.length ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Replay 결과
          </div>
          {data.replays.map((r) => {
            const w = data.replayWorkflows.find((x) => x.workflow_id === r.replay_workflow_id);
            return (
              <div key={r.replay_id} className="row" style={{ gap: 8, padding: "4px 0" }}>
                <span className="mono">{r.replay_id}</span>
                {w ? <StatusPill status={w.status} size="sm" /> : <ReplayStatusPill status={r.status} />}
                {r.replay_workflow_id && (
                  <Link className="idlink" href={wfHref(r.replay_workflow_id, { screen: "dlq", fq })}>
                    {r.replay_workflow_id}
                  </Link>
                )}
                <span className="sub">
                  {r.pipeline_version_from}→{r.pipeline_version_to} · {opName(r.approved_by)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {d.resolution && (
        <Note tone="cancelled" icon={<Archive aria-hidden />}>
          종료 사유: {d.resolution}
        </Note>
      )}
      {canAct &&
        (confirm && ((confirm.kind === "replay" && confirm.ids[0] === d.dead_letter_id) || (confirm.kind === "close" && confirm.id === d.dead_letter_id)) ? (
          confirm.kind === "replay" ? (
            <ReplayConfirm c={confirm} setC={setConfirm} onDone={() => setConfirm(null)} />
          ) : (
            <CloseConfirm c={confirm} setC={setConfirm} />
          )
        ) : (
          <>
            <div className="row">
              <button
                className="btn primary"
                onClick={() =>
                  setConfirm({ kind: "replay", ids: [d.dead_letter_id], batch: false, step: 1, reason: "", version: d.pipeline_version === "v1.0" ? DEFAULT_PIPELINE_VERSION : d.pipeline_version, priority: 8 })
                }
              >
                <RefreshCw aria-hidden />
                Replay 승인…
              </button>
              <button className="btn" onClick={() => setConfirm({ kind: "close", id: d.dead_letter_id, reason: "" })}>
                <Archive aria-hidden />
                종료 처리…
              </button>
            </div>
            <PermNote perm="replay.request" label="DLQ Replay" />
          </>
        ))}
    </div>
  );
}

function ReplayConfirm({ c, setC, onDone }: { c: Extract<Confirm, { kind: "replay" }>; setC: (c: Confirm | null) => void; onDone: () => void }) {
  const toast = useToast();
  const onErr = useApiErrorToast();
  const { can } = usePerm();
  const [busy, setBusy] = useState(false);
  const approve = can("replay.approve");
  const allowed = can("replay.request");
  const next = () => {
    if (!c.reason.trim()) {
      toast("Replay 사유를 입력하세요", "retry");
      return;
    }
    setC({ ...c, step: 2, reason: c.reason.trim() });
  };
  const apply = async () => {
    setBusy(true);
    try {
      if (!c.batch) {
        const r = await api.replayDeadLetter(c.ids[0], { reason: c.reason, pipeline_version: c.version, priority: c.priority });
        toast(
          <>
            Replay <span className="mono">{r.replay.replay_id}</span> 승인 → <span className="mono">{r.workflow.workflow_id}</span> (cycle {r.workflow.replay_cycle}) 대기열 재등록 ·{" "}
            <Link href="/flowline" className="idlink">
              관제에서 보기
            </Link>
          </>,
          "success",
        );
      } else {
        const r = await api.replayBatch({ ids: c.ids, reason: c.reason, pipeline_version: c.version });
        const failed = r.results.filter((x) => !x.ok);
        toast(
          <>
            일괄 Replay {r.succeeded}건 승인
            {r.succeeded ? (
              <>
                {" "}
                → <span className="mono">{r.results.filter((x) => x.ok).map((x) => x.workflow?.workflow_id).join(", ")}</span>
              </>
            ) : null}
            {failed.length ? ` · 차단 ${failed.length}건 (${failed.map((x) => `${x.id}: ${x.error}`).join(" / ")})` : ""}
          </>,
          failed.length && !r.succeeded ? "failed" : "success",
        );
      }
      revalidateKey("dead-letter");
      revalidateKey("replays");
      revalidateKey("workflows");
      onDone();
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="confirm">
      <div className="steps">
        <span className={clsx(c.step === 1 && "on")}>1 사유·버전</span>
        <ChevronRight aria-hidden />
        <span className={clsx(c.step === 2 && "on")}>2 검토</span>
        <ChevronRight aria-hidden />
        <span>3 승인</span>
      </div>
      {c.step === 1 ? (
        <>
          <label className="field">
            <span>Replay 사유 (필수 · 감사 로그 기록)</span>
            <textarea className="inp" rows={2} value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} placeholder="예: GPU quota 복구 확인 후 재실행" autoFocus />
          </label>
          <div className="row2">
            <label className="field">
              <span>Pipeline Version</span>
              <select className="inp" value={c.version} onChange={(e) => setC({ ...c, version: e.target.value })}>
                {PIPELINE_VERSIONS.filter((v) => v !== "v1.0").map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === DEFAULT_PIPELINE_VERSION ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Priority{c.batch ? " (일괄은 기본 8)" : ""}</span>
              <input className="inp mono" type="number" min={1} max={10} value={c.priority} disabled={c.batch} onChange={(e) => setC({ ...c, priority: Math.max(1, Math.min(10, +e.target.value || 8)) })} />
            </label>
          </div>
          <div className="row end">
            <button className="btn sm" onClick={() => setC(null)}>
              닫기
            </button>
            <button className="btn sm primary" onClick={next}>
              검토 <ChevronRight aria-hidden />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="stack" style={{ gap: 4, fontSize: 12.5 }}>
            <div className="row" style={{ gap: 4 }}>
              <b>{c.ids.length}건</b> Replay:{" "}
              {c.ids.map((i) => (
                <Tag key={i}>{i}</Tag>
              ))}
            </div>
            <div>새 Replay Cycle 생성 → 언어 대기열 재등록(priority {c.priority}) → Capacity 확보 후 Cloud Workflows 재실행</div>
            <div>
              버전 <b className="mono">{c.version}</b> · 사유 “{c.reason}”
            </div>
            <div className="sub">원본 입력은 수정하지 않으며 이전 실행 이력은 보존됩니다. 이미 Replay 중인 건은 서버에서 중복 승인이 차단됩니다(409).</div>
          </div>
          <PermNote perm="replay.request" label="DLQ Replay" />
          <div className="row end">
            <button className="btn sm" onClick={() => setC({ ...c, step: 1 })}>
              수정
            </button>
            <button className="btn sm primary" onClick={apply} disabled={busy || !allowed}>
              {approve ? <Check aria-hidden /> : <Send aria-hidden />}
              {approve ? "승인 및 Replay" : "Replay 요청 실행"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CloseConfirm({ c, setC }: { c: Extract<Confirm, { kind: "close" }>; setC: (c: Confirm | null) => void }) {
  const toast = useToast();
  const onErr = useApiErrorToast();
  const { can } = usePerm();
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (!c.reason.trim()) {
      toast("종료 사유를 입력하세요", "retry");
      return;
    }
    setBusy(true);
    try {
      await api.closeDeadLetter(c.id, { resolution: c.reason.trim() });
      toast(`${c.id} 종료 처리 · 감사 로그 기록`, "cancelled");
      revalidateKey("dead-letter");
      setC(null);
    } catch (e) {
      onErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="confirm">
      <div className="steps">
        <b className="on">종료 처리</b>
      </div>
      <label className="field">
        <span>종료 사유 (영구 실패 판정 근거)</span>
        <input className="inp" value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} placeholder="예: 원본 배치 폐기 — 재업로드 완료" autoFocus />
      </label>
      <div className="row end">
        <button className="btn sm" onClick={() => setC(null)}>
          닫기
        </button>
        <button className="btn sm danger" onClick={apply} disabled={busy || !can("replay.request")}>
          <Archive aria-hidden />
          종료
        </button>
      </div>
    </div>
  );
}

function ReplayTable() {
  const { data } = useApi(["replays", "all"], () => api.replays(), { revalidateOn: ["dlq", "transition"], throttleMs: 2500 });
  const wfIds = useMemo(() => (data ?? []).map((r) => r.replay_workflow_id).filter(Boolean) as string[], [data]);
  const wfs = useApi(wfIds.length ? ["workflows", "replays", wfIds.length] : null, () => api.workflows({ replay: true, pageSize: 200 }), { revalidateOn: ["transition"], throttleMs: 2500 });
  const st = Object.fromEntries((wfs.data?.items ?? []).map((w) => [w.workflow_id, w.status]));
  return (
    <Panel title="Replay 결과" icon={<RefreshCw aria-hidden />} right={<span className="sub">{data?.length ?? "-"}건 · 최신순 · 현재 상태는 Replay Workflow 기준</span>}>
      {!data ? (
        <Skel h={160} />
      ) : !data.length ? (
        <Empty>
          <Info size={14} aria-hidden /> Replay 기록이 없습니다
        </Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl fluid">
            <thead>
              <tr>
                <th>Replay</th>
                <th>DLQ</th>
                <th>원본 → Replay Workflow</th>
                <th>현재 상태</th>
                <th>버전</th>
                <th>승인</th>
                <th>요청 시각</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {[...data]
                  .sort((a, b) => b.created_at - a.created_at)
                  .map((r) => (
                    <motion.tr key={r.replay_id} layout="position" initial={{ opacity: 0, backgroundColor: "var(--accent-soft)" }} animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 1.2 }}>
                      <td className="mono nw">{r.replay_id}</td>
                      <td className="mono nw">
                        <Link className="idlink" href={`/flowline/dlq?focus=${r.dead_letter_id}`}>
                          {r.dead_letter_id}
                        </Link>
                      </td>
                      <td className="nw">
                        <Link className="idlink" href={wfHref(r.original_workflow_id, { screen: "dlq" })}>
                          {r.original_workflow_id}
                        </Link>{" "}
                        →{" "}
                        {r.replay_workflow_id ? (
                          <Link className="idlink" href={wfHref(r.replay_workflow_id, { screen: "dlq" })}>
                            {r.replay_workflow_id}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="nw">{r.replay_workflow_id && st[r.replay_workflow_id] ? <StatusPill status={st[r.replay_workflow_id]} size="sm" /> : <ReplayStatusPill status={r.status} />}</td>
                      <td className="mono nw">
                        {r.pipeline_version_from}→{r.pipeline_version_to}
                      </td>
                      <td className="nw">{opName(r.approved_by)}</td>
                      <td className="mono nw">{fmt.dateTime(r.created_at).slice(5, 16)}</td>
                      <td style={{ minWidth: 200 }}>{r.reason}</td>
                    </motion.tr>
                  ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export type { DeadLetter };
