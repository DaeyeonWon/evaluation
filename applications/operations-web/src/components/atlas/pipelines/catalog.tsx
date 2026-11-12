"use client";
/**
 * P-01 · Pipelines catalog (/pipelines): every registry definition with a live summary over the
 * URL range (runs, running now, failed, success rate, p95, sparkline), a version selector (per-version
 * stats + DAG schematic), sub-pipeline tags with called-by / calls, and the "mixed running now" strip.
 */
import clsx from "clsx";
import { ArrowRight, CornerDownRight, Layers, Workflow } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { statusLabel } from "@/i18n";
import { useFmt, useLocale, useT } from "@/i18n/client";
import { useApi, useTimeRange } from "@/lib/client";
import type { PipelineListItem } from "@/lib/client/api";
import { RangeEmpty, RangeTag, useRangeHref } from "../time-range";
import { ErrorNote, Sheet, SheetHead, Skeleton } from "../ui";
import { allRuns, bucketRuns, MixedRunning, pipeColor, Sparkline, usePipelineList } from "./common";
import { defaultVersion, findVersion, type PipelineVersionDefn } from "./model";
import "@/styles/atlas-pipelines.css";

/** tiny left→right schematic of a version's DAG (layers only) */
function Schematic({ v }: { v: PipelineVersionDefn }) {
  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    const n = v.nodes.find((x) => x.id === id);
    const d = n && n.deps.length ? Math.max(...n.deps.map(depth)) + 1 : 0;
    layer.set(id, d);
    return d;
  };
  v.nodes.forEach((n) => depth(n.id));
  const cols: (typeof v.nodes)[] = [];
  v.nodes.forEach((n) => (cols[layer.get(n.id)!] ??= []).push(n));
  const cw = 46;
  const W = cols.length * cw;
  const H = Math.max(...cols.map((c) => c.length)) * 14 + 4;
  const pos = new Map<string, [number, number]>();
  cols.forEach((c, ci) => c.forEach((n, ri) => pos.set(n.id, [ci * cw + 4, H / 2 - (c.length * 14) / 2 + ri * 14 + 2])));
  return (
    <svg className="pl-schem" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      {v.nodes.flatMap((n) =>
        n.deps.map((d) => {
          const a = pos.get(d)!;
          const b = pos.get(n.id)!;
          return <path key={d + n.id} d={`M${a[0] + 30},${a[1] + 5} C${a[0] + 38},${a[1] + 5} ${b[0] - 8},${b[1] + 5} ${b[0]},${b[1] + 5}`} className="e" />;
        }),
      )}
      {v.nodes.map((n) => {
        const [x, y] = pos.get(n.id)!;
        return n.kind === "subpipeline" ? (
          <g key={n.id}>
            <rect x={x + 2} y={y + 2} width={30} height={10} className="s2" />
            <rect x={x} y={y} width={30} height={10} className="s" />
          </g>
        ) : (
          <rect key={n.id} x={x} y={y} width={30} height={10} className="c" />
        );
      })}
    </svg>
  );
}

function Row({ p, spark }: { p: PipelineListItem; spark?: { all: number[]; failed: number[] } }) {
  const t = useT("pipelines");
  const f = useFmt();
  const locale = useLocale();
  const rh = useRangeHref();
  const def = p.definition;
  // default: the version that ran most in the range, else the latest non-deprecated one
  const [ver, setVer] = useState<string>(() => {
    const top = Object.entries(p.byVersion).sort((a, b) => b[1].runs - a[1].runs)[0];
    return top && top[1].runs ? top[0] : (defaultVersion(def) ?? p.latestVersion);
  });
  const v = findVersion(def, ver);
  const bv = p.byVersion[ver];
  const sr = p.successRate;
  const calls = v?.subpipelines ?? [];
  return (
    <article className={clsx("pl-card", p.kind === "sub" && "sub")} style={{ ["--pc" as string]: pipeColor(p.id) }} aria-labelledby={`pl-${p.id}`}>
      <div className="pl-card-id">
        <div className="pl-card-t">
          {p.kind === "sub" ? <Layers aria-hidden /> : <Workflow aria-hidden />}
          <Link id={`pl-${p.id}`} href={rh(`/pipelines/${encodeURIComponent(p.id)}?version=${encodeURIComponent(ver)}`)}>
            {p.id}
          </Link>
          <span className={clsx("pl-kind", p.kind)}>{p.kind === "sub" ? t("catalog.kindSub") : t("catalog.kindRoot")}</span>
        </div>
        <div className="pl-card-name">
          {p.label}
          {locale === "ko" && p.labelKo !== p.label ? <span className="muted"> · {p.labelKo}</span> : null}
        </div>
        <p className="pl-card-desc">{t.dynamic(`defs.${p.id}`, undefined, def.description)}</p>
        <div className="pl-rel">
          {p.kind === "sub" ? (
            <div>
              <span className="k">{t("catalog.calledBy")}</span>
              {def.usedBy.length ? (
                def.usedBy.map((u) => (
                  <Link key={u} className="chip" href={rh(`/pipelines/${encodeURIComponent(u)}`)}>
                    <CornerDownRight aria-hidden />
                    {u}
                  </Link>
                ))
              ) : (
                <span className="muted">—</span>
              )}
            </div>
          ) : null}
          {calls.length ? (
            <div>
              <span className="k">{t("catalog.calls")}</span>
              {calls.map((c) => {
                const [cid, cver] = c.split("@");
                return (
                  <Link key={c} className="chip sub" href={rh(`/pipelines/${encodeURIComponent(cid)}?version=${encodeURIComponent(cver)}`)}>
                    <Layers aria-hidden />
                    {c}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="pl-card-ver">
        <label className="field">
          <span>Version</span>
          <select className="in" value={ver} onChange={(e) => setVer(e.target.value)} aria-label={t("catalog.versionFor", { id: p.id })}>
            {def.versions.map((x) => (
              <option key={x.version} value={x.version}>
                {x.version} · {statusLabel("version", x.status, locale)}
              </option>
            ))}
          </select>
        </label>
        {v ? <Schematic v={v} /> : null}
        <div className="mono muted pl-card-vstat">
          {bv ? t("catalog.versionStat", { runs: bv.runs, rate: bv.successRate == null ? "—" : f.pct(bv.successRate, 0) }) : t("catalog.versionNoRuns")}
        </div>
      </div>
      <dl className="pl-card-kpis">
        <div>
          <dt>{t("kpi.runs")}</dt>
          <dd>{f.number(p.runs)}</dd>
        </div>
        <div className={clsx(p.running && "run")}>
          <dt>{t("kpi.running")}</dt>
          <dd>
            {p.running ? <i className="pulse" aria-hidden /> : null}
            {f.number(p.running)}
          </dd>
        </div>
        <div className={clsx(p.failed && "bad")}>
          <dt>{t("kpi.failed")}</dt>
          <dd>{f.number(p.failed)}</dd>
        </div>
        <div>
          <dt>{t("kpi.successRate")}</dt>
          <dd className={clsx(sr != null && sr < 0.8 && "warn")}>{sr == null ? "—" : f.pct(sr, 1)}</dd>
        </div>
        <div>
          <dt>p95</dt>
          <dd>{p.p95DurationMs ? f.duration(p.p95DurationMs, { style: "short" }) : "—"}</dd>
        </div>
        <div className="spark">
          <dt>{t("kpi.trend")}</dt>
          <dd>{spark ? <Sparkline runs={spark.all} failed={spark.failed} label={t("catalog.sparkLabel", { id: p.id })} /> : <span className="skel" style={{ width: 120, height: 28, display: "block" }} />}</dd>
        </div>
      </dl>
      <Link className="pl-card-go" href={rh(`/pipelines/${encodeURIComponent(p.id)}?version=${encodeURIComponent(ver)}`)} aria-label={t("catalog.openStatus", { id: p.id })}>
        <ArrowRight aria-hidden />
      </Link>
    </article>
  );
}

export function PipelinesCatalog() {
  const t = useT("pipelines");
  const tr = useTimeRange();
  const [kind, setKind] = useState<"all" | "root" | "sub">("all");
  const list = usePipelineList(tr.params, tr.key);
  const items = list.data?.items;
  const range = list.data?.range;
  const sparkQ = useApi(
    items && range ? ["pipelines", "spark", tr.key, items.map((i) => i.id).join(",")] : null,
    async () => {
      const out: Record<string, { all: number[]; failed: number[] }> = {};
      await Promise.all(
        items!.map(async (i) => {
          const r = await allRuns(i.id, tr.params);
          out[i.id] = bucketRuns(r.items, r.range.from, r.range.to, 24);
        }),
      );
      return out;
    },
    { revalidateOn: ["job"], throttleMs: 8000 },
  );
  const shown = useMemo(() => (items ?? []).filter((i) => kind === "all" || i.kind === kind), [items, kind]);
  const roots = shown.filter((i) => i.kind === "root");
  const subs = shown.filter((i) => i.kind === "sub");
  const totalRuns = (items ?? []).filter((i) => i.kind === "root").reduce((s, i) => s + i.runs, 0);

  return (
    <Sheet>
      <SheetHead
        dwg="SHEET P-01 · PIPELINE REGISTRY"
        title={t("catalog.title")}
        desc={t("catalog.desc")}
        acts={
          <>
            <RangeTag />
            <div className="seg" role="group" aria-label={t("catalog.kindFilter")}>
              {(["all", "root", "sub"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {t(`catalog.kind.${k}`)}
                </button>
              ))}
            </div>
          </>
        }
      />
      <MixedRunning items={items} />
      {list.error && !items ? <ErrorNote error={list.error} /> : null}
      {!items ? (
        <Skeleton rows={8} />
      ) : (
        <>
          {items.length && !totalRuns ? <RangeEmpty title={t("catalog.noRuns")} /> : null}
          {roots.length ? (
            <section aria-labelledby="pl-roots">
              <h2 className="pl-sec" id="pl-roots">
                {t("catalog.roots")} <span className="mono muted">{roots.length}</span>
              </h2>
              <div className="pl-cards">
                {roots.map((p) => (
                  <Row key={p.id} p={p} spark={sparkQ.data?.[p.id]} />
                ))}
              </div>
            </section>
          ) : null}
          {subs.length ? (
            <section aria-labelledby="pl-subs">
              <h2 className="pl-sec" id="pl-subs">
                {t("catalog.subs")} <span className="mono muted">{subs.length}</span>
                <span className="pl-sec-hint">{t("catalog.subsHint")}</span>
              </h2>
              <div className="pl-cards">
                {subs.map((p) => (
                  <Row key={p.id} p={p} spark={sparkQ.data?.[p.id]} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
