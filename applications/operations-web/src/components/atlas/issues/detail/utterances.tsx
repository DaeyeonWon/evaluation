"use client";
/**
 * Issue detail — the issue's utterances (FAIL rows), server-paged and searchable through GET /results with the
 * issue's results_query + the range. Each row: text, ASR, expected → predicted intent, judge score/reason,
 * device, Bixby version, region; expanding shows the expected vs actual response diff. Links keep the range.
 */
import clsx from "clsx";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, MessagesSquare, Search, Workflow } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LangBadge } from "@/components/shared";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { deviceLabel } from "@/i18n/static";
import { api, useApi, type ResultQuery } from "@/lib/client";
import type { ResultRow } from "@/lib/types";
import { ModuleBadges, useDimLabel } from "../../issues-shared";
import { useDetailLinks } from "./links";
import { ErrorNote, Plate, Skeleton } from "../../ui";
import { diffTokens, type DiffPart } from "./lib";

const PAGE = 12;
const SORTS = ["eval_desc", "score_asc", "score_desc", "latency_desc"] as const;

function Diff({ parts, side }: { parts: DiffPart[]; side: "a" | "b" }) {
  return (
    <span className="idt-diff">
      {parts.map((p, i) =>
        p.op === "same" ? (
          <span key={i}>{p.text}</span>
        ) : (side === "a" && p.op === "del") || (side === "b" && p.op === "add") ? (
          <mark key={i} data-op={p.op}>
            {p.text}
          </mark>
        ) : null,
      )}
    </span>
  );
}

function Row({ u, open, onToggle }: { u: ResultRow; open: boolean; onToggle: () => void }) {
  const t = useT("issuesDetail");
  const s = useT("issues");
  const fm = useFmt();
  const dl = useDimLabel();
  const locale = useLocale();
  const L = useDetailLinks();
  const parts = useMemo(() => (open ? diffTokens(u.expected_response, u.actual_response) : []), [open, u.expected_response, u.actual_response]);
  const asrDiff = useMemo(() => (u.asr_text !== u.utterance_text ? diffTokens(u.utterance_text, u.asr_text) : null), [u.asr_text, u.utterance_text]);
  const misroute = u.intent_predicted !== u.intent_expected;
  const judge = u.judge_score;
  return (
    <li className={clsx("idt-u", open && "open")}>
      <button type="button" className="idt-u-main" onClick={onToggle} aria-expanded={open}>
        <span className="idt-u-text">
          <span className="idt-u-utt">
            <LangBadge lang={u.language} />
            <q>{u.utterance_text}</q>
          </span>
          {asrDiff ? (
            <span className="idt-u-asr">
              <span className="mono idt-u-tag">ASR</span> <Diff parts={asrDiff} side="b" />
            </span>
          ) : null}
        </span>
        <span className="idt-u-int mono">
          <span>{u.intent_expected}</span>
          {misroute ? (
            <>
              <span className="idt-arrow">→</span>
              <span className="idt-bad">{u.intent_predicted}</span>
            </>
          ) : (
            <span className="muted"> ✓ {t("utt.sameIntent")}</span>
          )}
          <small className="muted">{u.failure_reason ? s.dynamic(`failureReason.${u.failure_reason}`, undefined, u.failure_reason) : ""}</small>
        </span>
        <span className="idt-u-judge">
          <span className="idt-u-score mono" data-lvl={judge < 0.3 ? "low" : judge < 0.6 ? "mid" : "hi"} title={t("utt.judgeScore")}>
            {judge.toFixed(2)}
          </span>
          <span className="idt-u-reason">{u.judge_reason}</span>
        </span>
        <span className="idt-u-meta mono">
          <span title={s("column.device")}>{deviceLabel(u.device_type, locale)}</span>
          <span title="Bixby version">Bixby {u.bixby_version}</span>
          <span title={s("column.region")}>
            {dl.value("region", u.region)} · {u.market}
          </span>
          <span className="muted">{fm.dateTimeLabel(u.eval_ts)}</span>
        </span>
        <ChevronDown className="idt-u-chev" aria-hidden />
      </button>
      {open ? (
        <div className="idt-u-x">
          <div className="idt-u-resp">
            <div>
              <span className="idt-u-k">{s("field.expectedResponse")}</span>
              <p>
                <Diff parts={parts} side="a" />
              </p>
            </div>
            <div>
              <span className="idt-u-k">{s("field.actualResponse")}</span>
              <p>
                <Diff parts={parts} side="b" />
              </p>
            </div>
          </div>
          <dl className="idt-u-kv mono">
            <div>
              <dt>{s("column.capsule")}</dt>
              <dd>{u.capsule}</dd>
            </div>
            <div>
              <dt>{s("column.model_version")}</dt>
              <dd>{u.model_version}</dd>
            </div>
            <div>
              <dt>{s("column.pipeline_version")}</dt>
              <dd>{u.pipeline_version}</dd>
            </div>
            <div>
              <dt>{s("column.one_ui_version")}</dt>
              <dd>{u.one_ui_version}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>{fm.number(u.latency_ms)} ms</dd>
            </div>
          </dl>
          <div className="idt-u-links">
            <Link className="btn sm" href={L.utterance(u.utterance_id)}>
              {t("utt.openResult")} <ArrowUpRight aria-hidden />
            </Link>
            <Link className="btn sm" href={L.workflow(u.workflow_id, u.eval_ts, u.eval_ts)}>
              <Workflow aria-hidden /> {u.workflow_id}
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function Utterances({ base, range, resultsUrl, csvUrl }: { base: Record<string, string>; range: Record<string, string>; resultsUrl: string; csvUrl: string }) {
  const t = useT("issuesDetail");
  const fm = useFmt();
  const [qIn, setQIn] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("eval_desc");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(qIn.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [qIn]);
  const query: ResultQuery = useMemo(() => ({ ...base, ...range, ...(q ? { q } : {}), sort, page, pageSize: PAGE }), [base, range, q, sort, page]);
  const r = useApi(["issues:detail-utts", query], () => api.results(query), { revalidateOn: ["issue"], keepPrevious: true });
  const data = r.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  return (
    <Plate
      title={
        <>
          <MessagesSquare aria-hidden /> {t("utt.title")}
          {data ? <span className="mono muted idt-count">{fm.number(data.total)}</span> : null}
          <ModuleBadges feature="detail.utterances" />
        </>
      }
      right={
        <span className="idt-plate-acts">
          <a className="btn sm" href={csvUrl} download>
            <Download aria-hidden /> CSV
          </a>
          <Link className="btn sm" href={resultsUrl}>
            {t("utt.allInResults")} <ExternalLink aria-hidden />
          </Link>
        </span>
      }
    >
      <div className="idt-u-tools">
        <label className="idt-u-search">
          <Search aria-hidden />
          <input className="in" type="search" value={qIn} onChange={(e) => setQIn(e.target.value)} placeholder={t("utt.search")} aria-label={t("utt.search")} />
        </label>
        <div className="seg" role="group" aria-label={t("utt.sort")}>
          {SORTS.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={sort === x}
              onClick={() => {
                setSort(x);
                setPage(1);
              }}
            >
              {t(`utt.sorts.${x}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="idt-u-head mono" aria-hidden>
        <span>{t("utt.colText")}</span>
        <span>{t("utt.colIntent")}</span>
        <span>{t("utt.colJudge")}</span>
        <span>{t("utt.colContext")}</span>
      </div>
      {r.error && !data ? <ErrorNote error={r.error} /> : null}
      {!data && !r.error ? (
        <Skeleton rows={5} />
      ) : data && data.rows.length ? (
        <ul className={clsx("idt-us", r.isValidating && "busy")}>
          {data.rows.map((u) => (
            <Row key={u.utterance_id} u={u} open={open === u.utterance_id} onToggle={() => setOpen(open === u.utterance_id ? null : u.utterance_id)} />
          ))}
        </ul>
      ) : data ? (
        <p className="muted idt-empty">{q ? t("utt.noMatch", { q }) : t("utt.none")}</p>
      ) : null}
      {data && pages > 1 ? (
        <div className="idt-pager">
          <button type="button" className="btn sm icon" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t("utt.prev")}>
            <ChevronLeft aria-hidden />
          </button>
          <span className="mono">{t("utt.page", { page, pages })}</span>
          <button type="button" className="btn sm icon" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={t("utt.next")}>
            <ChevronRight aria-hidden />
          </button>
        </div>
      ) : null}
    </Plate>
  );
}
