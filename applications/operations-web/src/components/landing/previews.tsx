"use client";
/**
 * Live miniature previews of the three concepts (driven by the shared SSE tick snapshot).
 * Pure SVG; colors via the shared --st-* / --lang-* tokens plus each card's local palette.
 */
import { DAG_TEMPLATE, LANG_CODES, LANGUAGE_BY_CODE, STAGES } from "@/lib/catalog";
import type { ActiveWorkflowPos, LangCode, StageId, TickSnapshot } from "@/lib/types";

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MAIN = STAGES.filter((s) => s.kind === "main");

const LANG_FILL: Record<LangCode, string> = { ko: "var(--lang-ko)", en: "var(--lang-en)", ja: "var(--lang-ja)", es: "var(--lang-es)" };

function byStage(active: ActiveWorkflowPos[]) {
  const m: Partial<Record<StageId, ActiveWorkflowPos[]>> = {};
  for (const w of active) (m[w.stage] ||= []).push(w);
  return m;
}

// ───────────────────────────────────────── A · Flowline ──
export function FlowlinePreview({ snap }: { snap: TickSnapshot | null }) {
  const W = 320;
  const x0 = 22;
  const dx = (W - 44) / (MAIN.length - 1);
  const yRail = 78;
  const groups = byStage(snap?.active ?? []);
  const xOf = (id: StageId) => x0 + MAIN.findIndex((s) => s.id === id) * dx;
  const xRetry = xOf("vertex") - dx * 0.2;
  const xDlq = xOf("registry_queue") + dx * 0.9;
  return (
    <svg viewBox="0 0 320 180" className="block h-full w-full" role="img" aria-label="Flowline 미리보기: 파이프라인 레일 위 배치 토큰">
      <defs>
        <linearGradient id="fl-rail" x1="0" x2="1">
          <stop offset="0" stopColor="#74c2dd" stopOpacity=".15" />
          <stop offset=".5" stopColor="#74c2dd" stopOpacity=".7" />
          <stop offset="1" stopColor="#3fb871" stopOpacity=".6" />
        </linearGradient>
      </defs>
      <text x="14" y="20" className="lp-mono" fontSize="7.5" fill="#7a889f" letterSpacing=".12em">
        ORCHESTRATION · LIVE
      </text>
      <line x1={x0} y1={yRail} x2={W - x0} y2={yRail} stroke="url(#fl-rail)" strokeWidth="1.5" strokeDasharray="2 3" />
      {/* recovery loop */}
      <path
        d={`M ${xOf("vertex")} ${yRail + 8} C ${xOf("vertex")} 132, ${xRetry} 132, ${xRetry - 10} 140 L ${xDlq + 10} 140 C ${xDlq} 140, ${xOf("registry_queue")} 130, ${xOf("registry_queue")} ${yRail + 8}`}
        fill="none"
        stroke="#a77ff0"
        strokeOpacity=".45"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {MAIN.map((s) => {
        const x = xOf(s.id);
        const n = snap ? (snap.stageCounts[s.id] ?? 0) : null;
        const hot = s.id === "vertex" || s.id === "registry_queue";
        return (
          <g key={s.id}>
            <rect x={x - 15} y={yRail - 13} width="30" height="26" rx="5" fill="#131c2b" stroke={hot ? "#74c2dd" : "#2e3d57"} strokeOpacity={hot ? 0.8 : 1} />
            <text x={x} y={yRail + 4} textAnchor="middle" className="lp-mono tnum" fontSize="10" fontWeight="600" fill="#dce4f0">
              {n ?? "–"}
            </text>
            <text x={x} y={yRail + 26} textAnchor="middle" fontSize="6" fill="#7a889f">
              {s.label.ko.replace(/·.*/, "").slice(0, 6)}
            </text>
          </g>
        );
      })}
      {(["retry", "dlq"] as const).map((id) => {
        const x = id === "retry" ? xRetry : xDlq;
        const n = snap ? (snap.stageCounts[id] ?? 0) : null;
        const c = id === "retry" ? "var(--st-retry)" : "var(--st-dlq)";
        return (
          <g key={id}>
            <rect x={x - 17} y={128} width="34" height="22" rx="5" fill="#131c2b" stroke={c} strokeOpacity=".7" />
            <text x={x} y={143} textAnchor="middle" className="lp-mono tnum" fontSize="9.5" fontWeight="600" fill={c}>
              {n ?? "–"}
            </text>
            <text x={x} y={162} textAnchor="middle" fontSize="6" fill="#7a889f">
              {id === "retry" ? "재시도" : "DLQ"}
            </text>
          </g>
        );
      })}
      {/* batch tokens */}
      {Object.entries(groups).flatMap(([stage, ws]) => {
        const sid = stage as StageId;
        const onRail = MAIN.some((s) => s.id === sid);
        const bx = onRail ? xOf(sid) : sid === "retry" ? xRetry : xDlq;
        const by = onRail ? yRail - 22 : 122;
        return (ws ?? []).slice(0, 14).map((w, i) => {
          const col = i % 7;
          const row = Math.floor(i / 7);
          const cx = bx - 12 + col * 4 + ((hash(w.workflow_id) % 3) - 1) * 0.3;
          const cy = by - row * 4.5;
          return (
            <circle
              key={w.workflow_id}
              className="lp-token"
              cx={cx}
              cy={cy}
              r="1.7"
              fill={w.status === "RETRY_WAIT" ? "none" : LANG_FILL[w.language]}
              stroke={w.status === "RETRY_WAIT" ? "var(--st-retry)" : "none"}
              strokeWidth=".9"
            />
          );
        });
      })}
    </svg>
  );
}

// ───────────────────────────────────────── B · Atlas ──
export function AtlasPreview({ snap }: { snap: TickSnapshot | null }) {
  const sc = snap?.stageCounts;
  const v = (id: StageId) => (sc ? String(sc[id] ?? 0) : "–");
  const nodeRunning: Record<string, number> = {};
  for (const w of snap?.active ?? []) if (w.status === "RUNNING" && w.current_node) nodeRunning[w.current_node] = (nodeRunning[w.current_node] ?? 0) + 1;
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, val: string, accent = false) => (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#f9fbfc" stroke={accent ? "#0a6c85" : "#13233a"} strokeWidth={accent ? 1.1 : 0.8} />
      <text x={x + 5} y={y + 10} fontSize="6.6" fontWeight="700" fill="#13233a" className="lp-atlas">
        {title}
      </text>
      <text x={x + 5} y={y + 17} fontSize="4.6" fill="#77849a" className="lp-mono" letterSpacing=".06em">
        {sub}
      </text>
      <text x={x + w - 5} y={y + h - 5} textAnchor="end" fontSize="9" fontWeight="600" fill={accent ? "#0a6c85" : "#13233a"} className="lp-mono tnum">
        {val}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 320 180" className="block h-full w-full" role="img" aria-label="Atlas 미리보기: 아키텍처 도면">
      <defs>
        <pattern id="at-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="#dbe3ea" strokeWidth=".5" />
        </pattern>
        <pattern id="at-grid-major" width="50" height="50" patternUnits="userSpaceOnUse">
          <rect width="50" height="50" fill="url(#at-grid)" />
          <path d="M50 0H0V50" fill="none" stroke="#c7d3de" strokeWidth=".7" />
        </pattern>
      </defs>
      <rect width="320" height="180" fill="#edf1f4" />
      <rect width="320" height="180" fill="url(#at-grid-major)" />
      <g stroke="#0a6c85" strokeWidth=".9" strokeDasharray="1.5 2" fill="none" className="lp-flow">
        <path d="M70 40 H96" />
        <path d="M156 40 H182" />
        <path d="M242 40 H262 V70" />
        <path d="M262 100 V112 H232" />
        <path d="M120 130 H96" />
        <path d="M60 112 V70" stroke="#c27a00" />
      </g>
      {box(12, 22, 58, 36, "Event Ingress", "CLOUD RUN", v("ingress"))}
      {box(96, 22, 60, 36, "Firestore", "PENDING QUEUE", v("registry_queue"), true)}
      {box(182, 22, 60, 36, "Scheduler", "SLOT ADMISSION", snap ? `${snap.capacity.global.active}/${snap.capacity.global.max}` : "–")}
      {box(232, 70, 76, 30, "Workflows", "ORCHESTRATOR", v("workflows"))}
      {/* vertex DAG box */}
      <rect x="120" y="84" width="108" height="78" fill="#f9fbfc" stroke="#0a6c85" strokeWidth="1.1" />
      <text x="125" y="94" fontSize="6.6" fontWeight="700" fill="#13233a" className="lp-atlas">
        Vertex AI Pipelines
      </text>
      <text x="223" y="94" textAnchor="end" fontSize="8" fontWeight="600" fill="#2a78d6" className="lp-mono tnum">
        {v("vertex")}
      </text>
      {DAG_TEMPLATE.map((n, i) => {
        const pos = [
          [128, 120],
          [152, 104],
          [152, 120],
          [152, 136],
          [178, 120],
          [202, 120],
        ][i];
        const r = nodeRunning[n.id] ?? 0;
        return (
          <g key={n.id}>
            <rect x={pos[0]} y={pos[1] - 5} width="18" height="10" fill={r ? "color-mix(in oklab, var(--st-running) 14%, #f9fbfc)" : "#f2f5f8"} stroke={r ? "var(--st-running)" : "#bfccd9"} strokeWidth=".7" />
            <text x={pos[0] + 9} y={pos[1] + 2.4} textAnchor="middle" fontSize="5.5" fill="#13233a" className="lp-mono tnum">
              {r || ""}
            </text>
          </g>
        );
      })}
      {box(12, 112, 48, 30, "Retry", "BACKOFF", v("retry"))}
      {box(62, 140, 48, 30, "DLQ", "DEAD LETTER", v("dlq"))}
      <text x="12" y="14" fontSize="5.4" fill="#b4552a" className="lp-mono" letterSpacing=".1em">
        DWG AIPO-ORCH-001 · SCALE 1:1.59
      </text>
    </svg>
  );
}

// ───────────────────────────────────────── C · Lanes ──
export function LanesPreview({ snap }: { snap: TickSnapshot | null }) {
  const langs = snap?.capacity.languages;
  const rowH = 34;
  return (
    <svg viewBox="0 0 320 180" className="block h-full w-full" role="img" aria-label="Lanes 미리보기: 언어 레인 Capacity 보드">
      <rect width="320" height="180" fill="#ffffff" />
      <text x="14" y="20" fontSize="10.5" fontWeight="800" fill="#101318" className="lp-lanes-title">
        언어 레인 스케줄러
      </text>
      <line x1="14" y1="27" x2="306" y2="27" stroke="#101318" strokeWidth="1.4" />
      {LANG_CODES.map((code, i) => {
        const l = langs?.find((x) => x.code === code);
        const y = 34 + i * rowH;
        const max = l?.max ?? LANGUAGE_BY_CODE[code].maxConcurrent;
        const active = l?.active ?? 0;
        const cells = Math.min(max, 25);
        const cw = Math.min(8, 196 / cells - 1.5);
        return (
          <g key={code}>
            <rect x="14" y={y + 4} width="2.5" height={rowH - 10} fill={LANG_FILL[code]} />
            <text x="21" y={y + 14} fontSize="8" fontWeight="700" fill="#101318" className="lp-lanes">
              {LANGUAGE_BY_CODE[code].name}
            </text>
            <text x="21" y={y + 23} fontSize="6" fill="#69717d" className="lp-mono tnum">
              {l ? `${l.active}/${l.max} · 대기 ${l.backlog}` : "–"}
            </text>
            {Array.from({ length: cells }).map((_, k) => (
              <rect
                key={k}
                x={88 + k * (cw + 1.5)}
                y={y + 9}
                width={cw}
                height="10"
                rx="1.5"
                fill={k < active ? LANG_FILL[code] : "transparent"}
                stroke={k < active ? "none" : "#c3c9d1"}
                strokeDasharray={k < active ? undefined : "1.5 1.5"}
                strokeWidth=".7"
                className="lp-cell"
              />
            ))}
            {l?.status === "SATURATED" && (
              <text x="306" y={y + 17} textAnchor="end" fontSize="6" fontWeight="700" fill="var(--st-retry)" className="lp-mono">
                포화
              </text>
            )}
            <line x1="14" y1={y + rowH - 2} x2="306" y2={y + rowH - 2} stroke="#dadee4" strokeWidth=".6" />
          </g>
        );
      })}
    </svg>
  );
}
