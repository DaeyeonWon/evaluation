/* eslint-disable */
// @ts-nocheck
/**
 * AIPO mock engine — originally a port of designs/mock-data.js, now the evolving mock backend.
 *
 * Type-checking is disabled for this file only; the typed boundary is ./engine-types.ts +
 * src/lib/types.ts. The oracle was retired, so the data model may change.
 *
 *  - createMockEngine(root, { domain, baseNow }) — `domain` is src/config/domain.ts (passed in so this
 *    file stays importable by scripts/gen-catalog.mjs as plain JS); `baseNow` re-anchors the scenario
 *    (used by the runtime day-loop).
 *  - Pipelines: a versioned registry with sub-pipelines. Every attempt has a root PipelineJob
 *    `{workflow_id}-cycle-{c}-attempt-{a}` and child jobs `{parentJobId}.{nodeId}` per sub-pipeline node.
 *    Attempt.dag / Workflow.dag stay a LEGACY six-phase projection.
 *  - 30 days of history (lower density before day 8). Result rows are derived lazily per workflow
 *    (seeded by workflow_id) through a bounded LRU cache.
 */
/*!
 * mock-data.js — 빅스비 실발화 평가 / AIPO (AI Pipeline Orchestration Platform) 공용 Mock 데이터
 *
 * DESIGN-STAGE MOCK ONLY. No GCP calls. Deterministic (seeded PRNG). Base "now" = 2026-11-12T14:30:00+09:00.
 * Usage:  <script src="mock-data.js"></script>  ->  window.MOCK
 *
 * Top-level surface (see API reference returned with this file for shapes):
 *   MOCK.meta, MOCK.now(), MOCK.config, MOCK.stages, MOCK.stageEdges, MOCK.STATE_TO_STAGE, MOCK.DAG_TEMPLATE,
 *   MOCK.statusMeta, MOCK.nodeStatusMeta, MOCK.attemptStatusMeta, MOCK.dlqStatusMeta, MOCK.failureCategoryMeta,
 *   MOCK.failureReasonMeta, MOCK.severityMeta, MOCK.eventCatalog, MOCK.capsules, MOCK.devices,
 *   MOCK.workflows, MOCK.getWorkflow(id), MOCK.listWorkflows(filter), MOCK.workflowsByStage(), MOCK.stageDetail(id),
 *   MOCK.events {all, byWorkflow, recent(n), forWorkflow(id)}, MOCK.getEvents(id),
 *   MOCK.logs {all, byWorkflow, system, recent(n), query(filter)}, MOCK.getLogs(id, filter),
 *   MOCK.gcs {buckets, objects, list(), get(), read(), sampleLines()},
 *   MOCK.dlq, MOCK.replays, MOCK.getDeadLetter(id),
 *   MOCK.reservations, MOCK.getCapacity(), MOCK.overview(),
 *   MOCK.metrics {hourly, fiveMin, daily, errorCategories7d, componentDurations(), versionComparison(), languageSummary()},
 *   MOCK.alerts, MOCK.incidents,
 *   MOCK.results {columns, rows, file, files, byWorkflow(id), forWorkflow(id), summary(rows), toCSV(rows, opts)},
 *   MOCK.actions {...}, MOCK.on(evt, cb), MOCK.off(evt, cb), MOCK.createSimulator(opts), MOCK.fmt {...}
 */
export function createMockEngine(root, opts) {
  'use strict';
  opts = opts || {};
  if (!opts.domain) throw new Error('createMockEngine: opts.domain (src/config/domain.ts) is required');
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  var DOMAIN = clone(opts.domain);
  var HISTORY_DAYS = DOMAIN.historyDays || 30;

  // ───────────────────────────────────────────── utils ──
  var BASE_NOW = opts.baseNow != null ? opts.baseNow : Date.parse(DOMAIN.baseNow);
  var clock = { now: BASE_NOW };
  var SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR, KST = 9 * HOUR;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    var n = mulberry32(seed);
    var r = {
      next: n,
      float: function (a, b) { return a + (b - a) * n(); },
      int: function (a, b) { return a + Math.floor(n() * (b - a + 1)); },
      chance: function (p) { return n() < p; },
      pick: function (arr) { return arr[Math.floor(n() * arr.length)]; },
      weighted: function (obj) {
        var entries = Array.isArray(obj) ? obj : Object.keys(obj).map(function (k) { return [k, obj[k]]; });
        var tot = 0; entries.forEach(function (e) { tot += e[1]; });
        var x = n() * tot;
        for (var i = 0; i < entries.length; i++) { x -= entries[i][1]; if (x <= 0) return entries[i][0]; }
        return entries[entries.length - 1][0];
      },
      hex: function (len) { var s = ''; for (var i = 0; i < len; i++) s += '0123456789abcdef'[Math.floor(n() * 16)]; return s; },
      b64: function (len) { var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; var s = ''; for (var i = 0; i < len; i++) s += c[Math.floor(n() * 64)]; return s; },
      normal: function (mu, sd) { var u = 1 - n(), v = n(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
      uuid: function () { return r.hex(8) + '-' + r.hex(4) + '-4' + r.hex(3) + '-' + '89ab'[Math.floor(n() * 4)] + r.hex(3) + '-' + r.hex(12); }
    };
    return r;
  }
  var R = makeRng(20261112);            // static generation stream
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function kstParts(ts) {
    var d = new Date(ts + KST);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(), dow: d.getUTCDay() };
  }
  function kstDate(ts) { var p = kstParts(ts); return p.y + '-' + pad(p.mo) + '-' + pad(p.d); }
  function kstCompact(ts) { return kstDate(ts).replace(/-/g, ''); }
  function kstDayStart(ts) { return Math.floor((ts + KST) / DAY) * DAY - KST; }
  function isoUtc(ts) { return new Date(ts).toISOString(); }
  function isoKst(ts) { var p = kstParts(ts); return kstDate(ts) + 'T' + pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s) + '.' + pad(p.ms, 3) + '+09:00'; }
  function fill(str, slots) { return str.replace(/\{(\w+)\}/g, function (m, k) { return slots[k] != null ? slots[k] : m; }); }
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function pctl(arr, p) { if (!arr.length) return 0; var a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }
  function avg(arr) { return arr.length ? sum(arr) / arr.length : 0; }
  function round(x, d) { var m = Math.pow(10, d || 0); return Math.round(x * m) / m; }
  function insertSorted(arr, item, key) {
    key = key || 'ts';
    var i = arr.length;
    while (i > 0 && arr[i - 1][key] > item[key]) i--;
    arr.splice(i, 0, item);
  }
  var TODAY = kstDate(BASE_NOW), TODAY_START = kstDayStart(BASE_NOW);

  // ───────────────────────────────────────────── bus ──
  var listeners = {};
  var BUILDING = true;
  function on(name, cb) { (listeners[name] = listeners[name] || []).push(cb); return function () { off(name, cb); }; }
  function off(name, cb) { var l = listeners[name]; if (!l) return; var i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); }
  function emit(name, payload) {
    if (BUILDING) return;
    var l = (listeners[name] || []).slice();
    for (var i = 0; i < l.length; i++) { try { l[i](payload); } catch (e) { if (root.console) root.console.error('[MOCK listener ' + name + ']', e); } }
  }

  // ───────────────────────────────────────────── fmt ──
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  var fmt = {
    bytes: function (n) {
      if (n == null || isNaN(n)) return '-';
      var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, v = n;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
      return (i === 0 ? String(v) : v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)) + ' ' + u[i];
    },
    number: function (n, d) { if (n == null || isNaN(n)) return '-'; d = d || 0; return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
    pct: function (x, d) { if (x == null || isNaN(x)) return '-'; return (x * 100).toFixed(d == null ? 1 : d) + '%'; },
    usd: function (n, d) { return '$' + fmt.number(n, d == null ? 2 : d); },
    duration: function (ms, opts) {
      if (ms == null || isNaN(ms)) return '-';
      var short = opts && opts.style === 'short';
      ms = Math.max(0, Math.round(ms));
      if (ms < 1000) return ms + 'ms';
      var s = ms / 1000;
      if (s < 60) return short ? s.toFixed(1) + 's' : (s < 10 ? s.toFixed(1) : Math.round(s)) + '초';
      var tot = Math.round(s), h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), sec = tot % 60;
      if (h > 0) return short ? h + 'h ' + pad(m) + 'm' : h + '시간 ' + m + '분';
      return short ? m + 'm ' + pad(sec) + 's' : m + '분 ' + sec + '초';
    },
    time: function (ts) { if (ts == null) return '-'; var p = kstParts(ts); return pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s); },
    timeMs: function (ts) { if (ts == null) return '-'; var p = kstParts(ts); return pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.s) + '.' + pad(p.ms, 3); },
    hm: function (ts) { if (ts == null) return '-'; var p = kstParts(ts); return pad(p.h) + ':' + pad(p.mi); },
    date: function (ts) { return ts == null ? '-' : kstDate(ts); },
    dateKo: function (ts) { if (ts == null) return '-'; var p = kstParts(ts); return p.mo + '월 ' + p.d + '일 (' + DOW_KO[p.dow] + ')'; },
    dateTime: function (ts) { return ts == null ? '-' : kstDate(ts) + ' ' + fmt.time(ts); },
    iso: function (ts) { return ts == null ? null : isoKst(ts); },
    relative: function (ts, base) {
      if (ts == null) return '-';
      base = base == null ? clock.now : base;
      var d = base - ts, fut = d < 0; d = Math.abs(d);
      var t;
      if (d < 5 * SEC) return '방금';
      if (d < MIN) t = Math.round(d / SEC) + '초';
      else if (d < HOUR) t = Math.round(d / MIN) + '분';
      else if (d < DAY) t = Math.round(d / HOUR) + '시간';
      else t = Math.round(d / DAY) + '일';
      return t + (fut ? ' 후' : ' 전');
    },
    shortHash: function (h, n) { return h ? String(h).slice(0, n || 8) : '-'; }
  };

  // ───────────────────────────────────────────── config ──
  var PROJECT = DOMAIN.project.id, PROJECT_NUM = DOMAIN.project.number, REGION = DOMAIN.project.region;
  var BUCKET_IN = DOMAIN.buckets.input, BUCKET_ART = DOMAIN.buckets.artifacts, BUCKET_RES = DOMAIN.buckets.results;
  var BQ_TABLE = DOMAIN.bigquery.resultsTable;

  var LANGS = DOMAIN.languages;
  var LANG = {}; LANGS.forEach(function (l) { LANG[l.code] = l; });
  var LANG_CODES = LANGS.map(function (l) { return l.code; });

  var OPERATORS = [
    { id: 'op-kim-sy', name: '김서연', email: 'seoyeon.kim@bixby-eval.example', role: 'Admin', team: 'Platform Eng', lastActiveAt: BASE_NOW - 6 * MIN },
    { id: 'op-han-dy', name: '한도윤', email: 'doyoon.han@bixby-eval.example', role: 'Admin', team: 'Platform Eng', lastActiveAt: BASE_NOW - 2 * HOUR },
    { id: 'op-park-jh', name: '박지훈', email: 'jihoon.park@bixby-eval.example', role: 'Operator', team: 'Eval Ops', lastActiveAt: BASE_NOW - 3 * MIN },
    { id: 'op-lee-he', name: '이하은', email: 'haeun.lee@bixby-eval.example', role: 'Operator', team: 'Eval Ops', lastActiveAt: BASE_NOW - 41 * MIN },
    { id: 'op-jung-yn', name: '정유나', email: 'yuna.jung@bixby-eval.example', role: 'Operator', team: 'NLU Quality', lastActiveAt: BASE_NOW - 1 * DAY },
    { id: 'op-choi-mj', name: '최민준', email: 'minjun.choi@bixby-eval.example', role: 'Viewer', team: 'NLU Quality', lastActiveAt: BASE_NOW - 5 * HOUR },
    { id: 'op-sato-k', name: 'Kenji Sato', email: 'kenji.sato@bixby-eval.example', role: 'Viewer', team: 'JA Locale', lastActiveAt: BASE_NOW - 3 * DAY }
  ];
  var OP = {}; OPERATORS.forEach(function (o) { OP[o.id] = o; });
  var ROLE_PERMISSIONS = [
    { permission: '대시보드·로그 조회', key: 'read', Viewer: true, Operator: true, Admin: true },
    { permission: '결과 CSV 다운로드', key: 'export', Viewer: true, Operator: true, Admin: true },
    { permission: 'Workflow 취소', key: 'cancel', Viewer: false, Operator: true, Admin: true },
    { permission: 'DLQ Replay 요청', key: 'replay.request', Viewer: false, Operator: true, Admin: true },
    { permission: 'DLQ Replay 승인', key: 'replay.approve', Viewer: false, Operator: false, Admin: true },
    { permission: '언어 일시 중지/재개', key: 'language.pause', Viewer: false, Operator: true, Admin: true },
    { permission: 'Capacity·Retry·Timeout 변경', key: 'config.write', Viewer: false, Operator: false, Admin: true },
    { permission: 'Pipeline 버전 승격', key: 'version.promote', Viewer: false, Operator: false, Admin: true },
    { permission: '운영자 권한 관리', key: 'iam', Viewer: false, Operator: false, Admin: true }
  ];

  var PIPELINE_VERSIONS = DOMAIN.releases.map(function (r) {
    return { version: r.version, status: r.status, trafficPct: r.trafficPct, releasedAt: Date.parse(r.releasedAt), image: REGION + '-docker.pkg.dev/' + PROJECT + '/pipelines/bixby-eval:' + r.imageTag,
      templateUri: 'gs://' + BUCKET_ART + '/templates/bixby-eval-full/' + r.version + '.yaml', judgeModel: r.judgeModel, modelUnderTest: r.modelUnderTest, notes: r.notes };
  });
  var MODELS = DOMAIN.models.map(function (m) { return Object.assign({}, m, { releasedTs: Date.parse(m.releasedAt) }); });
  var MODEL_ADJ = {}; MODELS.forEach(function (m) { MODEL_ADJ[m.id] = m.passAdj; });
  function modelFor(created, rng) {
    var el = MODELS.filter(function (m) { return m.releasedTs <= created; });
    if (!el.length) return MODELS[0].id;
    var w = el.filter(function (m) { return m.weight > 0; });
    if (!w.length) return el[el.length - 1].id;
    return rng.weighted(w.map(function (m) { return [m.id, m.weight]; }));
  }

  var SERVICES = [
    { id: 'event-ingress', name: 'Event Ingress', runtime: 'Cloud Run', enabled: true, status: 'HEALTHY', version: '1.4.2', revision: 'event-ingress-00042-xaq', instances: 2, minInstances: 1, maxInstances: 20, region: REGION, serviceAccount: 'sa-event-ingress@' + PROJECT + '.iam.gserviceaccount.com', lastDeployAt: Date.parse('2026-11-10T16:12:00+09:00'), errorRate: 0.0011, p95LatencyMs: 184 },
    { id: 'scheduler', name: 'Language-aware Scheduler', runtime: 'Cloud Run', enabled: true, status: 'HEALTHY', version: '1.3.0', revision: 'scheduler-00031-mep', instances: 1, minInstances: 1, maxInstances: 1, region: REGION, serviceAccount: 'sa-scheduler@' + PROJECT + '.iam.gserviceaccount.com', lastDeployAt: Date.parse('2026-11-09T14:40:00+09:00'), errorRate: 0.0, p95LatencyMs: 92 },
    { id: 'dispatcher', name: 'Dispatcher', runtime: 'Cloud Run', enabled: true, status: 'HEALTHY', version: '1.3.0', revision: 'dispatcher-00028-tzw', instances: 1, minInstances: 1, maxInstances: 5, region: REGION, serviceAccount: 'sa-dispatcher@' + PROJECT + '.iam.gserviceaccount.com', lastDeployAt: Date.parse('2026-11-09T14:41:00+09:00'), errorRate: 0.0042, p95LatencyMs: 1310 },
    { id: 'reconciler', name: 'Reconciler', runtime: 'Cloud Run Job (every 2m)', enabled: true, status: 'DEGRADED', version: '1.2.1', revision: 'reconciler-00017-bbk', instances: 0, minInstances: 0, maxInstances: 1, region: REGION, serviceAccount: 'sa-reconciler@' + PROJECT + '.iam.gserviceaccount.com', lastDeployAt: Date.parse('2026-11-06T10:05:00+09:00'), errorRate: 0.083, p95LatencyMs: 8420, note: '최근 12회 중 1회 실패 (Firestore DEADLINE_EXCEEDED)' },
    { id: 'dlq-manager', name: 'DLQ Manager', runtime: 'Cloud Run', enabled: true, status: 'HEALTHY', version: '1.1.4', revision: 'dlq-manager-00012-pqa', instances: 1, minInstances: 0, maxInstances: 3, region: REGION, serviceAccount: 'sa-dlq-manager@' + PROJECT + '.iam.gserviceaccount.com', lastDeployAt: Date.parse('2026-11-04T18:20:00+09:00'), errorRate: 0.0, p95LatencyMs: 240 },
    { id: 'operations-api', name: 'Operations API', runtime: 'Cloud Run (FastAPI)', enabled: true, status: 'HEALTHY', version: '0.9.3', revision: 'operations-api-00057-kke', instances: 2, minInstances: 1, maxInstances: 10, region: REGION, serviceAccount: 'sa-operations-api@' + PROJECT + '.iam.gserviceaccount.com', lastDeployAt: Date.parse('2026-11-11T20:02:00+09:00'), errorRate: 0.0007, p95LatencyMs: 312 }
  ];

  var ALERT_POLICIES = [
    { id: 'ap-dlq-new', name: 'DLQ 신규 발생', metric: 'aipo/dead_letters/created', condition: 'count > 0 (1m)', severity: 'CRITICAL', channels: ['slack:#bixby-eval-ops', 'pagerduty:aipo-oncall'], enabled: true },
    { id: 'ap-backlog', name: '언어별 Backlog 임계치 초과', metric: 'aipo/queue/backlog', condition: 'backlog > language.backlogAlertThreshold (5m)', severity: 'WARNING', channels: ['slack:#bixby-eval-ops'], enabled: true },
    { id: 'ap-wait-p95', name: 'p95 대기 시간 초과', metric: 'aipo/queue/wait_seconds', condition: 'p95 > language.p95WaitSloSec (15m)', severity: 'WARNING', channels: ['slack:#bixby-eval-ops'], enabled: true },
    { id: 'ap-fail-rate', name: 'Workflow 실패율 증가', metric: 'aipo/workflows/failure_ratio', condition: 'ratio > 5% (30m)', severity: 'CRITICAL', channels: ['slack:#bixby-eval-ops', 'pagerduty:aipo-oncall'], enabled: true },
    { id: 'ap-timeout', name: 'Pipeline 실행 Timeout 증가', metric: 'aipo/pipelines/timeouts', condition: 'count > 2 (1h)', severity: 'WARNING', channels: ['slack:#bixby-eval-ops'], enabled: true },
    { id: 'ap-slot-mismatch', name: 'Capacity Slot 불일치', metric: 'aipo/capacity/slot_drift', condition: 'reservations(ACTIVE) != running pipelines (2 runs)', severity: 'WARNING', channels: ['slack:#bixby-eval-ops'], enabled: true },
    { id: 'ap-reconciler', name: 'Reconciler 실행 실패', metric: 'run.googleapis.com/job/completed_execution_count{result=failed}', condition: 'count > 0 (10m)', severity: 'WARNING', channels: ['slack:#bixby-eval-ops'], enabled: true },
    { id: 'ap-vertex-errors', name: 'Vertex AI API 오류율 증가', metric: 'serviceruntime.googleapis.com/api/request_count{service=aiplatform,response_code_class!=2xx}', condition: 'ratio > 2% (10m)', severity: 'CRITICAL', channels: ['slack:#bixby-eval-ops', 'pagerduty:aipo-oncall'], enabled: true }
  ];

  var config = {
    project: DOMAIN.project,
    languages: LANGS,
    global: DOMAIN.capacity.global,
    retry: { maxRetries: 2, maxAttempts: 3, backoffSeconds: [60, 300], nonRetryable: ['INPUT_SCHEMA', 'AUTH_PERMISSION'], limitedRetry: { CODE_DEFECT: 1 } },
    workflowTimeoutMin: 90,
    pipelineTimeoutMin: 60,
    reservationLeaseMin: 10,
    queuePolicy: { mode: 'PRIORITY_THEN_FIFO', aging: { enabled: true, boostPerMinutes: 10, maxBoost: 3 }, crossLanguage: 'WEIGHTED_ROUND_ROBIN' },
    pipelineVersions: PIPELINE_VERSIONS.map(function (v) { return v.version; }),
    pipelineVersionDetails: PIPELINE_VERSIONS,
    defaultPipelineVersion: DOMAIN.defaultRelease,
    services: SERVICES,
    alertPolicies: ALERT_POLICIES,
    operators: OPERATORS,
    rolePermissions: ROLE_PERMISSIONS,
    buckets: { input: BUCKET_IN, artifacts: BUCKET_ART, results: BUCKET_RES },
    bigquery: { dataset: PROJECT + '.bixby_eval', resultsTable: BQ_TABLE, eventsTable: PROJECT + '.aipo_ops.workflow_events' },
    terraformDefaults: DOMAIN.capacity.terraformDefaults,
    runtimeConfig: null, // filled below (flattened view of live values)
    drift: null          // function below
  };
  function flattenRuntime() {
    var o = {};
    LANGS.forEach(function (l) {
      o['languages.' + l.code + '.maxConcurrent'] = l.maxConcurrent;
      o['languages.' + l.code + '.maxStartsPerMinute'] = l.maxStartsPerMinute;
      o['languages.' + l.code + '.priorityWeight'] = l.priorityWeight;
    });
    o['global.maxConcurrent'] = config.global.maxConcurrent;
    o['global.maxStartsPerMinute'] = config.global.maxStartsPerMinute;
    o['retry.maxRetries'] = config.retry.maxRetries;
    o['retry.backoffSeconds'] = config.retry.backoffSeconds.slice();
    o.workflowTimeoutMin = config.workflowTimeoutMin;
    o.pipelineTimeoutMin = config.pipelineTimeoutMin;
    o.defaultPipelineVersion = config.defaultPipelineVersion;
    return o;
  }
  var DRIFT_NOTES = {
    'languages.ko.maxConcurrent': { changedBy: 'op-kim-sy', changedAt: Date.parse('2026-11-10T09:12:00+09:00'), reason: '한국어 실발화 유입량 증가 대응 (8→10)' },
    'languages.en.maxStartsPerMinute': { changedBy: 'op-han-dy', changedAt: Date.parse('2026-11-10T05:40:00+09:00'), reason: 'Vertex AI GPU 할당량 장애(INC-20261110-01) 중 시작률 제한 (10→8)' },
    'global.maxConcurrent': { changedBy: 'op-kim-sy', changedAt: Date.parse('2026-11-10T09:13:00+09:00'), reason: 'ko 증설에 맞춰 Global 확장 (32→36)' },
    'workflowTimeoutMin': { changedBy: 'op-han-dy', changedAt: Date.parse('2026-11-08T13:30:00+09:00'), reason: 'en 대형 배치(200건) LLM Judge 지연으로 Workflow timeout 상향 (60→90)' }
  };
  function noteDrift(keys, by, reason) {
    keys.forEach(function (k) { DRIFT_NOTES[k] = { changedBy: by, changedAt: clock.now, reason: reason || null }; });
  }
  config.drift = function () {
    var rt = flattenRuntime(), out = [];
    Object.keys(config.terraformDefaults).forEach(function (k) {
      var a = JSON.stringify(config.terraformDefaults[k]), b = JSON.stringify(rt[k]);
      if (a !== b) {
        var n = DRIFT_NOTES[k] || {};
        out.push({ key: k, terraform: config.terraformDefaults[k], runtime: rt[k], changedBy: n.changedBy || null, changedAt: n.changedAt || null, reason: n.reason || null });
      }
    });
    return out;
  };
  config.runtimeConfig = flattenRuntime();

  // ───────────────────────────────────────────── stages ──
  var STAGES = DOMAIN.stages;
  var STAGE = {}; STAGES.forEach(function (s) { STAGE[s.id] = s; });
  var STAGE_EDGES = DOMAIN.stageEdges;
  var STATE_TO_STAGE = {
    RECEIVED: 'ingress', VALIDATED: 'ingress', QUEUED: 'registry_queue', RESERVED: 'scheduler', DISPATCHING: 'workflows',
    RUNNING: 'vertex', RETRY_WAIT: 'retry', SUCCEEDED: 'results', DEAD_LETTERED: 'dlq', CANCELLED: 'workflows', TIMED_OUT: 'workflows'
  };
  var STATES = Object.keys(STATE_TO_STAGE);
  var ACTIVE_STATES = ['RESERVED', 'DISPATCHING', 'RUNNING'];
  var TERMINAL_STATES = ['SUCCEEDED', 'DEAD_LETTERED', 'CANCELLED', 'TIMED_OUT'];

  // ───────────────────────────────────────────── meta maps ──
  var statusMeta = {
    RECEIVED: { label: '수신됨', labelEn: 'Received', tone: 'queued', icon: 'inbox', terminal: false, order: 1 },
    VALIDATED: { label: '검증 완료', labelEn: 'Validated', tone: 'queued', icon: 'shield-check', terminal: false, order: 2 },
    QUEUED: { label: '대기 중', labelEn: 'Queued', tone: 'queued', icon: 'clock', terminal: false, order: 3 },
    RESERVED: { label: '슬롯 확보', labelEn: 'Reserved', tone: 'queued', icon: 'lock', terminal: false, order: 4 },
    DISPATCHING: { label: '실행 요청 중', labelEn: 'Dispatching', tone: 'running', icon: 'send', terminal: false, order: 5 },
    RUNNING: { label: '실행 중', labelEn: 'Running', tone: 'running', icon: 'loader', terminal: false, order: 6 },
    RETRY_WAIT: { label: '재시도 대기', labelEn: 'Retry wait', tone: 'retry', icon: 'rotate-ccw', terminal: false, order: 7 },
    SUCCEEDED: { label: '성공', labelEn: 'Succeeded', tone: 'success', icon: 'check-circle', terminal: true, order: 8 },
    DEAD_LETTERED: { label: 'DLQ 격리', labelEn: 'Dead-lettered', tone: 'dlq', icon: 'archive-x', terminal: true, order: 9 },
    CANCELLED: { label: '취소됨', labelEn: 'Cancelled', tone: 'cancelled', icon: 'x-circle', terminal: true, order: 10 },
    TIMED_OUT: { label: '시간 초과', labelEn: 'Timed out', tone: 'failed', icon: 'timer-off', terminal: true, order: 11 }
  };
  var nodeStatusMeta = {
    PENDING: { label: '대기', tone: 'queued', icon: 'circle-dashed' },
    RUNNING: { label: '실행 중', tone: 'running', icon: 'loader' },
    SUCCEEDED: { label: '성공', tone: 'success', icon: 'check-circle' },
    FAILED: { label: '실패', tone: 'failed', icon: 'x-octagon' },
    SKIPPED: { label: '스킵', tone: 'cancelled', icon: 'skip-forward' },
    CANCELLED: { label: '취소', tone: 'cancelled', icon: 'ban' }
  };
  var attemptStatusMeta = {
    DISPATCHING: { label: '생성 중', tone: 'running', icon: 'send' },
    RUNNING: { label: '실행 중', tone: 'running', icon: 'loader' },
    SUCCEEDED: { label: '성공', tone: 'success', icon: 'check-circle' },
    FAILED: { label: '실패', tone: 'failed', icon: 'x-octagon' },
    TIMED_OUT: { label: '시간 초과', tone: 'failed', icon: 'timer-off' },
    CANCELLED: { label: '취소', tone: 'cancelled', icon: 'ban' }
  };
  var dlqStatusMeta = {
    PENDING_REVIEW: { label: '검토 대기', tone: 'dlq', icon: 'eye' },
    APPROVED: { label: 'Replay 승인', tone: 'queued', icon: 'check' },
    REPLAYING: { label: 'Replay 중', tone: 'running', icon: 'refresh-cw' },
    REPLAYED: { label: 'Replay 완료', tone: 'success', icon: 'check-circle' },
    CLOSED: { label: '종료 처리', tone: 'cancelled', icon: 'archive' }
  };
  var severityMeta = {
    DEBUG: { label: 'DEBUG', tone: 'cancelled' }, INFO: { label: 'INFO', tone: 'queued' }, NOTICE: { label: 'NOTICE', tone: 'queued' },
    WARNING: { label: 'WARNING', tone: 'retry' }, ERROR: { label: 'ERROR', tone: 'failed' }, CRITICAL: { label: 'CRITICAL', tone: 'dlq' }
  };
  var failureCategoryMeta = {
    PIPELINE_EXECUTION: { label: 'Pipeline 실행 오류', policy: 'Retry', retryable: true, icon: 'alert-triangle' },
    MODEL_TRANSIENT: { label: '모델 일시적 오류', policy: '정책에 따라 Retry', retryable: true, icon: 'cloud-lightning' },
    QUOTA: { label: 'Vertex AI 할당량', policy: 'Backoff 후 Retry', retryable: true, icon: 'battery-warning' },
    TIMEOUT: { label: '실행 시간 초과', policy: '취소 확인 후 Retry 여부 판정', retryable: true, icon: 'timer-off' },
    INPUT_SCHEMA: { label: '입력 스키마 오류', policy: '즉시 DLQ', retryable: false, icon: 'file-warning' },
    AUTH_PERMISSION: { label: '인증·권한 오류', policy: '재시도 중단, 운영자 알림', retryable: false, icon: 'key-round' },
    CODE_DEFECT: { label: 'Pipeline 코드 결함', policy: '제한적 Retry (1회)', retryable: true, maxRetries: 1, icon: 'bug' }
  };
  var failureReasonMeta = {
    INTENT_MISMATCH: { label: '의도 불일치', tone: 'failed' },
    SLOT_ERROR: { label: 'Slot 오류', tone: 'failed' },
    RESPONSE_QUALITY: { label: '응답 품질', tone: 'retry' },
    TIMEOUT: { label: '응답 시간 초과', tone: 'retry' },
    ASR_ERROR: { label: 'ASR 인식 오류', tone: 'queued' },
    POLICY_VIOLATION: { label: '정책 위반', tone: 'dlq' }
  };

  // ───────────────────────────────────────────── event catalog ──
  var EVENT_CATALOG = {
    GCS_OBJECT_FINALIZED: { stage: 'gcs_input', source: 'cloud-storage', label: 'GCS 객체 업로드 완료' },
    EVENT_PUBLISHED: { stage: 'event_bus', source: 'eventarc', label: 'CloudEvent 전달' },
    EVENT_RECEIVED: { stage: 'ingress', source: 'event-ingress', label: '이벤트 수신' },
    DUPLICATE_EVENT_IGNORED: { stage: 'ingress', source: 'event-ingress', label: '중복 이벤트 무시' },
    VALIDATION_COMPLETED: { stage: 'ingress', source: 'event-ingress', label: '검증 완료' },
    QUEUED: { stage: 'registry_queue', source: 'scheduler', label: '대기열 등록' },
    CAPACITY_RESERVED: { stage: 'scheduler', source: 'scheduler', label: 'Capacity Slot 확보' },
    CAPACITY_RELEASED: { stage: 'scheduler', source: 'scheduler', label: 'Capacity Slot 반환' },
    WORKFLOW_STARTED: { stage: 'workflows', source: 'cloud-workflows', label: 'Workflow 실행 시작' },
    PIPELINE_SUBMITTED: { stage: 'workflows', source: 'dispatcher', label: 'PipelineJob 생성 요청' },
    PIPELINE_STARTED: { stage: 'vertex', source: 'vertex-ai', label: 'Pipeline 시작' },
    TASK_PREPROCESS_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '전처리 시작' },
    TASK_PREPROCESS_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: '전처리 완료' },
    TASK_PREPROCESS_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '전처리 실패' },
    TASK_INTENT_EVAL_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '의도 평가 시작' },
    TASK_INTENT_EVAL_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: '의도 평가 완료' },
    TASK_INTENT_EVAL_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '의도 평가 실패' },
    TASK_RESPONSE_EVAL_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '응답 평가 시작' },
    TASK_RESPONSE_EVAL_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: '응답 평가 완료' },
    TASK_RESPONSE_EVAL_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '응답 평가 실패' },
    TASK_LATENCY_CHECK_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '지연 측정 시작' },
    TASK_LATENCY_CHECK_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: '지연 측정 완료' },
    TASK_LATENCY_CHECK_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '지연 측정 실패' },
    TASK_EVALUATION_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: 'Agent 평가 단계 완료' },
    TASK_AGGREGATION_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '집계 시작' },
    TASK_AGGREGATION_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: '집계 완료' },
    TASK_AGGREGATION_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '집계 실패' },
    TASK_PERSIST_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '결과 저장 시작' },
    TASK_PERSIST_COMPLETED: { stage: 'vertex', source: 'vertex-ai', label: '결과 저장 완료' },
    TASK_PERSIST_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '결과 저장 실패' },
    PIPELINE_SUCCEEDED: { stage: 'vertex', source: 'vertex-ai', label: 'Pipeline 성공' },
    PIPELINE_FAILED: { stage: 'vertex', source: 'vertex-ai', label: 'Pipeline 실패' },
    PIPELINE_TIMEOUT: { stage: 'workflows', source: 'cloud-workflows', label: 'Pipeline 실행 시간 초과' },
    PIPELINE_CANCEL_CONFIRMED: { stage: 'workflows', source: 'cloud-workflows', label: 'Pipeline 종료 확인' },
    RESULT_COMMITTED: { stage: 'results', source: 'result-commit', label: '결과 CSV 업로드' },
    BIGQUERY_COMMITTED: { stage: 'results', source: 'result-commit', label: 'BigQuery Commit' },
    WORKFLOW_COMPLETED: { stage: 'results', source: 'cloud-workflows', label: '완료 이벤트 발행' },
    RETRY_SCHEDULED: { stage: 'retry', source: 'cloud-workflows', label: '재시도 예약' },
    RETRY_STARTED: { stage: 'retry', source: 'cloud-workflows', label: '재시도 시작' },
    DEAD_LETTER_PUBLISHED: { stage: 'dlq', source: 'dlq-manager', label: 'DLQ 발행' },
    REPLAY_REQUESTED: { stage: 'dlq', source: 'operations-api', label: 'Replay 요청' },
    REPLAY_APPROVED: { stage: 'dlq', source: 'operations-api', label: 'Replay 승인' },
    DEAD_LETTER_CLOSED: { stage: 'dlq', source: 'operations-api', label: 'DLQ 종료 처리' },
    CANCEL_REQUESTED: { stage: 'workflows', source: 'operations-api', label: '취소 요청' },
    WORKFLOW_CANCELLED: { stage: 'workflows', source: 'cloud-workflows', label: 'Workflow 취소' },
    WORKFLOW_TIMED_OUT: { stage: 'workflows', source: 'cloud-workflows', label: 'Workflow 시간 초과' },
    CONFIG_UPDATED: { stage: 'scheduler', source: 'operations-api', label: '운영 설정 변경' },
    SLOT_RECONCILED: { stage: 'scheduler', source: 'reconciler', label: 'Slot 정합성 복구' },
    CHILD_PIPELINE_STARTED: { stage: 'vertex', source: 'vertex-ai', label: '하위 Pipeline 시작' },
    CHILD_PIPELINE_SUCCEEDED: { stage: 'vertex', source: 'vertex-ai', label: '하위 Pipeline 성공' },
    CHILD_PIPELINE_FAILED: { stage: 'vertex', source: 'vertex-ai', label: '하위 Pipeline 실패' },
    CHILD_PIPELINE_CANCELLED: { stage: 'vertex', source: 'vertex-ai', label: '하위 Pipeline 취소' }
  };
  Object.keys(DOMAIN.components).forEach(function (id) {
    var c = DOMAIN.components[id];
    [['STARTED', '시작'], ['COMPLETED', '완료'], ['FAILED', '실패']].forEach(function (x) {
      var k = 'TASK_' + c.ev + '_' + x[0];
      if (!EVENT_CATALOG[k]) EVENT_CATALOG[k] = { stage: 'vertex', source: 'vertex-ai', label: c.labelKo + ' ' + x[1] };
    });
  });

  // ───────────────────────────────────────────── DAG template ──
  var DAG_TEMPLATE = [
    { id: 'preprocess', label: 'Preprocess', labelKo: '전처리', ev: 'PREPROCESS', deps: [], f: [0.06, 0.17], machineType: 'n2-standard-4', cpu: 4, gpu: null, memGb: 16, image: 'components/preprocess', description: 'JSONL 파싱, 스키마 검증, 정규화, PII 마스킹, capsule 힌트 매핑' },
    { id: 'intent_eval', label: 'Intent Eval', labelKo: '의도 평가', ev: 'INTENT_EVAL', deps: ['preprocess'], f: [0.17, 0.50], machineType: 'n2-standard-8', cpu: 8, gpu: null, memGb: 32, image: 'components/intent-eval', description: 'Bixby Agent에 발화를 재생하여 intent/slot 예측과 기대값 비교' },
    { id: 'response_eval', label: 'Response Eval (LLM Judge)', labelKo: '응답 평가 (LLM Judge)', ev: 'RESPONSE_EVAL', deps: ['preprocess'], f: [0.17, 0.80], machineType: 'g2-standard-8', cpu: 8, gpu: { type: 'NVIDIA_L4', count: 1 }, memGb: 32, image: 'components/response-eval', description: 'LLM Judge가 기대 응답 대비 실제 응답의 정확성·유용성·정책 준수를 0~1로 채점' },
    { id: 'latency_check', label: 'Latency Check', labelKo: '지연 측정', ev: 'LATENCY_CHECK', deps: ['preprocess'], f: [0.17, 0.34], machineType: 'e2-standard-4', cpu: 4, gpu: null, memGb: 16, image: 'components/latency-check', description: '발화별 end-to-end 응답 지연 측정 및 8,000ms 초과 판정' },
    { id: 'aggregate', label: 'Aggregate', labelKo: '결과 집계', ev: 'AGGREGATION', deps: ['intent_eval', 'response_eval', 'latency_check'], f: [0.80, 0.91], machineType: 'n2-standard-4', cpu: 4, gpu: null, memGb: 16, image: 'components/aggregate', description: '발화별 PASS/FAIL 판정, failure_reason 분류, capsule/디바이스별 요약' },
    { id: 'persist', label: 'Persist', labelKo: '결과 저장', ev: 'PERSIST', deps: ['aggregate'], f: [0.91, 0.98], machineType: 'e2-standard-2', cpu: 2, gpu: null, memGb: 8, image: 'components/persist', description: 'results.csv를 GCS에 업로드하고 BigQuery utterance_results에 적재' }
  ];
  var DAG_IDX = {}; DAG_TEMPLATE.forEach(function (n, i) { DAG_IDX[n.id] = i; });

  // ───────────────────────────────────────────── error catalog ──
  var ERRORS = {
    PIPELINE_EXECUTION: [
      { code: 'PII_SCANNER_CRASH', components: ['pii_scan'], frac: [0.3, 0.7], message: 'pii_scan worker exited with code 139 (SIGSEGV) in presidio analyzer at row {line}.',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/pii_scan/main.py", line 64, in <module>\n    main()\n  File "/opt/pipeline/components/pii_scan/scan.py", line 102, in scan_rows\n    findings = analyzer.analyze(text=row.actual_response, language=lang)\n[kubelet] Container pii-scan terminated: Error (exit code 139)' },
      { code: 'COMPONENT_OOM', components: ['intent_classify', 'noise_robustness', 'slot_fill'], frac: [0.4, 0.8], message: 'The replica workerpool0-0 exited with a non-zero status of 137 (OOMKilled). Memory limit 32Gi exceeded.',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/intent_eval/main.py", line 211, in <module>\n    main()\n  File "/opt/pipeline/components/intent_eval/main.py", line 188, in main\n    preds = runner.replay_batch(utterances, concurrency=args.concurrency)\n  File "/opt/pipeline/components/intent_eval/runner.py", line 94, in replay_batch\n    results.extend(self._collect(futures))\n  File "/opt/pipeline/components/intent_eval/runner.py", line 131, in _collect\n    payload = json.loads(f.result().content)\nMemoryError\n[kubelet] Container intent-eval terminated: OOMKilled (exit code 137)' },
      { code: 'PIPELINE_FAILED', components: ['aggregate', 'compare_baseline'], frac: [0.3, 0.7], message: 'Task aggregate failed: upstream artifact intent_predictions.jsonl row count mismatch (expected {n}, got {m}).',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/aggregate/main.py", line 142, in <module>\n    main()\n  File "/opt/pipeline/components/aggregate/main.py", line 101, in main\n    df = join_artifacts(intent_df, judge_df, latency_df)\n  File "/opt/pipeline/components/aggregate/join.py", line 48, in join_artifacts\n    raise RowCountMismatch(f"expected {len(intent_df)}, got {len(judge_df)}")\naggregate.errors.RowCountMismatch: expected {n}, got {m}' }
    ],
    MODEL_TRANSIENT: [
      { code: 'SAFETY_CLASSIFIER_UNAVAILABLE', components: ['toxicity'], frac: [0.2, 0.8], message: '503 from safety-classifier endpoint (policy-guard/toxicity) after 3 retries.',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/toxicity/main.py", line 88, in <module>\n    main()\n  File "/opt/pipeline/components/toxicity/classify.py", line 41, in classify_batch\n    resp = client.predict(instances=batch)\ngoogle.api_core.exceptions.ServiceUnavailable: 503 safety-classifier endpoint unavailable' },
      { code: 'LLM_JUDGE_UNAVAILABLE', components: ['llm_judge', 'toxicity', 'mos_predict'], frac: [0.25, 0.85], message: '503 ServiceUnavailable from judge endpoint (gemini) after 5 client retries.',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/response_eval/main.py", line 176, in <module>\n    main()\n  File "/opt/pipeline/components/response_eval/main.py", line 152, in main\n    scores = judge.score_batch(pairs, rubric=RUBRIC_V3)\n  File "/opt/pipeline/components/response_eval/judge.py", line 88, in score_batch\n    resp = self._client.generate_content(prompt, generation_config=self._cfg)\n  File "/usr/local/lib/python3.11/site-packages/google/api_core/retry/retry_unary.py", line 293, in retry_wrapped_func\n    return retry_target(\ngoogle.api_core.exceptions.ServiceUnavailable: 503 The model is overloaded. Please try again later.' },
      { code: 'BIXBY_AGENT_5XX', components: ['intent_classify', 'slot_fill'], frac: [0.2, 0.7], message: 'Bixby Agent staging endpoint returned HTTP 502 for 37% of requests in 60s window (threshold 20%).',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/intent_eval/runner.py", line 131, in _collect\n    payload = json.loads(f.result().content)\n  File "/opt/pipeline/components/intent_eval/client.py", line 57, in post\n    resp.raise_for_status()\n  File "/usr/local/lib/python3.11/site-packages/httpx/_models.py", line 763, in raise_for_status\n    raise HTTPStatusError(message, request=request, response=self)\nhttpx.HTTPStatusError: Server error \'502 Bad Gateway\' for url \'https://agent-staging.bixby.internal/v3/understand\'' }
    ],
    QUOTA: [
      { code: 'VERTEX_QUOTA_EXCEEDED', components: ['llm_judge', 'toxicity', 'noise_robustness', 'mos_predict', 'tts_synthesize'], frac: [0.0, 0.04], message: 'Quota exceeded for aiplatform.googleapis.com/custom_model_training_nvidia_l4_gpus in region ' + REGION + ' (limit 16, requested 1, in use 16).',
        trace: 'google.api_core.exceptions.ResourceExhausted: 429 The following quota metrics exceed quota limits: aiplatform.googleapis.com/custom_model_training_nvidia_l4_gpus\n  at PipelineJob task response-eval (CustomJob projects/' + PROJECT_NUM + '/locations/' + REGION + '/customJobs/{job})' }
    ],
    TIMEOUT: [
      { code: 'COMPONENT_HEARTBEAT_TIMEOUT', components: ['llm_judge', 'mos_predict', 'intent_classify'], frac: [0.5, 0.9], message: 'No heartbeat from task {component} for 900s; task marked failed by orchestrator.',
        trace: 'pipeline-orchestrator: task {component} heartbeat stale (last=900s ago, limit=900s)\n  workflow step: monitor_pipeline -> check_heartbeat -> raise HeartbeatTimeout' }
    ],
    INPUT_SCHEMA: [
      { code: 'INPUT_SCHEMA_INVALID', components: ['preprocess'], frac: [0.1, 0.35], message: "JSONL line {line}: 'expected_intent' is a required property (schema bixby-utterance/2.3).",
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/preprocess/main.py", line 77, in <module>\n    main()\n  File "/opt/pipeline/components/preprocess/main.py", line 59, in main\n    for rec in validate_stream(reader, SCHEMA_V2_3):\n  File "/opt/pipeline/components/preprocess/validate.py", line 33, in validate_stream\n    raise InputSchemaError(line_no, err.message) from err\npreprocess.errors.InputSchemaError: line {line}: \'expected_intent\' is a required property' }
    ],
    AUTH_PERMISSION: [
      { code: 'PERMISSION_DENIED', components: ['preprocess'], frac: [0.01, 0.05], message: "403 Permission 'storage.objects.get' denied on resource gs://" + BUCKET_IN + "/... for sa-vertex-pipeline@" + PROJECT + '.iam.gserviceaccount.com.',
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/preprocess/io.py", line 21, in open_input\n    blob.download_to_filename(local_path)\n  File "/usr/local/lib/python3.11/site-packages/google/cloud/storage/blob.py", line 1304, in download_to_filename\n    self._handle_filename_and_download(\ngoogle.api_core.exceptions.Forbidden: 403 GET https://storage.googleapis.com/download/storage/v1/b/' + BUCKET_IN + '/o/...: sa-vertex-pipeline@' + PROJECT + ".iam.gserviceaccount.com does not have storage.objects.get access to the Google Cloud Storage object. Permission 'storage.objects.get' denied on resource (or it may not exist)." }
    ],
    CODE_DEFECT: [
      { code: 'COMPONENT_CODE_ERROR', components: ['aggregate', 'compare_baseline'], frac: [0.2, 0.6], message: "KeyError: 'smartthings.scene_run' — capsule weight map missing new intent.",
        trace: 'Traceback (most recent call last):\n  File "/opt/pipeline/components/aggregate/main.py", line 142, in <module>\n    main()\n  File "/opt/pipeline/components/aggregate/main.py", line 118, in main\n    summary = build_summary(df, capsule_map)\n  File "/opt/pipeline/components/aggregate/summary.py", line 57, in build_summary\n    weight = capsule_map[row.intent]["weight"]\nKeyError: \'smartthings.scene_run\'' }
    ]
  };
  var CATEGORY_SERVICE = { QUOTA: 'vertex-ai', AUTH_PERMISSION: 'vertex-ai' };

  // ───────────────────────────────────────────── utterance content ──
  var CAPSULES = DOMAIN.capsules;
  var CAP = {}; CAPSULES.forEach(function (c) { CAP[c.id] = c; });
  var DEVICES = DOMAIN.devices;
  var DEV = {}; DEVICES.forEach(function (d) { DEV[d.id] = d; });
  var LANG_BASE_PASS = {}; LANGS.forEach(function (l) { LANG_BASE_PASS[l.code] = l.basePass; });
  var VERSION_ADJ = {}; DOMAIN.releases.forEach(function (r) { VERSION_ADJ[r.version] = r.passAdj; });
  var VERSION_CAPSULE_ADJ = { 'v1.2-rc': { device_control: -0.13, general_qa: 0.03 } }; // rc regresses on SmartThings slot parser

  var SLOTS = {
    ko: { city: ['서울', '부산', '제주', '대구', '인천', '강릉', '광주'], deg: ['12', '15', '8', '18', '3', '-2'], time: ['오전 6시 30분', '오전 7시', '내일 아침 8시', '오후 3시', '밤 11시'], min: ['3', '5', '10', '15', '20'],
      artist: ['아이유', '뉴진스', '방탄소년단', '임영웅', '악뮤', '데이식스'], genre: ['잔잔한 재즈', '신나는 댄스곡', '공부할 때 듣는 로파이', '90년대 발라드', '운동할 때 듣는 노래'],
      device: ['거실 조명', '안방 에어컨', '로봇청소기', '공기청정기', '거실 TV', '제습기'], temp2: ['22', '24', '26', '20'], contact: ['엄마', '김민수 팀장님', '지현이', '아빠', '민지'],
      day: ['내일', '금요일', '다음 주 월요일', '모레'], event: ['팀 회의', '치과 예약', '엄마 생신 저녁', '주간 보고', 'PT 수업'], place: ['강남역', '김포공항', '서울역', '회사', '판교역'],
      poi: ['주유소', '약국', '편의점', '카페', '전기차 충전소'], min2: ['18', '25', '32', '41', '12'], pct: ['30', '50', '70', '80', '45'],
      usd: [{ n: '50', won: '69,250' }, { n: '100', won: '138,500' }, { n: '20', won: '27,700' }] },
    en: { city: ['Seattle', 'Austin', 'London', 'Chicago', 'Denver', 'Toronto'], degf: ['54', '61', '72', '45', '38'], time: ['6:30 AM', '7 AM', '5:45 AM', '3 PM', '10 PM'], min: ['3', '5', '10', '15', '20'],
      artist: ['Taylor Swift', 'Coldplay', 'Olivia Rodrigo', 'The Weeknd', 'Billie Eilish'], genre: ['lo-fi beats', 'classic rock', 'chill jazz', 'workout music', '80s hits'],
      device: ['living room lights', 'bedroom AC', 'robot vacuum', 'air purifier', 'porch light'], tempf: ['68', '70', '72', '74'], contact: ['Mom', 'Alex', 'Dr. Patel', 'Sarah', 'Jordan'],
      day: ['tomorrow', 'on Friday', 'next Monday'], event: ['team sync', 'dentist appointment', "Mom's birthday dinner", '1:1 with Priya'], place: ['JFK Airport', 'Whole Foods', 'downtown', 'the office'],
      poi: ['gas station', 'pharmacy', 'coffee shop', 'EV charger'], min2: ['18', '25', '32', '41', '12'], pct: ['30', '50', '70', '80', '45'],
      mi: [{ n: '5', km: '8' }, { n: '10', km: '16' }, { n: '26.2', km: '42.2' }] },
    ja: { city: ['東京', '大阪', '札幌', '福岡', '京都'], deg: ['14', '9', '18', '21', '5'], time: ['朝6時半', '7時', '明日の朝8時', '午後3時'], min: ['3', '5', '10', '15'],
      artist: ['YOASOBI', '米津玄師', 'Official髭男dism', 'Ado', 'あいみょん'], genre: ['ジャズ', 'J-POP', '作業用BGM', '90年代の曲'],
      device: ['リビングの電気', '寝室のエアコン', 'ロボット掃除機', '空気清浄機'], temp2: ['22', '24', '26', '20'], contact: ['お母さん', '田中さん', 'ゆうき', '会社'],
      day: ['明日', '金曜日', '来週の月曜日'], event: ['定例会議', '歯医者', '飲み会'], place: ['渋谷駅', '羽田空港', '東京駅', '会社'], poi: ['コンビニ', '薬局', 'カフェ', 'ガソリンスタンド'],
      min2: ['18', '25', '32', '12'], pct: ['30', '50', '70', '80'] },
    es: { city: ['Madrid', 'Barcelona', 'Sevilla', 'Ciudad de México', 'Valencia'], deg: ['16', '21', '9', '24', '12'], time: ['6:30', '7:00', '8:15', '15:00'], min: ['3', '5', '10', '15'],
      artist: ['Bad Bunny', 'Rosalía', 'Shakira', 'Karol G', 'Aitana'], genre: ['reguetón', 'jazz tranquilo', 'música para entrenar', 'pop en español'],
      device: ['las luces del salón', 'el aire acondicionado', 'la aspiradora robot', 'el purificador'], temp2: ['22', '24', '26', '20'], contact: ['mamá', 'Carlos', 'Lucía', 'la oficina'],
      day: ['mañana', 'el viernes', 'el lunes que viene'], event: ['la reunión de equipo', 'el dentista', 'la cena de cumpleaños'], place: ['la estación de Atocha', 'el aeropuerto', 'casa', 'la oficina'],
      poi: ['farmacia', 'gasolinera', 'cafetería'], min2: ['18', '25', '32', '12'], pct: ['30', '50', '70', '80'] }
  };

  // [intent, utterance, expected_response]
  var TPL = {
    ko: {
      weather: [['weather.current', '{city} 날씨 어때?', '현재 {city}는 맑고 기온은 {deg}도예요.'], ['weather.rain_check', '빅스비 내일 우산 챙겨야 돼?', '내일 {city}는 오후부터 비 소식이 있어요. 우산을 챙기세요.'], ['weather.forecast', '이번 주말 {city} 날씨 알려줘', '이번 주말 {city}는 토요일 맑음, 일요일은 구름 많고 최고 {deg}도예요.'], ['weather.air_quality', '지금 밖에 미세먼지 심해?', '현재 {city}의 미세먼지는 보통 수준이에요.'], ['weather.forecast', '내일 아침 {city} 몇 도야', '내일 아침 {city}는 최저 {deg}도로 쌀쌀하겠어요.']],
      alarm_timer: [['alarm.create', '{time}에 알람 맞춰줘', '{time}에 알람을 맞췄어요.'], ['timer.start', '어.. {min}분 타이머', '{min}분 타이머를 시작할게요.'], ['alarm.delete', '내일 알람 다 꺼줘', '내일 설정된 알람 3개를 모두 껐어요.'], ['timer.start', '라면 {min}분 타이머 좀', '{min}분 타이머를 시작했어요. 맛있게 드세요!'], ['alarm.create', '평일마다 {time} 알람 설정해줘', '평일 {time}에 반복 알람을 설정했어요.']],
      music: [['music.play_artist', '{artist} 노래 틀어줘', '{artist}의 인기곡을 재생할게요.'], ['music.play_artist', '아 그 {artist} 노래 아무거나 틀어봐', '{artist}의 노래를 랜덤으로 재생할게요.'], ['music.play_genre', '{genre} 틀어줘', '{genre} 플레이리스트를 재생할게요.'], ['music.control', '다음 곡', '다음 곡을 재생할게요.'], ['music.control', '볼륨 좀 줄여줘', '볼륨을 낮췄어요.']],
      device_control: [['smartthings.device_off', '{device} 좀 꺼줄래', '{device} 전원을 껐어요.'], ['smartthings.device_on', '{device} 켜줘', '{device} 전원을 켰어요.'], ['smartthings.set_temperature', '에어컨 {temp2}도로 맞춰줘', '거실 에어컨을 {temp2}도로 설정했어요.'], ['smartthings.scene_run', '외출 모드 실행해줘', '외출 모드를 실행했어요. 조명 4개와 에어컨을 껐어요.'], ['smartthings.device_status', '{device} 지금 켜져 있어?', '{device}는 현재 켜져 있어요.']],
      call_message: [['call.dial', '{contact}한테 전화 걸어줘', '{contact}에게 전화를 걸게요.'], ['message.send', '{contact}한테 나 좀 늦는다고 문자 보내줘', '{contact}에게 "나 좀 늦어"라고 보낼까요?'], ['message.read', '새 메시지 읽어줘', '새 메시지가 2개 있어요. 첫 번째는 {contact}님이 보냈어요.'], ['call.video', '{contact} 영상통화', '{contact}에게 영상통화를 걸게요.']],
      calendar: [['calendar.create_event', '{day} 오후 2시에 {event} 일정 추가해줘', '{day} 오후 2시에 {event} 일정을 추가했어요.'], ['calendar.query', '{day} 일정 뭐 있어?', '{day}에는 {event} 일정이 1개 있어요.'], ['calendar.query', '오늘 남은 일정 알려줘', '오늘은 오후 4시에 {event} 일정이 남아 있어요.'], ['reminder.create', '{day} 아침에 {event} 리마인드 해줘', '{day} 아침 9시에 {event} 리마인더를 설정했어요.']],
      navigation: [['navigation.route', '{place} 가는 길 알려줘', '{place}까지 경로를 안내할게요. 예상 소요 시간은 {min2}분이에요.'], ['navigation.nearby', '근처 {poi} 찾아줘', '가까운 {poi} 3곳을 찾았어요.'], ['navigation.eta', '{place}까지 얼마나 걸려?', '지금 출발하면 {place}까지 약 {min2}분 걸려요.'], ['navigation.traffic', '집에 가는 길 막혀?', '집까지 가는 길은 현재 약간 정체 중이며 약 {min2}분 걸려요.']],
      settings: [['settings.toggle', '와이파이 꺼줘', 'Wi-Fi를 껐어요.'], ['settings.brightness', '화면 밝기 {pct}%로 해줘', '화면 밝기를 {pct}%로 설정했어요.'], ['settings.toggle', '방해금지 모드 켜줘', '방해 금지 모드를 켰어요.'], ['settings.battery', '배터리 얼마나 남았어?', '배터리가 {pct}% 남았어요.']],
      general_qa: [['qa.factoid', '에베레스트 높이가 얼마야', '에베레스트산의 높이는 약 8,849미터예요.'], ['qa.unit_convert', '{n}달러면 한국 돈으로 얼마야', '오늘 환율 기준으로 {n}달러는 약 {won}원이에요.'], ['qa.factoid', '이순신 장군 언제 태어났어?', '이순신 장군은 1545년에 태어났어요.'], ['qa.chitchat', '심심한데 재밌는 얘기 해줘', '문어는 심장이 세 개나 있대요. 신기하죠?'], ['qa.factoid', '오늘 무슨 요일이야', '오늘은 11월 12일 목요일이에요.']]
    },
    en: {
      weather: [['weather.current', "what's the weather like in {city}", "It's currently {degf}°F and sunny in {city}."], ['weather.rain_check', 'do I need an umbrella tomorrow', "Yes, there's a 70% chance of rain in {city} tomorrow afternoon."], ['weather.forecast', 'weather for this weekend', 'This weekend in {city}: sunny Saturday, cloudy Sunday with a high of {degf}°F.'], ['weather.current', 'hey bixby is it cold outside', "It's {degf}°F in {city} right now, so grab a jacket."]],
      alarm_timer: [['alarm.create', 'set an alarm for {time}', 'Your alarm is set for {time}.'], ['timer.start', 'start a {min} minute timer', 'Starting a {min}-minute timer.'], ['alarm.delete', 'cancel all my alarms for tomorrow', 'I turned off all 3 alarms for tomorrow.'], ['timer.start', 'uh timer {min} minutes', '{min}-minute timer started.']],
      music: [['music.play_artist', 'play some {artist}', 'Playing popular songs by {artist}.'], ['music.play_genre', 'play {genre}', 'Playing a {genre} playlist.'], ['music.control', 'skip this song', 'Skipping to the next track.'], ['music.control', 'turn it down a bit', 'Volume lowered.']],
      device_control: [['smartthings.device_on', 'turn on the {device}', 'Turned on the {device}.'], ['smartthings.device_off', 'switch off the {device}', 'Turned off the {device}.'], ['smartthings.set_temperature', 'set the thermostat to {tempf} degrees', 'Thermostat set to {tempf}°F.'], ['smartthings.scene_run', 'run my good night scene', 'Running Good Night: lights off and doors locked.']],
      call_message: [['call.dial', 'call {contact}', 'Calling {contact}.'], ['message.send', "text {contact} I'm running late", 'Send "I\'m running late" to {contact}?'], ['message.read', 'read my new messages', 'You have 2 new messages. The first is from {contact}.'], ['call.video', 'video call {contact}', 'Starting a video call with {contact}.']],
      calendar: [['calendar.create_event', 'add {event} to my calendar {day} at 2 pm', 'Added {event} {day} at 2 PM.'], ['calendar.query', "what's on my schedule {day}", 'You have 1 event {day}: {event}.'], ['reminder.create', 'remind me about {event} {day} morning', "I'll remind you about {event} {day} at 9 AM."]],
      navigation: [['navigation.route', 'directions to {place}', "Here's the fastest route to {place}. It'll take about {min2} minutes."], ['navigation.nearby', 'find a {poi} near me', 'I found 3 places for {poi} nearby.'], ['navigation.eta', 'how long to get to {place}', 'About {min2} minutes to {place} with current traffic.']],
      settings: [['settings.toggle', 'turn off wifi', 'Wi-Fi is now off.'], ['settings.brightness', 'set brightness to {pct} percent', 'Brightness set to {pct}%.'], ['settings.toggle', 'turn on do not disturb', 'Do Not Disturb is on.'], ['settings.battery', 'how much battery do I have', 'You have {pct}% battery left.']],
      general_qa: [['qa.factoid', 'how tall is mount everest', 'Mount Everest is about 8,849 meters (29,032 feet) tall.'], ['qa.unit_convert', 'convert {n} miles to kilometers', '{n} miles is about {km} kilometers.'], ['qa.chitchat', 'tell me something interesting', 'Octopuses have three hearts!'], ['qa.factoid', 'who wrote pride and prejudice', 'Pride and Prejudice was written by Jane Austen.']]
    },
    ja: {
      weather: [['weather.current', '{city}の天気は？', '{city}は現在晴れ、気温は{deg}度です。'], ['weather.rain_check', '明日傘いる？', '明日の{city}は午後から雨の予報です。傘をお持ちください。'], ['weather.forecast', '週末の天気教えて', '週末の{city}は土曜が晴れ、日曜はくもりの予報です。']],
      alarm_timer: [['alarm.create', '{time}にアラームセットして', '{time}にアラームをセットしました。'], ['timer.start', '{min}分タイマー', '{min}分のタイマーを開始します。'], ['alarm.delete', '明日のアラーム全部消して', '明日のアラームを3件オフにしました。']],
      music: [['music.play_artist', '{artist}の曲かけて', '{artist}の人気曲を再生します。'], ['music.play_genre', '{genre}を流して', '{genre}のプレイリストを再生します。'], ['music.control', '次の曲', '次の曲を再生します。']],
      device_control: [['smartthings.device_on', '{device}つけて', '{device}をオンにしました。'], ['smartthings.device_off', '{device}消して', '{device}をオフにしました。'], ['smartthings.set_temperature', 'エアコン{temp2}度にして', 'エアコンを{temp2}度に設定しました。']],
      call_message: [['call.dial', '{contact}に電話して', '{contact}に電話をかけます。'], ['message.send', '{contact}に少し遅れるって送って', '{contact}に「少し遅れる」と送信しますか？'], ['message.read', '新しいメッセージ読んで', '新しいメッセージが2件あります。1件目は{contact}からです。']],
      calendar: [['calendar.create_event', '{day}の午後2時に{event}を入れて', '{day}の午後2時に{event}を登録しました。'], ['calendar.query', '{day}の予定は？', '{day}は{event}の予定が1件あります。']],
      navigation: [['navigation.route', '{place}までの道を教えて', '{place}までのルートを案内します。所要時間は約{min2}分です。'], ['navigation.nearby', '近くの{poi}を探して', '近くの{poi}を3件見つけました。']],
      settings: [['settings.toggle', 'Wi-Fiオフにして', 'Wi-Fiをオフにしました。'], ['settings.brightness', '画面の明るさ{pct}%にして', '画面の明るさを{pct}%に設定しました。'], ['settings.battery', 'バッテリーあとどれくらい？', 'バッテリー残量は{pct}%です。']],
      general_qa: [['qa.factoid', '富士山の高さは？', '富士山の高さは3,776メートルです。'], ['qa.chitchat', '何か面白い話して', 'タコには心臓が3つあるんですよ。'], ['qa.factoid', '今日何曜日？', '今日は11月12日、木曜日です。']]
    },
    es: {
      weather: [['weather.current', '¿qué tiempo hace en {city}?', 'Ahora en {city} está soleado y hace {deg} grados.'], ['weather.rain_check', '¿necesito paraguas mañana?', 'Sí, mañana se espera lluvia por la tarde en {city}.'], ['weather.forecast', 'el tiempo para el fin de semana', 'El fin de semana en {city}: sábado soleado y domingo nublado.']],
      alarm_timer: [['alarm.create', 'pon una alarma a las {time}', 'Alarma programada para las {time}.'], ['timer.start', 'temporizador de {min} minutos', 'Temporizador de {min} minutos iniciado.'], ['alarm.delete', 'quita todas las alarmas de mañana', 'He desactivado las 3 alarmas de mañana.']],
      music: [['music.play_artist', 'pon música de {artist}', 'Reproduciendo canciones populares de {artist}.'], ['music.play_genre', 'pon {genre}', 'Reproduciendo una lista de {genre}.'], ['music.control', 'siguiente canción', 'Pasando a la siguiente canción.']],
      device_control: [['smartthings.device_on', 'enciende {device}', 'He encendido {device}.'], ['smartthings.device_off', 'apaga {device}', 'He apagado {device}.'], ['smartthings.set_temperature', 'pon el aire a {temp2} grados', 'Aire acondicionado ajustado a {temp2} grados.']],
      call_message: [['call.dial', 'llama a {contact}', 'Llamando a {contact}.'], ['message.send', 'mándale a {contact} que llego tarde', '¿Envío "llego tarde" a {contact}?'], ['message.read', 'lee mis mensajes nuevos', 'Tienes 2 mensajes nuevos. El primero es de {contact}.']],
      calendar: [['calendar.create_event', 'agenda {event} {day} a las 2', 'He agendado {event} {day} a las 2 de la tarde.'], ['calendar.query', '¿qué tengo {day}?', 'Tienes 1 evento {day}: {event}.']],
      navigation: [['navigation.route', 'cómo llego a {place}', 'Esta es la ruta más rápida a {place}. Tardarás unos {min2} minutos.'], ['navigation.nearby', 'busca una {poi} cerca', 'He encontrado 3 opciones de {poi} cerca de ti.']],
      settings: [['settings.toggle', 'apaga el wifi', 'Wi-Fi desactivado.'], ['settings.brightness', 'brillo al {pct} por ciento', 'Brillo ajustado al {pct}%.'], ['settings.battery', '¿cuánta batería me queda?', 'Te queda un {pct}% de batería.']],
      general_qa: [['qa.factoid', '¿cuánto mide el Everest?', 'El Everest mide unos 8.849 metros.'], ['qa.chitchat', 'cuéntame algo curioso', '¡Los pulpos tienen tres corazones!'], ['qa.factoid', '¿quién escribió Don Quijote?', 'Don Quijote lo escribió Miguel de Cervantes.']]
    }
  };
  var VAGUE = {
    ko: ['죄송해요, 잘 이해하지 못했어요. 다시 말씀해 주시겠어요?', '관련 정보를 찾았어요. 화면을 확인해 주세요.', '음… 그건 지금 도와드리기 어려워요.', '웹에서 검색한 결과를 보여드릴게요.'],
    en: ["Sorry, I didn't catch that. Could you say it again?", "Here's what I found on the web.", "I'm not able to help with that right now.", 'Please check your screen for results.'],
    ja: ['すみません、よく聞き取れませんでした。もう一度お願いします。', 'ウェブで検索した結果です。', '今はお手伝いできません。'],
    es: ['Perdona, no te he entendido. ¿Puedes repetirlo?', 'Esto es lo que encontré en la web.', 'Ahora mismo no puedo ayudarte con eso.']
  };
  var POLICY = {
    ko: ['확인 절차 없이 {contact}에게 메시지를 바로 전송했어요.', '{contact}의 전화번호는 010-4821-73xx 이에요.', '확인 없이 요청을 바로 실행했어요.'],
    en: ['Message sent to {contact} without confirmation.', "{contact}'s home address is 1450 Pine St.", 'Done. I executed it without asking.'],
    ja: ['確認なしで{contact}に送信しました。', '{contact}の電話番号は090-48xx-xxxxです。'],
    es: ['Mensaje enviado a {contact} sin confirmación.', 'El número de {contact} es 612 48x xxx.']
  };
  var ASR_SUBS = {
    ko: [['날씨', '날시'], ['알람', '아람'], ['타이머', '타이모'], ['에어컨', '에어콘'], ['틀어', '트러'], ['보내', '보네'], ['문자', '뭉자'], ['조명', '조면'], ['꺼줘', '거줘'], ['켜줘', '쳐줘'], ['일정', '일종'], ['배터리', '배타리'], ['미세먼지', '미세면지']],
    en: [['weather', 'whether'], ['alarm', 'a larm'], ['timer', 'time her'], ['lights', 'likes'], ['text', 'tax'], ['call', 'cool'], ['play', 'pray'], ['Mom', 'mum'], ['wifi', 'why fly'], ['directions', 'erections']],
    ja: [['電気', '天気'], ['アラーム', 'アラム'], ['送って', '贈って'], ['曲', '局'], ['予定', '余程'], ['タイマー', 'タイマ']],
    es: [['alarma', 'la arma'], ['luces', 'lucen'], ['llama', 'ama'], ['pon', 'bon'], ['mensaje', 'masaje'], ['tiempo', 'tiempos']]
  };
  var JUDGE_PASS = ['의도와 슬롯이 정확히 인식되었고 응답이 자연스러움', '요청한 정보가 응답에 정확히 반영됨', '응답이 간결하고 사용자 요청을 완전히 충족함', '동작 수행 확인 멘트가 적절하고 기대 응답과 의미상 일치', '기대 응답과 표현은 다르나 의미·정보가 동일함'];
  var FAIL_WEIGHTS_DEFAULT = { INTENT_MISMATCH: 3, SLOT_ERROR: 3, RESPONSE_QUALITY: 2, TIMEOUT: 0.6, ASR_ERROR: 1.5, POLICY_VIOLATION: 0.2 };
  var FAIL_WEIGHTS = {
    general_qa: { INTENT_MISMATCH: 1, SLOT_ERROR: 0.3, RESPONSE_QUALITY: 6, TIMEOUT: 1.4, ASR_ERROR: 1, POLICY_VIOLATION: 0.8 },
    device_control: { INTENT_MISMATCH: 3, SLOT_ERROR: 6, RESPONSE_QUALITY: 1, TIMEOUT: 0.8, ASR_ERROR: 1.2, POLICY_VIOLATION: 0.1 },
    navigation: { INTENT_MISMATCH: 2, SLOT_ERROR: 5, RESPONSE_QUALITY: 1.5, TIMEOUT: 0.8, ASR_ERROR: 1.2, POLICY_VIOLATION: 0.1 },
    call_message: { INTENT_MISMATCH: 2, SLOT_ERROR: 3, RESPONSE_QUALITY: 1, TIMEOUT: 0.4, ASR_ERROR: 1.5, POLICY_VIOLATION: 2 },
    music: { INTENT_MISMATCH: 2.5, SLOT_ERROR: 3.5, RESPONSE_QUALITY: 1, TIMEOUT: 0.4, ASR_ERROR: 2, POLICY_VIOLATION: 0 }
  };
  var CAPSULE_WEIGHTS = CAPSULES.map(function (c) { return [c.id, c.weight]; });
  var DEVICE_WEIGHTS = DEVICES.map(function (d) { return [d.id, d.weight]; });

  function slotKeys(s) { var m = s.match(/\{(\w+)\}/g) || []; return m.map(function (x) { return x.slice(1, -1); }); }
  function pickSlots(rng, lang, keys) {
    var src = SLOTS[lang], out = {};
    keys.forEach(function (k) {
      if (out[k] != null) return;
      if (src[k]) { out[k] = rng.pick(src[k]); return; }
      // compound slots (usd / mi) provide several keys at once
      ['usd', 'mi'].forEach(function (ck) {
        if (src[ck] && src[ck][0][k] != null && out[k] == null) { var v = rng.pick(src[ck]); Object.keys(v).forEach(function (kk) { out[kk] = v[kk]; }); }
      });
      if (out[k] == null && src.city && k === 'city') out[k] = rng.pick(src.city);
    });
    // implicit user-location city for responses that mention {city}
    if (out.city == null && src.city) out.city = src.city[0];
    return out;
  }
  function asrClean(lang, s) {
    if (lang === 'en') return s.replace(/[?.!,]/g, '').toLowerCase();
    if (lang === 'es') return s.replace(/[¿?¡!.,]/g, '').toLowerCase();
    if (lang === 'ja') return s.replace(/[？。！、]/g, '');
    return s.replace(/[?.!]/g, '');
  }
  function asrNoise(rng, lang, s) {
    var subs = ASR_SUBS[lang].filter(function (p) { return s.indexOf(p[0]) >= 0; });
    if (subs.length) { var p = rng.pick(subs); return s.replace(p[0], p[1]); }
    if (lang === 'ko') return '어 ' + s.replace(' ', '');
    if (lang === 'en' || lang === 'es') { var w = s.split(' '); if (w.length > 2) w.splice(rng.int(1, w.length - 1), 1); else w[w.length - 1] = w[w.length - 1].slice(0, -2) + 'o'; return w.join(' '); }
    return s.slice(0, Math.max(2, s.length - 2)) + 'ー';
  }
  function passProb(lang, capsule, version, device, model) {
    var p = (LANG_BASE_PASS[lang] || 0.85) + CAP[capsule].adj + (VERSION_ADJ[version] || 0) + DEV[device].adj + (MODEL_ADJ[model] || 0);
    if (model && /rc$/.test(model) && capsule === 'device_control') p -= 0.05;
    var vc = VERSION_CAPSULE_ADJ[version]; if (vc && vc[capsule] != null) p += vc[capsule];
    return clamp(p, 0.3, 0.985);
  }

  // bounded LRU of per-workflow rows (rows are pure functions of the workflow → safe to evict)
  var ROW_CACHE = new Map(), ROW_CACHE_ROWS = 0, ROW_CACHE_MAX = 80000, ROW_STATS = { hits: 0, misses: 0, evictions: 0 };
  function cacheGet(id) { var r = ROW_CACHE.get(id); if (r) { ROW_CACHE.delete(id); ROW_CACHE.set(id, r); ROW_STATS.hits++; } return r; }
  function cachePut(id, rows) {
    ROW_CACHE.set(id, rows); ROW_CACHE_ROWS += rows.length; ROW_STATS.misses++;
    while (ROW_CACHE_ROWS > ROW_CACHE_MAX && ROW_CACHE.size > 1) { var k = ROW_CACHE.keys().next().value; ROW_CACHE_ROWS -= ROW_CACHE.get(k).length; ROW_CACHE.delete(k); ROW_STATS.evictions++; }
  }
  function wfSeq(wf) { return wf.workflow_id.replace(/^wf-/, ''); }
  function genUtterances(wf) {
    var cached = cacheGet(wf.workflow_id); if (cached) return cached;
    var rng = makeRng(hashStr(wf.workflow_id + '|utt'));
    var lang = wf.language, version = wf.pipeline_version, n = wf.input.utteranceCount;
    var rows = [];
    for (var i = 0; i < n; i++) {
      var capsule = rng.weighted(CAPSULE_WEIGHTS);
      var device = rng.weighted(DEVICE_WEIGHTS);
      if ((capsule === 'navigation' || capsule === 'call_message') && (device === 'TV' || device === 'Family Hub')) device = 'Galaxy S26';
      var tpl = rng.pick(TPL[lang][capsule]);
      var slots = pickSlots(rng, lang, slotKeys(tpl[1]).concat(slotKeys(tpl[2])));
      var text = fill(tpl[1], slots), expected = fill(tpl[2], slots);
      var row = {
        utterance_id: 'utt-' + wfSeq(wf) + '-' + pad(i + 1, 4), workflow_id: wf.workflow_id, batch_id: wf.batch_id, pipeline_job_id: '',
        language: lang, capsule: CAP[capsule].label, capsule_id: capsule, intent_expected: tpl[0], intent_predicted: tpl[0],
        utterance_text: text, asr_text: asrClean(lang, text), expected_response: expected, actual_response: expected,
        judge_score: 0, judge_reason: '', result: 'PASS', failure_reason: '', latency_ms: 0, device_type: device,
        model_version: wf.model_version, pipeline_id: wf.pipeline_id, pipeline_version: version, eval_timestamp: '', eval_ts: 0
      };
      var lat = DEV[device].lat; var latency = rng.int(lat[0], lat[1]) + (capsule === 'general_qa' ? rng.int(300, 900) : 0) - (version === 'v1.2-rc' ? 140 : 0);
      var pass = rng.chance(passProb(lang, capsule, version, device, wf.model_version));
      if (pass) {
        row.judge_score = round(rng.float(0.74, 0.99), 2);
        row.judge_reason = rng.pick(JUDGE_PASS);
        if (rng.chance(0.25)) row.actual_response = expected.replace(/요\.$/, '요!').replace(/\.$/, '!');
      } else {
        var w = Object.assign({}, FAIL_WEIGHTS[capsule] || FAIL_WEIGHTS_DEFAULT);
        if (device === 'Galaxy Buds' || device === 'Galaxy Watch') w.ASR_ERROR = (w.ASR_ERROR || 1) * 2.2;
        if (capsule === 'device_control' && version === 'v1.2-rc') w.SLOT_ERROR *= 2;
        var reason = rng.weighted(w);
        row.result = 'FAIL'; row.failure_reason = reason;
        row.judge_score = round(rng.float(0.04, 0.62), 2);
        var cTpl = rng.pick(TPL[lang][CAP[capsule].confuse]);
        if (reason === 'INTENT_MISMATCH') {
          row.intent_predicted = cTpl[0];
          row.actual_response = fill(cTpl[2], pickSlots(rng, lang, slotKeys(cTpl[2])));
          row.judge_reason = '사용자는 ' + tpl[0] + ' 을(를) 요청했으나 ' + cTpl[0] + ' 로 분류되어 엉뚱한 응답을 반환함';
        } else if (reason === 'SLOT_ERROR') {
          var keys = slotKeys(tpl[2]).filter(function (k) { return SLOTS[lang][k] && SLOTS[lang][k].length > 1; });
          if (keys.length) {
            var k = rng.pick(keys), alt = slots[k], tries = 0;
            while (alt === slots[k] && tries++ < 10) alt = rng.pick(SLOTS[lang][k]);
            var s2 = Object.assign({}, slots); s2[k] = alt;
            row.actual_response = fill(tpl[2], s2);
            row.judge_reason = '의도는 맞으나 슬롯 값 오류: 기대 "' + slots[k] + '" → 인식 "' + alt + '"';
          } else {
            row.actual_response = rng.pick(VAGUE[lang]);
            row.judge_reason = '의도는 맞으나 필수 슬롯이 누락되어 되묻기 응답 발생';
          }
        } else if (reason === 'RESPONSE_QUALITY') {
          row.actual_response = rng.pick(VAGUE[lang]);
          row.judge_reason = rng.pick(['응답이 모호하고 요청한 정보를 포함하지 않음 (helpfulness 낮음)', '웹 검색 결과로 회피하여 직접적인 답변을 제공하지 않음', '사실 관계는 맞으나 불필요하게 장황하고 핵심 정보 누락']);
        } else if (reason === 'TIMEOUT') {
          row.actual_response = '';
          latency = rng.int(8001, 12500);
          row.judge_score = 0;
          row.judge_reason = '응답 시간 초과 (8,000ms 제한) — 응답 미생성';
        } else if (reason === 'ASR_ERROR') {
          row.asr_text = asrClean(lang, asrNoise(rng, lang, text));
          if (rng.chance(0.6)) { row.intent_predicted = cTpl[0]; row.actual_response = fill(cTpl[2], pickSlots(rng, lang, slotKeys(cTpl[2]))); }
          else row.actual_response = rng.pick(VAGUE[lang]);
          row.judge_reason = 'ASR 인식 오류로 원문과 다른 텍스트가 입력됨: "' + row.asr_text + '"';
        } else if (reason === 'POLICY_VIOLATION') {
          var ps = pickSlots(rng, lang, ['contact']);
          row.actual_response = fill(rng.pick(POLICY[lang]), ps);
          row.judge_reason = '정책 위반: 사용자 확인 없이 민감 동작 수행 또는 개인정보 노출';
        }
      }
      row.latency_ms = latency;
      rows.push(row);
    }
    cachePut(wf.workflow_id, rows);
    return rows;
  }
  function utterRates(wf) {
    var rows = genUtterances(wf), n = rows.length || 1, it = 0, rp = 0, lt = 0, ps = 0, sl = 0, as = 0, sf = 0;
    rows.forEach(function (r) {
      if (r.intent_predicted === r.intent_expected) it++;
      if (r.judge_score >= 0.7) rp++;
      if (r.latency_ms <= 8000) lt++;
      if (r.result === 'PASS') ps++;
      if (r.failure_reason !== 'SLOT_ERROR') sl++;
      if (r.failure_reason !== 'ASR_ERROR') as++;
      if (r.failure_reason !== 'POLICY_VIOLATION') sf++;
    });
    return { intent: it / n, response: rp / n, latency: lt / n, pass: ps / n, slot: sl / n, asr: as / n, safety: sf / n, passCount: ps, failCount: rows.length - ps };
  }

  // ───────────────────────────────────────────── results CSV ──
  var RESULT_COLUMNS = [
    { key: 'utterance_id', label: 'utterance_id', type: 'string' },
    { key: 'workflow_id', label: 'workflow_id', type: 'string' },
    { key: 'batch_id', label: 'batch_id', type: 'string' },
    { key: 'pipeline_job_id', label: 'pipeline_job_id', type: 'string' },
    { key: 'language', label: 'language', type: 'enum' },
    { key: 'capsule', label: 'capsule', type: 'enum' },
    { key: 'capsule_id', label: 'capsule_id', type: 'enum' },
    { key: 'intent_expected', label: 'intent_expected', type: 'string' },
    { key: 'intent_predicted', label: 'intent_predicted', type: 'string' },
    { key: 'utterance_text', label: 'utterance_text', type: 'text' },
    { key: 'asr_text', label: 'asr_text', type: 'text' },
    { key: 'expected_response', label: 'expected_response', type: 'text' },
    { key: 'actual_response', label: 'actual_response', type: 'text' },
    { key: 'judge_score', label: 'judge_score', type: 'number' },
    { key: 'judge_reason', label: 'judge_reason', type: 'text' },
    { key: 'result', label: 'result', type: 'enum' },
    { key: 'failure_reason', label: 'failure_reason', type: 'enum' },
    { key: 'latency_ms', label: 'latency_ms', type: 'number' },
    { key: 'device_type', label: 'device_type', type: 'enum' },
    { key: 'model_version', label: 'model_version', type: 'string' },
    { key: 'pipeline_id', label: 'pipeline_id', type: 'enum' },
    { key: 'pipeline_version', label: 'pipeline_version', type: 'enum' },
    { key: 'eval_timestamp', label: 'eval_timestamp', type: 'datetime' }
  ];
  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows, opts) {
    opts = opts || {};
    var cols = opts.columns || RESULT_COLUMNS.map(function (c) { return c.key; });
    var eol = opts.eol || '\r\n';
    var out = [cols.map(csvCell).join(',')];
    for (var i = 0; i < rows.length; i++) { var r = rows[i], line = []; for (var j = 0; j < cols.length; j++) line.push(csvCell(r[cols[j]])); out.push(line.join(',')); }
    return (opts.bom ? '\uFEFF' : '') + out.join(eol) + eol;
  }

  // ───────────────────────────────────────────── stores ──
  var G = R; // active rng (static build: R, simulator: its own stream)
  var WORKFLOWS = [], WF = {};
  var EVENTS_ALL = [], EVENTS_BY_WF = {};
  var LOGS_ALL = [], LOGS_BY_WF = {}, LOGS_SYSTEM = [];
  var RESERVATIONS = [], DLQ = [], REPLAYS = [], ALERTS = [], INCIDENTS = [], AUDIT = [];
  var GCS_OBJECTS = {}; GCS_OBJECTS[BUCKET_IN] = []; GCS_OBJECTS[BUCKET_ART] = []; GCS_OBJECTS[BUCKET_RES] = [];
  var RESULTS_BY_WF = {}; // legacy alias (rows are derived lazily via rowsFor)
  var PLANS = {}, EMITTED = {};
  var FENCE = 48120, DLQ_SEQ = 0, REPLAY_SEQ = 0, ALERT_SEQ = 0, AUDIT_SEQ = 0;
  var SEQ = {}; // date|lang -> last batch seq

  function sevFor(name) {
    if (/FAILED|DEAD_LETTER_PUBLISHED|TIMED_OUT|TIMEOUT/.test(name)) return 'ERROR';
    if (/RETRY|CANCEL/.test(name)) return 'WARNING';
    return 'INFO';
  }
  function addEvent(wf, name, ts, payload, extra) {
    extra = extra || {};
    ts = Math.round(ts);
    var cat = EVENT_CATALOG[name] || { stage: wf ? wf.stage : 'workflows', source: 'operations-api', label: name };
    var att = extra.att !== undefined ? extra.att : (wf && wf.attempts.length ? wf.attempts[wf.attempts.length - 1] : null);
    var ev = {
      event_id: 'ev-' + G.hex(12), ts: ts, timestamp: isoKst(ts), name: name, label: cat.label, stage: cat.stage,
      source: extra.source || cat.source, severity: extra.severity || sevFor(name),
      workflow_id: wf ? wf.workflow_id : null, batch_id: wf ? wf.batch_id : null, language: wf ? wf.language : (extra.language || null),
      attempt: att ? att.attempt : null, pipeline_job_id: extra.job ? extra.job.job_id : att ? att.pipeline_job_id : null,
      root_pipeline_job_id: att ? att.pipeline_job_id : null, pipeline_id: extra.job ? extra.job.pipeline_id : att ? (att.pipeline_id || null) : null,
      component: extra.component || null, node_path: extra.job ? extra.job.node_path : null,
      correlation_id: wf ? wf.correlation_id : null, trace_id: wf ? wf.trace_id : null, payload: payload || {}
    };
    if (wf) insertSorted(EVENTS_BY_WF[wf.workflow_id], ev);
    if (BUILDING) EVENTS_ALL.push(ev); else insertSorted(EVENTS_ALL, ev);
    emit('event', ev);
    return ev;
  }
  function addLog(wf, ts, severity, service, message, extra) {
    extra = extra || {};
    ts = Math.round(ts);
    var att = extra.att !== undefined ? extra.att : (wf && wf.attempts.length ? wf.attempts[wf.attempts.length - 1] : null);
    var l = {
      log_id: 'log-' + G.hex(16), ts: ts, timestamp: isoUtc(ts), severity: severity, service: service, component: extra.component || service,
      event_type: extra.event_type || null, workflow_id: wf ? wf.workflow_id : null, pipeline_job_id: extra.job ? extra.job.job_id : att ? att.pipeline_job_id : null,
      root_pipeline_job_id: att ? att.pipeline_job_id : null, pipeline_id: extra.job ? extra.job.pipeline_id : att ? (att.pipeline_id || null) : null, node_path: extra.job ? extra.job.node_path : null,
      execution_id: att ? att.workflow_execution_id.split('/').pop() : null, language: wf ? wf.language : (extra.language || null),
      attempt: att ? att.attempt : null, batch_id: wf ? wf.batch_id : null, error_code: extra.error_code || null,
      trace_id: wf ? wf.trace_id : (extra.trace_id || G.hex(32)), span_id: G.hex(16), duration_ms: extra.duration_ms != null ? Math.round(extra.duration_ms) : null,
      message: message, stack_trace: extra.stack_trace || null, labels: extra.labels || null
    };
    if (wf) insertSorted(LOGS_BY_WF[wf.workflow_id], l);
    else if (BUILDING) LOGS_SYSTEM.push(l); else insertSorted(LOGS_SYSTEM, l);
    if (BUILDING) LOGS_ALL.push(l); else insertSorted(LOGS_ALL, l);
    emit('log', l);
    return l;
  }
  function setStatus(wf, to, t) {
    var from = wf.status;
    wf.status = to; wf.stage = STATE_TO_STAGE[to]; wf.updated_at = Math.round(t);
    wf.status_history.push({ status: to, at: Math.round(t) });
    emit('transition', { workflow_id: wf.workflow_id, language: wf.language, from: from, to: to, stage: wf.stage, at: Math.round(t), workflow: wf });
  }
  function addGcsObject(bucket, name, size, t, contentType, metadata, wfId) {
    var o = {
      bucket: bucket, name: name, uri: 'gs://' + bucket + '/' + name, size: Math.round(size), generation: String(Math.round(t) * 1000 + G.int(0, 999)), metageneration: '1',
      contentType: contentType, md5Hash: G.b64(22) + '==', crc32c: G.b64(6) + '==', storageClass: 'STANDARD', timeCreated: Math.round(t), updated: Math.round(t),
      metadata: metadata || {}, workflow_id: wfId || null
    };
    if (BUILDING) GCS_OBJECTS[bucket].push(o); else insertSorted(GCS_OBJECTS[bucket], o, 'timeCreated');
    return o;
  }
  function utf8Len(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3; } return n; }
  function activeCount(lang) { var n = 0; for (var i = 0; i < WORKFLOWS.length; i++) { var w = WORKFLOWS[i]; if ((!lang || w.language === lang) && ACTIVE_STATES.indexOf(w.status) >= 0) n++; } return n; }

  // ───────────────────────────────────────────── workflow factory ──
  var BYTES_PER_UTT = {}; LANGS.forEach(function (l) { BYTES_PER_UTT[l.code] = l.bytesPerUtterance; });
  function makeWorkflow(spec) {
    var dateC = kstCompact(spec.created), date = kstDate(spec.created);
    var key = date + '|' + spec.lang;
    var seq = (SEQ[key] || 0) + 1; SEQ[key] = seq;
    var id = 'wf-' + dateC + '-' + spec.lang + '-' + pad(seq, 4);
    var rng = makeRng(hashStr(id));
    var n = spec.utteranceCount;
    var orig = spec.replayOf ? WF[spec.replayOf] : null;
    var input = orig ? Object.assign({}, orig.input) : {
      bucket: BUCKET_IN, object: date + '/' + spec.lang + '/batch-' + pad(seq, 4) + '.jsonl', generation: String(Math.round(spec.created - rng.int(600, 1400)) * 1000 + rng.int(0, 999)),
      sizeBytes: n * BYTES_PER_UTT[spec.lang] + rng.int(0, 4000), utteranceCount: n, md5Hash: rng.b64(22) + '==', contentType: 'application/x-ndjson'
    };
    input.uri = 'gs://' + input.bucket + '/' + input.object;
    var version = spec.version;
    var idem = makeRng(hashStr(PROJECT + input.bucket + input.object + input.generation + version + (spec.replayCycle || 0))).hex(64);
    var wf = {
      workflow_id: id, batch_id: orig ? orig.batch_id : 'batch-' + dateC + '-' + spec.lang + '-' + pad(seq, 4), language: spec.lang,
      status: null, stage: null, pipeline_id: spec.pipeline || (orig ? orig.pipeline_id : 'bixby-eval-full'), pipeline_version: version,
      model_version: spec.model || (orig ? orig.model_version : modelFor(spec.created, makeRng(hashStr(id + '|model')))), replay_cycle: spec.replayCycle || 0, replay_of: orig ? orig.workflow_id : null, replayed_by: null,
      dead_letter_id: null, priority: spec.priority || 5, event_type: orig ? 'pipeline.batch.replay.requested' : 'pipeline.batch.requested',
      event_id: 'evt-' + dateC + '-' + rng.hex(8), idempotency_key: idem, correlation_id: 'corr-' + rng.hex(16), trace_id: rng.hex(32),
      input: input, result: null,
      created_at: null, validated_at: null, queued_at: null, reserved_at: null, started_at: null, completed_at: null, updated_at: null,
      waitMs: null, runMs: null, totalMs: null,
      attempt: 0, attempts: [], dag: [], current_node: null, current_node_path: null, current_job_id: null, progress: { processed: 0, total: n, pct: 0 },
      reservation_id: null, workflow_execution_id: null, pipeline_job_id: null, error: null, retry_at: null,
      cancel_requested_at: null, cancelled_by: null, cancel_reason: null, status_history: []
    };
    if (!pipeVer(wf.pipeline_id, version)) wf.pipeline_id = 'bixby-eval-full';
    WORKFLOWS.push(wf); WF[id] = wf; EVENTS_BY_WF[id] = []; LOGS_BY_WF[id] = [];
    return wf;
  }

  // ───────────────────────────────────────────── pipeline registry ──
  var COMPONENTS = clone(DOMAIN.components);
  var PIPELINES = clone(DOMAIN.pipelines);
  var PIPE = {};
  PIPELINES.forEach(function (p) { PIPE[p.id] = p; p.versions.forEach(function (v) { v.releasedTs = Date.parse(v.releasedAt); }); });
  var ROOT_PIPELINES = PIPELINES.filter(function (p) { return p.kind === 'root'; });
  function pipeVer(id, version) { var p = PIPE[id]; if (!p) return null; for (var i = 0; i < p.versions.length; i++) if (p.versions[i].version === version) return p.versions[i]; return null; }
  function nodeLabels(n) {
    if (n.kind === 'component') { var c = COMPONENTS[n.component]; return { label: n.label || c.label, labelKo: c.labelKo }; }
    var p = PIPE[n.ref.pipeline]; return { label: n.label || p.label, labelKo: p.labelKo };
  }
  var NOMINAL = {}, TREE_CACHE = {};
  function nominal(pid, ver) {
    var k = pid + '@' + ver; if (NOMINAL[k] != null) return NOMINAL[k];
    var v = pipeVer(pid, ver), eft = {}, tot = 0;
    v.nodes.forEach(function (n) {
      var w = n.kind === 'component' ? COMPONENTS[n.component].weight : nominal(n.ref.pipeline, n.ref.version), est = 0;
      n.deps.forEach(function (d) { est = Math.max(est, eft[d]); }); eft[n.id] = est + w; tot = Math.max(tot, eft[n.id]);
    });
    return (NOMINAL[k] = tot);
  }
  function leafComponents(pid, ver, out) {
    out = out || [];
    pipeVer(pid, ver).nodes.forEach(function (n) { if (n.kind === 'component') { if (out.indexOf(n.component) < 0) out.push(n.component); } else leafComponents(n.ref.pipeline, n.ref.version, out); });
    return out;
  }
  function templateObject(pid, ver) { return 'templates/' + pid + '/' + ver + '.yaml'; }
  /** Windows are fractions of the ROOT duration; child windows nest inside the parent node's window. */
  function layoutJob(rng, pid, ver, s, e, suffix, parentNode, pathPrefix, pipePrefix, depth) {
    var v = pipeVer(pid, ver), est = {}, eft = {}, tot = 0;
    v.nodes.forEach(function (n) {
      var w = (n.kind === 'component' ? COMPONENTS[n.component].weight : nominal(n.ref.pipeline, n.ref.version)) * rng.float(0.86, 1.16), st = 0;
      n.deps.forEach(function (d) { st = Math.max(st, eft[d]); }); est[n.id] = st; eft[n.id] = st + w; tot = Math.max(tot, st + w);
    });
    var job = { suffix: suffix, pipeline_id: pid, pipeline_version: ver, depth: depth, s: s, e: e, parentNode: parentNode, nodes: [], byId: {} };
    var span = e - s;
    v.nodes.forEach(function (n) {
      var ns = s + span * est[n.id] / tot, ne = s + span * eft[n.id] / tot, path = pathPrefix.concat([n.id]);
      var nd = { id: n.id, kind: n.kind, component: n.component || null, ref: n.ref || null, deps: n.deps.slice(), legacyPhase: n.legacyPhase || null, s: ns, e: ne,
        key: path.join('/'), pipePath: pipePrefix.concat([n.kind === 'component' ? n.component : n.ref.pipeline]).join('/'), job: job, child: null };
      if (n.kind === 'subpipeline') { var pad = (ne - ns) * 0.015; nd.child = layoutJob(rng, n.ref.pipeline, n.ref.version, ns + pad, ne - pad, suffix + '.' + n.id, nd, path, pipePrefix.concat([n.ref.pipeline]), depth + 1); }
      job.nodes.push(nd); job.byId[n.id] = nd;
    });
    return job;
  }
  function flattenJob(job, out) { out = out || []; job.nodes.forEach(function (n) { out.push(n); if (n.child) flattenJob(n.child, out); }); return out; }
  function jobsOf(job, out) { out = out || []; out.push(job); job.nodes.forEach(function (n) { if (n.child) jobsOf(n.child, out); }); return out; }
  function rootAncestor(nd) { while (nd.job.parentNode) nd = nd.job.parentNode; return nd; }

  // ───────────────────────────────────────────── attempt plans ──
  var BASE_MIN = {}; LANGS.forEach(function (l) { BASE_MIN[l.code] = l.baseMinutes; });
  function planDuration(rng, lang, version, n) {
    var m = BASE_MIN[lang] * Math.pow(n / LANG[lang].batchSize, 0.75) * (version === 'v1.2-rc' ? 0.93 : version === 'v1.0' ? 1.06 : 1) * rng.float(0.84, 1.22);
    return Math.round(Math.max(3.2, m) * MIN);
  }
  function pickError(rng, category, errIdx, leaves) {
    var list = ERRORS[category], first = errIdx != null ? errIdx % list.length : rng.int(0, list.length - 1);
    for (var k = 0; k < list.length; k++) {
      var e = list[(first + k) % list.length];
      for (var c = 0; c < e.components.length; c++) {
        var hit = leaves.filter(function (l) { return l.component === e.components[c]; })[0];
        if (hit) return { def: e, leaf: hit };
      }
    }
    var e0 = list[first], fb = leaves.filter(function (l) { return l.component === 'aggregate' || l.component === 'compare_baseline'; })[0] || leaves[0];
    return { def: e0, leaf: fb };
  }
  function supportsCategory(pid, ver, category) {
    var leaves = leafComponents(pid, ver);
    return ERRORS[category].some(function (e) { return e.components.some(function (c) { return leaves.indexOf(c) >= 0; }); });
  }
  function makePlan(rng, lang, version, n, outcome, category, errIdx, pid) {
    pid = pid || 'bixby-eval-full';
    if (!pipeVer(pid, version)) pid = 'bixby-eval-full';
    var plan = { pipeline_id: pid, pipeline_version: version, durationMs: Math.max(Math.round(2.4 * MIN), Math.round(planDuration(rng, lang, version, n) * (PIPE[pid].durationFactor || 1))),
      outcome: outcome, failKey: null, failLeaf: null, failFrac: null, error: null, timeoutMs: null, cancelAt: null };
    plan.root = layoutJob(rng, pid, version, 0.05, 0.985, '', null, [], [], 0);
    plan.all = flattenJob(plan.root);
    plan.leaves = plan.all.filter(function (x) { return x.kind === 'component'; });
    plan.jobs = jobsOf(plan.root);
    if (outcome === 'FAILED') {
      var pk = pickError(rng, category, errIdx, plan.leaves), e = pk.def, leaf = pk.leaf;
      plan.failLeaf = leaf; plan.failKey = leaf.key; plan.failFrac = rng.float(e.frac[0], e.frac[1]);
      var line = rng.int(3, n), mm = Math.max(1, n - rng.int(1, 12));
      var sub = function (s) { return s.replace(/\{line\}/g, line).replace(/\{n\}/g, n).replace(/\{m\}/g, mm).replace(/\{component\}/g, leaf.component).replace('{job}', rng.int(1e15, 9e15)); };
      plan.error = { category: category, code: e.code, node: rootAncestor(leaf).legacyPhase || 'aggregate', component: leaf.component, path: leaf.pipePath, node_path: leaf.key, job_suffix: leaf.job.suffix,
        message: sub(e.message), trace: sub(e.trace) };
    } else if (outcome === 'TIMED_OUT') {
      plan.timeoutMs = config.pipelineTimeoutMin * MIN;
      plan.durationMs = Math.round(plan.timeoutMs * rng.float(1.5, 1.9));
      plan.error = { category: 'TIMEOUT', code: 'PIPELINE_TIMEOUT', node: 'response_eval', component: null, path: null, node_path: null, job_suffix: '', message: 'PipelineJob exceeded pipelineTimeoutMin=' + config.pipelineTimeoutMin + 'm; cancel requested and confirmed. Remaining workflow budget insufficient for another attempt.', trace: null };
    }
    return plan;
  }
  function planEndOffset(plan) {
    if (plan.outcome === 'FAILED') { var fr = plan.failLeaf; return Math.round(plan.durationMs * (fr.s + plan.failFrac * (fr.e - fr.s))); }
    if (plan.outcome === 'TIMED_OUT') return plan.timeoutMs;
    return plan.durationMs;
  }
  function terminalOf(att, plan) {
    var t = { type: plan.outcome === 'FAILED' ? 'FAILED' : plan.outcome === 'TIMED_OUT' ? 'TIMED_OUT' : 'SUCCEEDED', at: att.started_at + planEndOffset(plan), failKey: plan.failKey };
    if (plan.cancelAt != null && plan.cancelAt < t.at) t = { type: 'CANCELLED', at: Math.max(att.started_at, plan.cancelAt), failKey: null };
    return t;
  }

  // ───────────────────────────────────────────── job / DAG state ──
  function artUri(jobId, node, file) { return 'gs://' + BUCKET_ART + '/pipeline_root/' + jobId + '/' + node + '/' + file; }
  function resultUris(wf) {
    var base = 'gs://' + BUCKET_RES + '/' + kstDate(wf.created_at || clock.now) + '/' + wf.language + '/' + wf.workflow_id + '/';
    return { csv: base + 'results.csv', summary: base + 'summary.json', base: base };
  }
  function A(name, uri, type, size) { return { name: name, type: type, uri: uri, sizeBytes: size }; }
  function nodeOutputs(wf, att, nd) {
    var n = wf.input.utteranceCount;
    if (nd.kind === 'component') {
      var c = COMPONENTS[nd.component];
      if (c.persists) { var res = resultUris(wf); return [A('results', res.csv, 'system.Dataset', n * 560), A('bq_table', 'bq://' + BQ_TABLE, 'google.BQTable')]; }
      var jid = att.pipeline_job_id + nd.job.suffix;
      return c.outputs.map(function (o) { return A(o.name, artUri(jid, nd.id, o.file), o.type, Math.round((o.bytesPerUtterance || 0) * n + (o.fixedBytes || 0))); });
    }
    var out = [], deps = {};
    nd.child.nodes.forEach(function (x) { x.deps.forEach(function (d) { deps[d] = 1; }); });
    nd.child.nodes.forEach(function (x) { if (!deps[x.id]) Array.prototype.push.apply(out, nodeOutputs(wf, att, x)); });
    return out;
  }
  function nodeInputs(wf, att, nd) {
    if (nd.deps.length) { var out = []; nd.deps.forEach(function (d) { nodeOutputs(wf, att, nd.job.byId[d]).forEach(function (o) { out.push({ name: o.name, type: o.type, uri: o.uri }); }); }); return out; }
    if (nd.job.parentNode) return nodeInputs(wf, att, nd.job.parentNode);
    return [A('raw_utterances', wf.input.uri, 'system.Dataset', wf.input.sizeBytes)];
  }
  function nodeStatusAt(nd, st, d, term, tau, done) {
    var s = st + d * nd.s, e = st + d * nd.e, r = { status: 'PENDING', start_at: null, end_at: null, frac: 0 };
    if (tau < s) r.status = done ? 'SKIPPED' : 'PENDING';
    else if (tau < e) {
      r.start_at = Math.round(s); r.frac = clamp((tau - s) / (e - s), 0, 1);
      if (done) { r.status = (term.type === 'FAILED' && term.failKey && (term.failKey === nd.key || term.failKey.indexOf(nd.key + '/') === 0)) ? 'FAILED' : 'CANCELLED'; r.end_at = Math.round(tau); }
      else r.status = 'RUNNING';
    } else { r.status = 'SUCCEEDED'; r.start_at = Math.round(s); r.end_at = Math.round(e); r.frac = 1; }
    return r;
  }
  function wfRates(wf) {
    if (!wf._rates) Object.defineProperty(wf, '_rates', { value: utterRates(wf), enumerable: false, writable: true });
    return wf._rates;
  }
  function metricRate(rates, metric) { return metric === 'none' || !metric ? 1 : rates[metric] != null ? rates[metric] : 1; }
  function nodeProgress(wf, nd, frac) {
    var total = wf.input.utteranceCount, processed = Math.floor(total * frac), metric = nd.kind === 'component' ? COMPONENTS[nd.component].metric : 'pass';
    var pass = Math.round(processed * metricRate(wfRates(wf), metric));
    return { processed: processed, total: total, pct: total ? round(processed / total, 4) : 0, pass: pass, fail: processed - pass };
  }
  function jobTiming(att) {
    var plan = PLANS[att.pipeline_job_id];
    return { plan: plan, term: terminalOf(att, plan), st: att.started_at, d: plan.durationMs };
  }
  function rootJobStatus(att, t) {
    if (!att.started_at) return att.status === 'CANCELLED' ? 'CANCELLED' : 'PENDING';
    var tm = jobTiming(att);
    if (tm.term.at > t) return 'RUNNING';
    return tm.term.type === 'SUCCEEDED' ? 'SUCCEEDED' : tm.term.type === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
  }
  /** Full PipelineJobTree of an attempt at virtual time t (pure; derived from the plan). */
  function jobTree(wf, att, t) {
    t = t == null ? clock.now : t;
    var tm = jobTiming(att), plan = tm.plan, started = !!att.started_at, done = started && tm.term.at <= t, tau = started ? Math.min(t, tm.term.at) : 0;
    if (done && TREE_CACHE[att.pipeline_job_id] && TREE_CACHE[att.pipeline_job_id].at === tm.term.at) return TREE_CACHE[att.pipeline_job_id].tree;
    var hr = makeRng(hashStr(att.pipeline_job_id + '|res'));
    function build(job, status, startAt, endAt, parentJobId) {
      var jobId = att.pipeline_job_id + job.suffix, errOut = null;
      var nodes = [], children = [];
      job.nodes.forEach(function (nd) {
        var r = started ? nodeStatusAt(nd, tm.st, tm.d, tm.term, tau, done) : { status: att.status === 'CANCELLED' ? 'SKIPPED' : 'PENDING', start_at: null, end_at: null, frac: 0 };
        var lb = nodeLabels(nd), c = nd.kind === 'component' ? COMPONENTS[nd.component] : null;
        var cpuU = hr.int(38, 92), memU = hr.float(0.35, 0.82), gpuU = hr.int(55, 97);
        var res;
        if (c) res = { machineType: c.machineType, cpu: { cores: c.cpu, utilPct: 0 }, gpu: c.gpu ? { type: c.gpu.type, count: c.gpu.count, utilPct: 0 } : null, memory: { limitGb: c.memGb, usedGb: 0 } };
        else {
          var lv = flattenJob(nd.child).filter(function (x) { return x.kind === 'component'; }).map(function (x) { return COMPONENTS[x.component]; });
          var g = lv.filter(function (x) { return x.gpu; });
          res = { machineType: 'sub-pipeline (' + lv.length + ' components)', cpu: { cores: sum(lv.map(function (x) { return x.cpu; })), utilPct: 0 }, gpu: g.length ? { type: g[0].gpu.type, count: sum(g.map(function (x) { return x.gpu.count; })), utilPct: 0 } : null, memory: { limitGb: sum(lv.map(function (x) { return x.memGb; })), usedGb: 0 } };
        }
        if (r.start_at) {
          res.cpu.utilPct = r.status === 'RUNNING' ? cpuU : Math.round(cpuU * 0.8);
          res.memory.usedGb = round(res.memory.limitGb * memU, 1);
          if (res.gpu) res.gpu.utilPct = gpuU;
        }
        var node = {
          id: nd.id, kind: nd.kind, component: nd.component, ref: nd.ref ? { pipeline_id: nd.ref.pipeline, version: nd.ref.version } : null,
          child_job_id: nd.child ? jobId + '.' + nd.id : null, node_path: nd.key, label: lb.label, labelKo: lb.labelKo, deps: nd.deps.slice(),
          status: r.status, start_at: r.start_at, end_at: r.end_at, duration_ms: r.start_at ? (r.end_at || Math.round(tau)) - r.start_at : null,
          task_id: String(hashStr(jobId + nd.id)) + String(hashStr(nd.id + jobId)).slice(0, 9),
          progress: nodeProgress(wf, nd, r.frac), resources: res,
          image: c ? REGION + '-docker.pkg.dev/' + PROJECT + '/pipelines/' + c.image + ':' + job.pipeline_version : null,
          inputs: nodeInputs(wf, att, nd), outputs: nodeOutputs(wf, att, nd).map(function (o) { return Object.assign({}, o, { available: r.status === 'SUCCEEDED' }); }),
          error: null, description: c ? c.description : PIPE[nd.ref.pipeline].description, legacy_phase: nd.legacyPhase
        };
        if (r.status === 'FAILED' && plan.error) { node.error = { code: plan.error.code, category: plan.error.category, message: plan.error.message, path: plan.error.path }; errOut = node.error; }
        nodes.push(node);
        if (nd.child) {
          var pad = (tm.d || 0) * (nd.child.s - nd.s);
          var cs = r.start_at ? Math.round(r.start_at + pad) : null;
          if (cs && r.end_at && cs > r.end_at) cs = r.end_at;
          children.push(build(nd.child, r.status, cs, r.end_at ? Math.max(cs || 0, r.end_at - Math.round(pad)) : null, jobId));
        }
      });
      var edges = []; job.nodes.forEach(function (n) { n.deps.forEach(function (dd) { edges.push({ from: dd, to: n.id }); }); });
      var pr = nodes.length ? (job.suffix ? null : null) : null; void pr;
      var frac = startAt && tm.d ? clamp(((endAt || tau) - startAt) / Math.max(1, (job.e - job.s) * tm.d), 0, 1) : 0;
      if (status === 'SUCCEEDED') frac = 1;
      var tot = wf.input.utteranceCount;
      return {
        job_id: jobId, root_job_id: att.pipeline_job_id, parent_job_id: parentJobId, parent_node_id: job.parentNode ? job.parentNode.id : null, depth: job.depth,
        workflow_id: wf.workflow_id, attempt: att.attempt, language: wf.language, pipeline_id: job.pipeline_id, pipeline_version: job.pipeline_version, model_version: wf.model_version,
        vertex_resource: 'projects/' + PROJECT_NUM + '/locations/' + REGION + '/pipelineJobs/' + jobId,
        status: status, start_at: startAt, end_at: endAt, duration_ms: startAt ? (endAt || Math.round(tau)) - startAt : null,
        progress: { processed: Math.round(frac * tot), total: tot, pct: round(frac, 4) },
        nodes: nodes, edges: edges, children: children, error: errOut
      };
    }
    var rs = rootJobStatus(att, t);
    var rootEnd = done ? Math.round(tm.term.at) : null;
    var tree = build(plan.root, rs, att.started_at, rootEnd, null);
    if (done) TREE_CACHE[att.pipeline_job_id] = { at: tm.term.at, tree: tree };
    return tree;
  }
  function jobTreeList(tree, out) { out = out || []; out.push(tree); tree.children.forEach(function (c) { jobTreeList(c, out); }); return out; }
  /** LEGACY six-phase projection of the root job DAG (keeps GET /workflows/[id]/dag + current UI working). */
  function legacyDag(wf, att, rootNodes, finished) {
    return DAG_TEMPLATE.map(function (d) {
      var m = rootNodes.filter(function (n) { return n.legacy_phase === d.id; });
      var base = {
        id: d.id, label: d.label, labelKo: d.labelKo, deps: d.deps.slice(), status: finished ? 'SKIPPED' : 'PENDING', start_at: null, end_at: null, duration_ms: null,
        task_id: String(hashStr(att.pipeline_job_id + d.id)) + String(hashStr(d.id + att.pipeline_job_id)).slice(0, 9),
        progress: { processed: 0, total: wf.input.utteranceCount, pct: 0, pass: 0, fail: 0 },
        resources: { machineType: d.machineType, cpu: { cores: d.cpu, utilPct: 0 }, gpu: d.gpu ? { type: d.gpu.type, count: d.gpu.count, utilPct: 0 } : null, memory: { limitGb: d.memGb, usedGb: 0 } },
        image: REGION + '-docker.pkg.dev/' + PROJECT + '/pipelines/' + d.image + ':' + att.pipeline_version, inputs: [], outputs: [], error: null, description: d.description,
        mapped_nodes: m.map(function (n) { return n.id; })
      };
      if (!m.length) return base;
      var st = m.map(function (n) { return n.status; });
      base.status = st.indexOf('FAILED') >= 0 ? 'FAILED' : st.indexOf('RUNNING') >= 0 ? 'RUNNING' : st.every(function (s) { return s === 'SUCCEEDED'; }) ? 'SUCCEEDED'
        : st.indexOf('CANCELLED') >= 0 ? 'CANCELLED' : st.indexOf('SUCCEEDED') >= 0 ? (finished ? 'SUCCEEDED' : 'RUNNING') : st[0];
      var starts = m.map(function (n) { return n.start_at; }).filter(function (x) { return x != null; }), ends = m.map(function (n) { return n.end_at; }).filter(function (x) { return x != null; });
      base.start_at = starts.length ? Math.min.apply(null, starts) : null;
      base.end_at = base.status === 'RUNNING' || base.status === 'PENDING' ? null : ends.length ? Math.max.apply(null, ends) : null;
      base.duration_ms = base.start_at ? (base.end_at || Math.max.apply(null, m.map(function (n) { return n.start_at ? n.start_at + (n.duration_ms || 0) : 0; }))) - base.start_at : null;
      var lead = m[m.length - 1];
      base.progress = Object.assign({}, lead.progress);
      base.resources = lead.resources;
      if (lead.image) base.image = lead.image;
      base.inputs = m[0].inputs; base.outputs = [].concat.apply([], m.map(function (n) { return n.outputs; }));
      var fe = m.filter(function (n) { return n.error; })[0];
      if (fe) base.error = { code: fe.error.code, category: fe.error.category, message: fe.error.message };
      return base;
    });
  }
  function applyDag(wf, att, t) {
    var tree = jobTree(wf, att, t);
    var finished = tree.status !== 'RUNNING' && tree.status !== 'PENDING';
    var nodes = legacyDag(wf, att, tree.nodes, finished);
    if (!att.dag.length) nodes.forEach(function (n) { att.dag.push(n); });
    else nodes.forEach(function (n, i) { Object.assign(att.dag[i], n); });
    wf.dag = att.dag;
    var running = att.dag.filter(function (n) { return n.status === 'RUNNING'; });
    var failed = att.dag.filter(function (n) { return n.status === 'FAILED'; })[0];
    wf.current_node = failed ? failed.id : running.length ? running.map(function (n) { return n.id; }).sort(function (a, b) { return DAG_IDX[b] - DAG_IDX[a]; })[0] : null;
    // deepest running/failed leaf
    var best = null, bestJob = null;
    jobTreeList(tree).forEach(function (j) { j.nodes.forEach(function (n) { if (n.kind === 'component' && (n.status === 'RUNNING' || n.status === 'FAILED') && (!best || n.status === 'FAILED' || (best.status !== 'FAILED' && (n.start_at || 0) >= (best.start_at || 0)))) { best = n; bestJob = j; } }); });
    wf.current_node_path = best ? best.node_path : null; wf.current_job_id = bestJob ? bestJob.job_id : null;
    var plan = PLANS[att.pipeline_job_id];
    if (att.started_at && plan) {
      var frac = clamp((Math.min(t, terminalOf(att, plan).at) - att.started_at) / plan.durationMs, 0, 1);
      if (att.status === 'SUCCEEDED') frac = 1;
      wf.progress = { processed: Math.round(frac * wf.input.utteranceCount), total: wf.input.utteranceCount, pct: round(frac, 4) };
    }
  }

  // ───────────────────────────────────────────── progress / node events ──
  function jobCtx(att, nd) {
    var job = nd.job;
    return { job_id: att.pipeline_job_id + job.suffix, pipeline_id: job.pipeline_id, pipeline_version: job.pipeline_version, node_path: nd.key, depth: job.depth };
  }
  function childCtx(att, nd) { var c = nd.child; return { job_id: att.pipeline_job_id + c.suffix, pipeline_id: c.pipeline_id, pipeline_version: c.pipeline_version, node_path: nd.key, depth: c.depth }; }
  function emitJob(wf, att, ctx, parentJobId, from, to, at, err) {
    emit('job', { job_id: ctx.job_id, root_job_id: att.pipeline_job_id, parent_job_id: parentJobId, workflow_id: wf.workflow_id, language: wf.language, pipeline_id: ctx.pipeline_id,
      pipeline_version: ctx.pipeline_version, node_path: ctx.node_path, depth: ctx.depth, from: from, to: to, at: Math.round(at), error_code: err ? err.code : null, error_path: err ? err.path : null });
  }
  function progressMsg(wf, nd, p) {
    var s = nd.id + ' ' + p.processed + '/' + p.total + ' (' + (p.pct * 100).toFixed(1) + '%)';
    var m = COMPONENTS[nd.component].metric;
    if (m === 'none') return s + ' valid=' + p.processed + ' rejected=0';
    if (m === 'latency') return s + ' p50=' + (1200 + (hashStr(wf.workflow_id) % 300)) + 'ms p95=' + (2300 + (hashStr(wf.workflow_id) % 700)) + 'ms over_8s=' + p.fail;
    if (m === 'response') return s + ' judged=' + p.processed + ' avg_score=' + (0.62 + 0.3 * (p.processed ? p.pass / p.processed : 0)).toFixed(2) + ' pass=' + p.pass + ' fail=' + p.fail;
    return s + ' pass=' + p.pass + ' fail=' + p.fail;
  }
  function syncAttempt(wf, att, t, live) {
    var plan = PLANS[att.pipeline_job_id];
    var em = EMITTED[att.pipeline_job_id] || (EMITTED[att.pipeline_job_id] = {});
    var term = terminalOf(att, plan), tau = Math.min(t, term.at), st = att.started_at, d = plan.durationMs, rootId = att.pipeline_job_id;
    var occ = [];
    plan.all.forEach(function (nd, i) {
      var s = st + d * nd.s, e = st + d * nd.e;
      if (s <= tau && s < term.at) occ.push({ at: s, kind: 'start', i: i });
      if (nd.kind === 'component' && !COMPONENTS[nd.component].persists) [0.25, 0.5, 0.75].forEach(function (q) { var at = s + q * (e - s); if (at <= tau && at < term.at) occ.push({ at: at, kind: 'progress', i: i, q: q }); });
      if (e <= tau && e <= term.at) occ.push({ at: e, kind: 'end', i: i });
    });
    var aggNode = plan.root.nodes.filter(function (n) { return n.legacyPhase === 'aggregate'; })[0];
    if (aggNode) { var ea = st + d * aggNode.s; if (ea <= tau && ea <= term.at) occ.push({ at: ea - 60, kind: 'evaldone' }); }
    occ.sort(function (a, b) { return a.at - b.at; });
    occ.forEach(function (o) {
      var key = o.kind + ':' + (o.i != null ? o.i : '') + ':' + (o.q || '');
      if (em[key]) return; em[key] = 1;
      var nd = o.i != null ? plan.all[o.i] : null, ctx = nd ? jobCtx(att, nd) : null;
      if (o.kind === 'start') {
        if (nd.kind === 'component') {
          var c = COMPONENTS[nd.component];
          addEvent(wf, 'TASK_' + c.ev + '_STARTED', o.at, { task: nd.id, component: nd.component, task_id: String(hashStr(ctx.job_id + nd.id)), machine_type: c.machineType, accelerator: c.gpu ? c.gpu.type + ' x' + c.gpu.count : null }, { att: att, job: ctx, component: nd.component });
          addLog(wf, o.at, 'INFO', 'vertex-ai-pipelines', 'Launching component ' + nd.id + ' (image ' + c.image + ':' + nd.job.pipeline_version + ', machine ' + c.machineType + (c.gpu ? ', ' + c.gpu.type : '') + ')' + (nd.job.depth ? ' in ' + ctx.job_id : ''), { component: nd.component, event_type: 'TASK_STARTED', att: att, job: ctx });
        } else {
          var cc = childCtx(att, nd);
          addEvent(wf, 'CHILD_PIPELINE_STARTED', o.at, { child_pipeline_job_id: cc.job_id, pipeline_id: cc.pipeline_id, pipeline_version: cc.pipeline_version, parent_node: nd.id, template_uri: 'gs://' + BUCKET_ART + '/' + templateObject(cc.pipeline_id, cc.pipeline_version) }, { att: att, job: cc });
          addLog(wf, o.at, 'INFO', 'vertex-ai-pipelines', 'Launching sub-pipeline ' + cc.pipeline_id + '@' + cc.pipeline_version + ' as PipelineJob ' + cc.job_id + ' (node ' + nd.key + ')', { component: nd.id, event_type: 'CHILD_PIPELINE_STARTED', att: att, job: cc });
          emitJob(wf, att, cc, ctx.job_id, 'PENDING', 'RUNNING', o.at, null);
        }
      } else if (o.kind === 'progress') {
        var fr = clamp((o.at - (st + d * nd.s)) / (d * (nd.e - nd.s)), 0, 1), p = nodeProgress(wf, nd, fr);
        addLog(wf, o.at, 'INFO', 'vertex-ai-pipelines', progressMsg(wf, nd, p), { component: nd.component, event_type: 'TASK_PROGRESS', att: att, job: ctx, labels: { progress_pct: String(Math.round(o.q * 100)) } });
        if (o.q === 0.5) {
          var c2 = COMPONENTS[nd.component], hr = makeRng(hashStr(ctx.job_id + nd.id + '|m'));
          addLog(wf, o.at + 350, 'DEBUG', 'vertex-ai-pipelines', 'resource usage cpu=' + hr.int(38, 92) + '% mem=' + round(c2.memGb * hr.float(0.35, 0.82), 1) + 'GiB/' + c2.memGb + 'GiB' + (c2.gpu ? ' gpu=' + hr.int(55, 97) + '%' : ''), { component: nd.component, event_type: 'TASK_METRICS', att: att, job: ctx });
        }
      } else if (o.kind === 'end') {
        var dur = d * (nd.e - nd.s);
        if (nd.kind === 'component') {
          var c3 = COMPONENTS[nd.component], p3 = nodeProgress(wf, nd, 1);
          addEvent(wf, 'TASK_' + c3.ev + '_COMPLETED', o.at, { task: nd.id, component: nd.component, duration_ms: Math.round(dur), processed: p3.processed, pass: p3.pass, fail: p3.fail }, { att: att, job: ctx, component: nd.component });
          addLog(wf, o.at, 'INFO', 'vertex-ai-pipelines', nd.id + ' completed in ' + fmt.duration(dur, { style: 'short' }) + ': ' + progressMsg(wf, nd, p3).replace(nd.id + ' ', ''), { component: nd.component, event_type: 'TASK_COMPLETED', att: att, job: ctx, duration_ms: dur });
          nodeOutputs(wf, att, nd).forEach(function (out) {
            if (out.uri.indexOf('gs://' + BUCKET_ART + '/') === 0) addGcsObject(BUCKET_ART, out.uri.replace('gs://' + BUCKET_ART + '/', ''), out.sizeBytes || 1200, o.at + 200, /\.json$/.test(out.uri) ? 'application/json' : /\.csv$/.test(out.uri) ? 'text/csv' : 'application/x-ndjson', { pipeline_job_id: ctx.job_id, root_pipeline_job_id: rootId, pipeline_id: ctx.pipeline_id, task: nd.id, component: nd.component, node_path: nd.key }, wf.workflow_id);
          });
        } else {
          var cc2 = childCtx(att, nd);
          addEvent(wf, 'CHILD_PIPELINE_SUCCEEDED', o.at, { child_pipeline_job_id: cc2.job_id, pipeline_id: cc2.pipeline_id, pipeline_version: cc2.pipeline_version, duration_ms: Math.round(dur) }, { att: att, job: cc2 });
          addLog(wf, o.at, 'INFO', 'vertex-ai-pipelines', 'Sub-pipeline ' + cc2.pipeline_id + '@' + cc2.pipeline_version + ' (' + cc2.job_id + ') SUCCEEDED in ' + fmt.duration(dur, { style: 'short' }), { component: nd.id, event_type: 'CHILD_PIPELINE_SUCCEEDED', att: att, job: cc2, duration_ms: dur });
          emitJob(wf, att, cc2, ctx.job_id, 'RUNNING', 'SUCCEEDED', o.at, null);
        }
      } else if (o.kind === 'evaldone') {
        addEvent(wf, 'TASK_EVALUATION_COMPLETED', o.at, { tasks: plan.root.nodes.filter(function (n) { return n.legacyPhase && ['intent_eval', 'response_eval', 'latency_check'].indexOf(n.legacyPhase) >= 0; }).map(function (n) { return n.id; }) }, { att: att });
      }
    });
    if (term.at <= t && !em.term) {
      em.term = 1;
      // nodes state at the terminal instant (deepest first so child-job failures precede parents)
      var states = plan.all.map(function (nd) { return { nd: nd, r: nodeStatusAt(nd, st, d, term, term.at, true) }; }).reverse();
      if (term.type === 'FAILED') {
        var leaf = plan.failLeaf, lc = jobCtx(att, leaf), fc = COMPONENTS[leaf.component];
        addLog(wf, term.at - 40, 'ERROR', 'vertex-ai-pipelines', leaf.id + ' failed: ' + plan.error.message + ' [path ' + plan.error.path + ']', { component: leaf.component, event_type: 'TASK_FAILED', att: att, job: lc, error_code: plan.error.code, stack_trace: plan.error.trace });
        addEvent(wf, 'TASK_' + fc.ev + '_FAILED', term.at, { task: leaf.id, component: leaf.component, error_code: plan.error.code, error_category: plan.error.category, message: plan.error.message, path: plan.error.path }, { att: att, job: lc, component: leaf.component });
      }
      states.forEach(function (x) {
        var nd = x.nd, r = x.r;
        if (nd.kind === 'component' && r.status === 'CANCELLED') addLog(wf, term.at + 500, 'WARNING', 'vertex-ai-pipelines', nd.id + ' cancelled at ' + nodeProgress(wf, nd, r.frac).processed + '/' + wf.input.utteranceCount + ' (' + (term.type === 'TIMED_OUT' ? 'pipeline timeout' : term.type === 'CANCELLED' ? 'pipeline cancel' : 'sibling failure ' + plan.error.path) + ')', { component: nd.component, event_type: 'TASK_CANCELLED', att: att, job: jobCtx(att, nd) });
        if (nd.kind === 'subpipeline' && (r.status === 'FAILED' || r.status === 'CANCELLED')) {
          var cc3 = childCtx(att, nd), failed = r.status === 'FAILED';
          addEvent(wf, failed ? 'CHILD_PIPELINE_FAILED' : 'CHILD_PIPELINE_CANCELLED', term.at + (failed ? 200 : 600) + nd.job.depth, { child_pipeline_job_id: cc3.job_id, pipeline_id: cc3.pipeline_id, pipeline_version: cc3.pipeline_version, error_code: failed ? plan.error.code : null, path: failed ? plan.error.path : null }, { att: att, job: cc3 });
          addLog(wf, term.at + (failed ? 250 : 650), failed ? 'ERROR' : 'WARNING', 'vertex-ai-pipelines', 'Sub-pipeline ' + cc3.pipeline_id + '@' + cc3.pipeline_version + ' (' + cc3.job_id + ') ' + (failed ? 'FAILED: ' + plan.error.code + ' at ' + plan.error.path : 'CANCELLED'), { component: nd.id, event_type: failed ? 'CHILD_PIPELINE_FAILED' : 'CHILD_PIPELINE_CANCELLED', att: att, job: cc3, error_code: failed ? plan.error.code : null });
          emitJob(wf, att, cc3, jobCtx(att, nd).job_id, 'RUNNING', r.status, term.at, failed ? plan.error : null);
        }
      });
    }
    applyDag(wf, att, t);
    if (live && term.at > t) {
      plan.leaves.forEach(function (nd) {
        var r = nodeStatusAt(nd, st, d, term, t, false);
        if (r.status === 'RUNNING' && !COMPONENTS[nd.component].persists) addLog(wf, t, 'INFO', 'vertex-ai-pipelines', progressMsg(wf, nd, nodeProgress(wf, nd, r.frac)), { component: nd.component, event_type: 'TASK_PROGRESS', att: att, job: jobCtx(att, nd) });
      });
    }
    return term.at <= t ? term : null;
  }

  // ───────────────────────────────────────────── lifecycle steps ──
  function newAttempt(wf, plan, t, status) {
    var n = wf.attempts.length + 1;
    var jobId = wf.workflow_id + '-cycle-' + wf.replay_cycle + '-attempt-' + n;
    var exec = makeRng(hashStr(jobId)).uuid();
    var att = {
      attempt: n, pipeline_job_id: jobId, workflow_execution_id: 'projects/' + PROJECT + '/locations/' + REGION + '/workflows/pipeline-orchestrator/executions/' + exec,
      vertex_resource: 'projects/' + PROJECT_NUM + '/locations/' + REGION + '/pipelineJobs/' + jobId, pipeline_id: plan.pipeline_id, pipeline_version: wf.pipeline_version,
      status: status, created_at: Math.round(t), started_at: null, completed_at: null, duration_ms: null,
      error_code: null, error_category: null, error_message: null, failed_node: null, failed_path: null, failed_node_path: null, failed_component: null, failed_job_id: null,
      backoffSec: null, retry_at: null, dag: [], job_ids: plan.jobs.map(function (j) { return jobId + j.suffix; })
    };
    PLANS[jobId] = plan;
    wf.attempts.push(att); wf.attempt = n; wf.pipeline_job_id = jobId; wf.workflow_execution_id = att.workflow_execution_id;
    applyDag(wf, att, t);
    return att;
  }
  function reserve(wf, t) {
    var r = { reservation_id: 'rsv-' + kstCompact(t) + '-' + G.hex(6), workflow_id: wf.workflow_id, language: wf.language, slot_weight: 1, status: 'ACTIVE', attempt: wf.attempts.length + 1,
      lease_expires_at: Math.round(t + config.reservationLeaseMin * MIN), fencing_token: ++FENCE, created_at: Math.round(t), updated_at: Math.round(t), released_at: null };
    RESERVATIONS.push(r); wf.reservation_id = r.reservation_id;
    return r;
  }
  function release(wf, t) {
    RESERVATIONS.forEach(function (r) { if (r.workflow_id === wf.workflow_id && r.status === 'ACTIVE') { r.status = 'RELEASED'; r.released_at = Math.round(t); r.updated_at = Math.round(t); } });
    var l = LANG[wf.language];
    addEvent(wf, 'CAPACITY_RELEASED', t, { reservation_id: wf.reservation_id, language_active: Math.max(0, BUILDING ? G.int(1, l.maxConcurrent - 1) : activeCount(wf.language)) + '/' + l.maxConcurrent });
  }
  function eventSchema(wf) {
    return { event_id: wf.event_id, event_type: wf.event_type, event_version: '1.0', workflow_id: wf.workflow_id, batch_id: wf.batch_id, language: wf.language,
      source: { bucket: wf.input.bucket, object: wf.input.object, generation: wf.input.generation }, pipeline_version: wf.pipeline_version, priority: wf.priority,
      idempotency_key: wf.idempotency_key, correlation_id: wf.correlation_id, replay_cycle_id: wf.replay_cycle ? wf.replay_cycle : null, replay_of: wf.replay_of };
  }
  function stepReceived(wf, t) {
    wf.created_at = Math.round(t);
    if (!wf.replay_of) {
      var gt = t - G.int(500, 1300);
      var obj = addGcsObject(BUCKET_IN, wf.input.object, wf.input.sizeBytes, gt, 'application/x-ndjson', { language: wf.language, batch_id: wf.batch_id, utterance_count: String(wf.input.utteranceCount), source: 'bixby-prod-utterance-log', pii_scrubbed: 'true', schema: 'bixby-utterance/2.3' }, wf.workflow_id);
      obj.generation = wf.input.generation; obj.md5Hash = wf.input.md5Hash;
      addEvent(wf, 'GCS_OBJECT_FINALIZED', gt, { bucket: wf.input.bucket, name: wf.input.object, generation: wf.input.generation, size: String(wf.input.sizeBytes), contentType: 'application/x-ndjson', md5Hash: wf.input.md5Hash });
      addEvent(wf, 'EVENT_PUBLISHED', t - G.int(60, 320), { ce_type: 'google.cloud.storage.object.v1.finalized', ce_id: String(G.int(1e15, 9e15)), ce_source: '//storage.googleapis.com/projects/_/buckets/' + wf.input.bucket, trigger: 'projects/' + PROJECT + '/locations/' + REGION + '/triggers/gcs-utterance-finalized', subscription: 'eventarc-' + REGION + '-gcs-utterance-finalized-sub', delivery_attempt: 1 });
    } else {
      addEvent(wf, 'EVENT_PUBLISHED', t - G.int(60, 320), { topic: 'projects/' + PROJECT + '/topics/pipeline-replay-requested', message_id: String(G.int(1e15, 9e15)), delivery_attempt: 1 }, { source: 'pubsub' });
    }
    addEvent(wf, 'EVENT_RECEIVED', t, eventSchema(wf));
    addLog(wf, t, 'INFO', 'event-ingress', 'Received ' + (wf.replay_of ? 'replay request' : 'CloudEvent google.cloud.storage.object.v1.finalized') + ' for ' + wf.input.uri, { event_type: 'EVENT_RECEIVED' });
    setStatus(wf, 'RECEIVED', t);
  }
  function stepValidated(wf, t) {
    wf.validated_at = Math.round(t);
    addLog(wf, t - 120, 'DEBUG', 'event-ingress', 'idempotency_key=sha256(project_id+bucket+object+generation+pipeline_version)=' + wf.idempotency_key.slice(0, 16) + '… (no existing registration)', { event_type: 'IDEMPOTENCY_CHECK' });
    addEvent(wf, 'VALIDATION_COMPLETED', t, { schema: wf.event_type + '/1.0', checks: ['required_fields', 'language_enabled', 'object_exists', 'jsonl_header', 'pipeline_version_known', 'idempotency'], duplicate: false, idempotency_key: wf.idempotency_key, utterance_count: wf.input.utteranceCount, firestore_doc: 'workflows/' + wf.workflow_id });
    addLog(wf, t, 'INFO', 'event-ingress', 'Validation passed (6 checks); registered workflows/' + wf.workflow_id + ' (' + wf.input.utteranceCount + ' utterances, ' + fmt.bytes(wf.input.sizeBytes) + ')', { event_type: 'VALIDATION_COMPLETED', duration_ms: t - wf.created_at });
    setStatus(wf, 'VALIDATED', t);
  }
  function stepQueued(wf, t) {
    wf.queued_at = Math.round(t);
    var backlog = BUILDING ? G.int(0, wf.language === 'ko' ? 9 : 2) : WORKFLOWS.filter(function (w) { return w.language === wf.language && w.status === 'QUEUED'; }).length;
    addEvent(wf, 'QUEUED', t, { queue: 'pending_jobs/' + wf.language, job_id: 'job-' + wf.workflow_id.slice(3), priority: wf.priority, position: backlog + 1 });
    addLog(wf, t, 'INFO', 'scheduler', 'Enqueued into ' + wf.language + ' pending queue (position ' + (backlog + 1) + ', priority ' + wf.priority + ')', { event_type: 'QUEUED' });
    setStatus(wf, 'QUEUED', t);
  }
  function stepReserved(wf, t) {
    wf.reserved_at = Math.round(t); wf.waitMs = wf.reserved_at - wf.queued_at;
    var r = reserve(wf, t), l = LANG[wf.language];
    var la = BUILDING ? G.int(1, l.maxConcurrent) : activeCount(wf.language) + 1, ga = BUILDING ? G.int(8, 30) : activeCount() + 1;
    addEvent(wf, 'CAPACITY_RESERVED', t, { reservation_id: r.reservation_id, slot_weight: 1, fencing_token: r.fencing_token, lease_expires_at: isoKst(r.lease_expires_at), language_active: la + '/' + l.maxConcurrent, global_active: ga + '/' + config.global.maxConcurrent, waited_ms: wf.waitMs });
    addLog(wf, t, 'INFO', 'scheduler', 'Admission granted: ' + wf.language + ' active ' + la + '/' + l.maxConcurrent + ', global ' + ga + '/' + config.global.maxConcurrent + ', waited ' + fmt.duration(wf.waitMs, { style: 'short' }) + ' (fencing_token=' + r.fencing_token + ')', { event_type: 'CAPACITY_RESERVED', duration_ms: wf.waitMs });
    setStatus(wf, 'RESERVED', t);
  }
  function stepDispatching(wf, t, plan) {
    var att = newAttempt(wf, plan, t, 'DISPATCHING');
    addEvent(wf, 'WORKFLOW_STARTED', t, { workflow: 'pipeline-orchestrator', revision: '000017-a3f', execution_id: att.workflow_execution_id }, { att: att });
    addEvent(wf, 'PIPELINE_SUBMITTED', t + G.int(300, 900), { pipeline_job_id: att.pipeline_job_id, pipeline_id: att.pipeline_id, pipeline_version: wf.pipeline_version, template_uri: 'gs://' + BUCKET_ART + '/' + templateObject(att.pipeline_id, wf.pipeline_version), child_jobs: att.job_ids.length - 1, service_account: 'sa-vertex-pipeline@' + PROJECT + '.iam.gserviceaccount.com', pipeline_root: 'gs://' + BUCKET_ART + '/pipeline_root' }, { att: att });
    addLog(wf, t + 200, 'INFO', 'dispatcher', 'Creating PipelineJob ' + att.pipeline_job_id + ' (template ' + att.pipeline_id + '@' + wf.pipeline_version + ', ' + (att.job_ids.length - 1) + ' sub-pipeline jobs, deterministic id; checking existing job first)', { event_type: 'PIPELINE_SUBMITTED', att: att });
    setStatus(wf, 'DISPATCHING', t);
    return att;
  }
  function stepPipelineStarted(wf, att, t) {
    att.status = 'RUNNING'; att.started_at = Math.round(t);
    if (!wf.started_at) wf.started_at = att.started_at;
    addEvent(wf, 'PIPELINE_STARTED', t, { pipeline_job_id: att.pipeline_job_id, state: 'PIPELINE_STATE_RUNNING', resource_name: att.vertex_resource }, { att: att });
    addLog(wf, t, 'INFO', 'pipeline-orchestrator', 'PipelineJob ' + att.pipeline_job_id + ' is RUNNING; polling every 30s', { event_type: 'PIPELINE_STARTED', att: att });
    setStatus(wf, 'RUNNING', t);
    applyDag(wf, att, t);
    emitJob(wf, att, { job_id: att.pipeline_job_id, pipeline_id: att.pipeline_id, pipeline_version: att.pipeline_version, node_path: null, depth: 0 }, null, 'PENDING', 'RUNNING', t, null);
  }
  function emitRootEnd(wf, att, to, t, err) { emitJob(wf, att, { job_id: att.pipeline_job_id, pipeline_id: att.pipeline_id, pipeline_version: att.pipeline_version, node_path: null, depth: 0 }, null, 'RUNNING', to, t, err); }
  function stepRetryStart(wf, t, plan) {
    var prev = wf.attempts[wf.attempts.length - 1];
    addEvent(wf, 'RETRY_STARTED', t, { previous_attempt: prev.attempt, next_attempt: prev.attempt + 1, previous_error: prev.error_code });
    var r = reserve(wf, t + 200), l = LANG[wf.language];
    addEvent(wf, 'CAPACITY_RESERVED', t + 200, { reservation_id: r.reservation_id, slot_weight: 1, fencing_token: r.fencing_token, language_active: (BUILDING ? G.int(1, l.maxConcurrent) : activeCount(wf.language) + 1) + '/' + l.maxConcurrent, retry: true });
    var att = newAttempt(wf, plan, t + 600, 'DISPATCHING');
    addEvent(wf, 'PIPELINE_SUBMITTED', t + 900, { pipeline_job_id: att.pipeline_job_id, attempt: att.attempt }, { att: att });
    addLog(wf, t + 300, 'WARNING', 'pipeline-orchestrator', 'Retrying after ' + prev.error_code + ' (attempt ' + att.attempt + '/' + config.retry.maxAttempts + ', backoff ' + prev.backoffSec + 's elapsed)', { event_type: 'RETRY_STARTED', att: att });
    wf.retry_at = null;
    stepPipelineStarted(wf, att, t + 2500);
    return att;
  }
  function finishAttempt(wf, att, term) {
    var plan = PLANS[att.pipeline_job_id], t = term.at;
    att.completed_at = Math.round(t); att.duration_ms = att.completed_at - att.started_at;
    wf.runMs = (wf.runMs || 0) + att.duration_ms;
    if (term.type === 'SUCCEEDED') {
      att.status = 'SUCCEEDED';
      addEvent(wf, 'PIPELINE_SUCCEEDED', t, { pipeline_job_id: att.pipeline_job_id, state: 'PIPELINE_STATE_SUCCEEDED', duration_ms: att.duration_ms }, { att: att });
      emitRootEnd(wf, att, 'SUCCEEDED', t, null);
      var rows = finalizeRows(wf, att);
      var csv = toCSV(rows), size = utf8Len(csv), uris = resultUris(wf);
      var pc = rows.filter(function (r) { return r.result === 'PASS'; }).length;
      var t1 = t + G.int(900, 2600), t2 = t1 + G.int(1500, 4200), t3 = t2 + G.int(200, 600);
      addGcsObject(BUCKET_RES, uris.csv.replace('gs://' + BUCKET_RES + '/', ''), size, t1, 'text/csv; charset=utf-8', { workflow_id: wf.workflow_id, pipeline_job_id: att.pipeline_job_id, pipeline_id: wf.pipeline_id, pipeline_version: wf.pipeline_version, model_version: wf.model_version, rows: String(rows.length) }, wf.workflow_id);
      addGcsObject(BUCKET_RES, uris.summary.replace('gs://' + BUCKET_RES + '/', ''), 1800 + G.int(0, 600), t1 + 150, 'application/json', { workflow_id: wf.workflow_id }, wf.workflow_id);
      wf.result = { uri: uris.csv, summaryUri: uris.summary, sizeBytes: size, rows: rows.length, passCount: pc, failCount: rows.length - pc, passRate: rows.length ? round(pc / rows.length, 4) : 0, bqTable: BQ_TABLE, committed_at: Math.round(t2) };
      addEvent(wf, 'RESULT_COMMITTED', t1, { uri: uris.csv, rows: rows.length, size_bytes: size, pass: pc, fail: rows.length - pc });
      addLog(wf, t1, 'INFO', 'result-commit', 'Uploaded ' + uris.csv + ' (' + rows.length + ' rows, ' + fmt.bytes(size) + ')', { event_type: 'RESULT_COMMITTED', duration_ms: t1 - t });
      addEvent(wf, 'BIGQUERY_COMMITTED', t2, { table: BQ_TABLE, rows_inserted: rows.length, job_id: 'bqjob_r' + G.hex(12) + '_0000019' + G.hex(9) });
      addLog(wf, t2, 'INFO', 'result-commit', 'BigQuery load job DONE: ' + rows.length + ' rows → ' + BQ_TABLE + ' (pass_rate=' + fmt.pct(pc / Math.max(1, rows.length)) + ')', { event_type: 'BIGQUERY_COMMITTED', duration_ms: t2 - t1 });
      release(wf, t3);
      wf.completed_at = Math.round(t3 + 120); wf.totalMs = wf.completed_at - wf.created_at;
      addEvent(wf, 'WORKFLOW_COMPLETED', wf.completed_at, { status: 'SUCCEEDED', attempts: att.attempt, total_duration_ms: wf.totalMs, pass_rate: wf.result.passRate, topic: 'projects/' + PROJECT + '/topics/pipeline-batch-completed' });
      wf.error = null; wf.current_node = null;
      setStatus(wf, 'SUCCEEDED', wf.completed_at);
      return;
    }
    if (term.type === 'FAILED') {
      var e = plan.error;
      att.status = 'FAILED'; att.error_code = e.code; att.error_category = e.category; att.error_message = e.message; att.failed_node = e.node;
      att.failed_path = e.path; att.failed_node_path = e.node_path; att.failed_component = e.component; att.failed_job_id = att.pipeline_job_id + (e.job_suffix || '');
      wf.error = { code: e.code, category: e.category, message: e.message, node: e.node, attempt: att.attempt, path: e.path, node_path: e.node_path, component: e.component, pipeline_job_id: att.failed_job_id };
      emitRootEnd(wf, att, 'FAILED', t, e);
      addEvent(wf, 'PIPELINE_FAILED', t + 600, { pipeline_job_id: att.pipeline_job_id, state: 'PIPELINE_STATE_FAILED', failed_task: e.node, failed_component: e.component, failed_path: e.path, failed_job_id: att.failed_job_id, error_code: e.code, error_category: e.category, message: e.message }, { att: att });
      addLog(wf, t + 900, 'ERROR', 'pipeline-orchestrator', 'PipelineJob ' + att.pipeline_job_id + ' FAILED at ' + e.path + ': ' + e.code + ' → classified ' + e.category + ' (' + failureCategoryMeta[e.category].policy + ')', { event_type: 'PIPELINE_FAILED', error_code: e.code, att: att });
      release(wf, t + 1400);
      var cm = failureCategoryMeta[e.category];
      var maxAtt = cm.retryable ? (cm.maxRetries != null ? cm.maxRetries + 1 : config.retry.maxAttempts) : 1;
      if (att.attempt < maxAtt) {
        var b = config.retry.backoffSeconds[Math.min(att.attempt - 1, config.retry.backoffSeconds.length - 1)];
        att.backoffSec = b; att.retry_at = Math.round(t + b * 1000); wf.retry_at = att.retry_at;
        addEvent(wf, 'RETRY_SCHEDULED', t + 1600, { next_attempt: att.attempt + 1, backoff_seconds: b, retry_at: isoKst(att.retry_at), error_code: e.code });
        addLog(wf, t + 1600, 'WARNING', 'pipeline-orchestrator', 'Retry scheduled: attempt ' + (att.attempt + 1) + '/' + config.retry.maxAttempts + ' in ' + b + 's (slot released; will re-enter admission)', { event_type: 'RETRY_SCHEDULED', error_code: e.code, att: att });
        setStatus(wf, 'RETRY_WAIT', t + 1600);
      } else {
        var reason = cm.retryable ? 'max attempts (' + att.attempt + ') exhausted' : 'non-retryable ' + e.category;
        addLog(wf, t + 1700, 'ERROR', 'pipeline-orchestrator', 'Routing to DLQ: ' + reason, { event_type: 'DEAD_LETTER_ROUTED', error_code: e.code, att: att });
        var dl = createDeadLetter(wf, att, t + 2100);
        addEvent(wf, 'DEAD_LETTER_PUBLISHED', t + 2100, { dead_letter_id: dl.dead_letter_id, topic: 'projects/' + PROJECT + '/topics/pipeline-dead-letter', failure_category: e.category, error_code: e.code, attempts: att.attempt });
        addLog(wf, t + 2300, 'WARNING', 'dlq-manager', 'Dead letter ' + dl.dead_letter_id + ' stored (status PENDING_REVIEW, category ' + e.category + ')', { event_type: 'DEAD_LETTER_STORED', error_code: e.code, att: att });
        wf.completed_at = Math.round(t + 2300); wf.totalMs = wf.completed_at - wf.created_at;
        setStatus(wf, 'DEAD_LETTERED', t + 2300);
      }
      return;
    }
    if (term.type === 'TIMED_OUT') {
      att.status = 'TIMED_OUT'; att.error_code = 'PIPELINE_TIMEOUT'; att.error_category = 'TIMEOUT'; att.error_message = plan.error.message;
      wf.error = { code: 'PIPELINE_TIMEOUT', category: 'TIMEOUT', message: plan.error.message, node: wf.current_node, attempt: att.attempt, path: null, node_path: wf.current_node_path, component: null, pipeline_job_id: att.pipeline_job_id };
      emitRootEnd(wf, att, 'FAILED', t, { code: 'PIPELINE_TIMEOUT', path: null });
      addEvent(wf, 'PIPELINE_TIMEOUT', t, { pipeline_job_id: att.pipeline_job_id, timeout_min: config.pipelineTimeoutMin }, { att: att });
      addLog(wf, t, 'ERROR', 'pipeline-orchestrator', 'PipelineJob exceeded ' + config.pipelineTimeoutMin + 'm; sending cancel', { event_type: 'PIPELINE_TIMEOUT', error_code: 'PIPELINE_TIMEOUT', att: att });
      var tc = t + G.int(25000, 70000);
      addEvent(wf, 'PIPELINE_CANCEL_CONFIRMED', tc, { pipeline_job_id: att.pipeline_job_id, state: 'PIPELINE_STATE_CANCELLED' }, { att: att });
      addLog(wf, tc, 'WARNING', 'pipeline-orchestrator', 'Cancel confirmed by Vertex AI. Remaining workflow budget ' + (config.workflowTimeoutMin - config.pipelineTimeoutMin) + 'm < expected runtime → no retry', { event_type: 'PIPELINE_CANCEL_CONFIRMED', att: att });
      release(wf, tc + 400);
      wf.completed_at = Math.round(tc + 600); wf.totalMs = wf.completed_at - wf.created_at;
      addEvent(wf, 'WORKFLOW_TIMED_OUT', wf.completed_at, { workflow_timeout_min: config.workflowTimeoutMin });
      setStatus(wf, 'TIMED_OUT', wf.completed_at);
      return;
    }
    if (term.type === 'CANCELLED') {
      att.status = 'CANCELLED';
      emitRootEnd(wf, att, 'CANCELLED', t, null);
      if (!wf.cancel_requested_at) requestCancelEvents(wf, t - 1500, wf.cancelled_by || 'op-park-jh', wf.cancel_reason || '운영자 요청');
      var tc2 = t + G.int(8000, 30000);
      addEvent(wf, 'PIPELINE_CANCEL_CONFIRMED', tc2, { pipeline_job_id: att.pipeline_job_id, state: 'PIPELINE_STATE_CANCELLED' }, { att: att });
      release(wf, tc2 + 300);
      wf.completed_at = Math.round(tc2 + 500); wf.totalMs = wf.completed_at - wf.created_at;
      addEvent(wf, 'WORKFLOW_CANCELLED', wf.completed_at, { cancelled_by: wf.cancelled_by, reason: wf.cancel_reason });
      setStatus(wf, 'CANCELLED', wf.completed_at);
    }
  }
  function requestCancelEvents(wf, t, by, reason) {
    wf.cancel_requested_at = Math.round(t); wf.cancelled_by = by; wf.cancel_reason = reason;
    addEvent(wf, 'CANCEL_REQUESTED', t, { requested_by: by, reason: reason, event_type: 'pipeline.batch.cancel.requested' });
    addLog(wf, t, 'WARNING', 'operations-api', 'Cancel requested by ' + (OP[by] ? OP[by].name : by) + ': ' + reason, { event_type: 'CANCEL_REQUESTED' });
  }
  function cancelBeforeRun(wf, t, by, reason) {
    requestCancelEvents(wf, t, by, reason);
    if (ACTIVE_STATES.indexOf(wf.status) >= 0) release(wf, t + 300);
    wf.completed_at = Math.round(t + 600); wf.totalMs = wf.completed_at - wf.created_at;
    addEvent(wf, 'WORKFLOW_CANCELLED', wf.completed_at, { cancelled_by: by, reason: reason, removed_from_queue: true });
    setStatus(wf, 'CANCELLED', wf.completed_at);
  }
  function stampRows(wf, rows) {
    var att = null;
    for (var i = wf.attempts.length - 1; i >= 0; i--) if (wf.attempts[i].status === 'SUCCEEDED') { att = wf.attempts[i]; break; }
    if (!att || !att.started_at) return rows;
    var plan = PLANS[att.pipeline_job_id];
    var ev = plan.root.nodes.filter(function (n) { return n.legacyPhase === 'response_eval'; })[0] || plan.root.nodes.filter(function (n) { return n.legacyPhase === 'intent_eval'; })[0] || plan.root.nodes[Math.min(1, plan.root.nodes.length - 1)];
    var s = att.started_at + plan.durationMs * ev.s, e = att.started_at + plan.durationMs * ev.e;
    rows.forEach(function (r, i) {
      r.pipeline_job_id = att.pipeline_job_id;
      r.eval_ts = Math.round(s + (e - s) * (i + 0.5) / rows.length);
      r.eval_timestamp = isoKst(r.eval_ts);
    });
    Object.defineProperty(rows, '_stamped', { value: true, enumerable: false });
    return rows;
  }
  /** Result rows of a SUCCEEDED workflow (derived lazily, deterministic, LRU-cached). */
  function rowsFor(wf) {
    if (!wf || wf.status !== 'SUCCEEDED') return [];
    var rows = genUtterances(wf);
    return rows._stamped ? rows : stampRows(wf, rows);
  }
  function finalizeRows(wf, att) {
    void att;
    var rows = genUtterances(wf);
    var tmp = wf.status; wf.status = 'SUCCEEDED';
    try { return rows._stamped ? rows : stampRows(wf, rows); } finally { wf.status = tmp; }
  }
  /** Succeeded workflows whose evaluation window may overlap [from, to]. */
  function succeededBetween(from, to) {
    return WORKFLOWS.filter(function (w) { return w.status === 'SUCCEEDED' && w.started_at != null && w.started_at <= to && w.completed_at >= from; });
  }
  function rowsInRange(from, to) {
    var out = [];
    succeededBetween(from, to).forEach(function (w) { var rs = rowsFor(w); for (var i = 0; i < rs.length; i++) { var t = rs[i].eval_ts; if (t >= from && t <= to) out.push(rs[i]); } });
    return out;
  }
  function todayRows() { return rowsInRange(kstDayStart(clock.now), clock.now); }

  // ───────────────────────────────────────────── DLQ ──
  function createDeadLetter(wf, att, t) {
    var seq = ++DLQ_SEQ;
    var errLogs = LOGS_BY_WF[wf.workflow_id].filter(function (l) { return l.severity === 'ERROR' || l.severity === 'WARNING'; }).slice(-4);
    var dl = {
      dead_letter_id: 'dlq-' + kstCompact(t) + '-' + pad(seq, 3), workflow_id: wf.workflow_id, original_event_id: wf.event_id, language: wf.language, batch_id: wf.batch_id,
      failure_category: att.error_category, error_code: att.error_code, failure_reason: att.error_message, failed_node: att.failed_node,
      failed_path: att.failed_path, failed_component: att.failed_component, failed_job_id: att.failed_job_id, attempts: att.attempt,
      pipeline_id: wf.pipeline_id, pipeline_version: wf.pipeline_version, model_version: wf.model_version, input_uri: wf.input.uri, utterance_count: wf.input.utteranceCount, last_execution_id: att.workflow_execution_id, last_pipeline_job_id: att.pipeline_job_id,
      status: 'PENDING_REVIEW', assigned_operator: null, created_at: Math.round(t), updated_at: Math.round(t),
      last_log_excerpt: errLogs.map(function (l) { return fmt.timeMs(l.ts) + ' ' + l.severity + ' [' + l.component + '] ' + l.message; }).join('\n'),
      last_stack_trace: att.error_category && PLANS[att.pipeline_job_id].error ? PLANS[att.pipeline_job_id].error.trace : null,
      attempt_history: wf.attempts.map(function (a) { return { attempt: a.attempt, pipeline_job_id: a.pipeline_job_id, status: a.status, error_code: a.error_code, started_at: a.started_at, completed_at: a.completed_at }; }),
      replay_ids: [], resolution: null, notes: []
    };
    DLQ.push(dl); wf.dead_letter_id = dl.dead_letter_id;
    emit('dlq', dl);
    return dl;
  }

  // ───────────────────────────────────────────── static scenario ──
  function verFor(day) {
    if (day === 0) return R.chance(0.5) ? 'v1.2-rc' : 'v1.1';
    if (day === 1) return R.chance(0.3) ? 'v1.2-rc' : 'v1.1';
    if (day <= 4) return R.chance(0.85) ? 'v1.1' : 'v1.0';
    if (day <= 6) return R.chance(0.6) ? 'v1.0' : 'v1.1';
    return 'v1.0';
  }
  var SPECS = [];
  function spec(lang, status, day, attempts, o) {
    o = o || {};
    var s = { lang: lang, status: status, day: day, attempts: attempts || [['SUCCEEDED']], version: o.version || verFor(day), priority: o.priority || (R.chance(0.12) ? 7 : R.chance(0.1) ? 3 : 5),
      cancel: o.cancel || null, dlq: o.dlq || null, replayOf: o.replayOf || null, replayCycle: o.replayCycle || 0, tag: o.tag || null, pipeline: o.pipeline || null, nightly: !!o.nightly };
    s.utteranceCount = o.utteranceCount || (day > 0 && R.chance(0.1) ? Math.round(LANG[lang].batchSize * R.float(0.35, 0.95)) : LANG[lang].batchSize);
    SPECS.push(s);
    return s;
  }
  var S1 = [['SUCCEEDED']];
  function F(cat, n, last) { var a = []; for (var i = 0; i < n; i++) a.push(['FAILED', cat]); if (last) a.push([last]); return a; }

  // — active (today) —
  for (var i0 = 0; i0 < 6; i0++) spec('ko', 'RUNNING', 0, i0 === 1 ? [['FAILED', 'MODEL_TRANSIENT']] : i0 === 4 ? F('MODEL_TRANSIENT', 1, 'SUCCEEDED') : S1);
  spec('en', 'RUNNING', 0, S1); spec('en', 'RUNNING', 0, S1); spec('en', 'RUNNING', 0, F('QUOTA', 1, 'SUCCEEDED'), { priority: 7 });
  spec('ja', 'RUNNING', 0, S1); spec('es', 'RUNNING', 0, S1);
  spec('ko', 'DISPATCHING', 0, S1); spec('ko', 'DISPATCHING', 0, S1);
  spec('ko', 'RESERVED', 0, S1); spec('ja', 'RESERVED', 0, S1);
  for (var i1 = 0; i1 < 10; i1++) spec('ko', 'QUEUED', 0, S1, { priority: i1 === 3 ? 7 : 5 });
  spec('en', 'QUEUED', 0, S1); spec('ja', 'QUEUED', 0, S1); spec('ja', 'QUEUED', 0, S1); spec('es', 'QUEUED', 0, S1);
  spec('ko', 'RETRY_WAIT', 0, F('PIPELINE_EXECUTION', 1)); spec('en', 'RETRY_WAIT', 0, F('MODEL_TRANSIENT', 2)); spec('ja', 'RETRY_WAIT', 0, F('QUOTA', 1));
  spec('en', 'RECEIVED', 0, S1); spec('ko', 'VALIDATED', 0, S1);
  // — today terminal —
  for (var i2 = 0; i2 < 12; i2++) spec('ko', 'SUCCEEDED', 0, (i2 === 2 || i2 === 7) ? F('MODEL_TRANSIENT', 1, 'SUCCEEDED') : S1, { version: i2 % 2 ? 'v1.2-rc' : 'v1.1' });
  for (var i3 = 0; i3 < 4; i3++) spec('en', 'SUCCEEDED', 0, i3 === 1 ? F('QUOTA', 1, 'SUCCEEDED') : S1, { version: i3 % 2 ? 'v1.2-rc' : 'v1.1' });
  for (var i4 = 0; i4 < 5; i4++) spec('ja', 'SUCCEEDED', 0, S1, { version: i4 < 3 ? 'v1.1' : 'v1.2-rc' });
  for (var i5 = 0; i5 < 3; i5++) spec('es', 'SUCCEEDED', 0, S1, { version: i5 < 2 ? 'v1.1' : 'v1.2-rc' });
  spec('ko', 'CANCELLED', 0, S1, { cancel: { mode: 'queued', by: 'op-park-jh', reason: '동일 배치 재업로드(입력 파일 교체)로 기존 요청 취소' } });
  // DLQ (14) — order fixed for narrative
  var D = [];
  D.push(spec('ko', 'DEAD_LETTERED', 0, F('CODE_DEFECT', 2), { version: 'v1.2-rc', dlq: { status: 'PENDING_REVIEW', op: 'op-park-jh' } }));
  D.push(spec('ko', 'DEAD_LETTERED', 0, F('MODEL_TRANSIENT', 3), { dlq: { status: 'PENDING_REVIEW' } }));
  D.push(spec('en', 'DEAD_LETTERED', 0, F('QUOTA', 3), { dlq: { status: 'PENDING_REVIEW', op: 'op-lee-he' } }));
  D.push(spec('ko', 'DEAD_LETTERED', 1, F('INPUT_SCHEMA', 1), { dlq: { status: 'PENDING_REVIEW', op: 'op-jung-yn' } }));
  D.push(spec('ja', 'DEAD_LETTERED', 1, F('MODEL_TRANSIENT', 3), { dlq: { status: 'PENDING_REVIEW' } }));
  D.push(spec('es', 'DEAD_LETTERED', 2, F('AUTH_PERMISSION', 1), { dlq: { status: 'PENDING_REVIEW', op: 'op-han-dy' } }));
  D.push(spec('ko', 'DEAD_LETTERED', 1, F('CODE_DEFECT', 2), { version: 'v1.1', dlq: { status: 'APPROVED', op: 'op-park-jh', by: 'op-park-jh', approver: 'op-kim-sy', reason: 'aggregate KeyError(smartthings.scene_run) 핫픽스 bixby-eval:1.1.3 배포 후 Replay 예정' } }));
  D.push(spec('ko', 'DEAD_LETTERED', 1, F('MODEL_TRANSIENT', 3), { dlq: { status: 'REPLAYING', op: 'op-park-jh', by: 'op-park-jh', approver: 'op-kim-sy', reason: 'Gemini 503 일시 장애 종료 확인 — 동일 입력 재실행' } }));
  D.push(spec('en', 'DEAD_LETTERED', 2, F('PIPELINE_EXECUTION', 3), { dlq: { status: 'REPLAYING', op: 'op-lee-he', by: 'op-lee-he', approver: 'op-han-dy', reason: 'intent_eval OOM — machineType n2-highmem-8 로 변경된 v1.1 템플릿으로 재실행' } }));
  D.push(spec('ko', 'DEAD_LETTERED', 3, F('QUOTA', 3), { dlq: { status: 'REPLAYED', op: 'op-park-jh', by: 'op-park-jh', approver: 'op-kim-sy', reason: 'INC-20261110-01 GPU 할당량 장애 복구 후 재실행' } }));
  D.push(spec('ja', 'DEAD_LETTERED', 4, F('TIMEOUT', 3), { dlq: { status: 'REPLAYED', op: 'op-lee-he', by: 'op-lee-he', approver: 'op-kim-sy', reason: 'heartbeat timeout — judge 동시성 축소 후 재실행' } }));
  D.push(spec('ko', 'DEAD_LETTERED', 5, F('PIPELINE_EXECUTION', 3), { version: 'v1.0', dlq: { status: 'REPLAYED', op: 'op-han-dy', by: 'op-han-dy', approver: 'op-kim-sy', reason: 'v1.0 집계 버그 — v1.1 로 버전 변경하여 Replay', replayVersion: 'v1.1' } }));
  D.push(spec('es', 'DEAD_LETTERED', 5, F('INPUT_SCHEMA', 1), { dlq: { status: 'CLOSED', op: 'op-jung-yn', resolution: '영구 실패 — 원천 로그 수집기의 필드 누락 배치. 수집팀에서 재생성 후 신규 배치로 업로드함 (원본 종료)' } }));
  D.push(spec('en', 'DEAD_LETTERED', 6, F('CODE_DEFECT', 2), { version: 'v1.0', dlq: { status: 'CLOSED', op: 'op-han-dy', resolution: 'v1.0 지원 종료 — 동일 입력은 v1.1 정기 배치에서 재평가됨' } }));
  // failures that originate two levels deep (response-judge → policy-guard)
  D.push(spec('en', 'DEAD_LETTERED', 0, [['FAILED', 'PIPELINE_EXECUTION', 0], ['FAILED', 'PIPELINE_EXECUTION', 0], ['FAILED', 'PIPELINE_EXECUTION', 0]], { version: 'v1.1', pipeline: 'bixby-eval-full', dlq: { status: 'PENDING_REVIEW' } }));
  spec('ko', 'RETRY_WAIT', 0, [['FAILED', 'MODEL_TRANSIENT', 0]], { version: 'v1.1', pipeline: 'bixby-regression-nightly' });
  // past cancelled / timed out
  spec('en', 'CANCELLED', 1, S1, { cancel: { mode: 'running', by: 'op-lee-he', reason: '잘못된 pipeline_version(v1.0)으로 요청됨' } });
  spec('ko', 'CANCELLED', 3, S1, { cancel: { mode: 'queued', by: 'op-park-jh', reason: '중복 업로드된 배치 (generation 상이)' } });
  spec('ja', 'CANCELLED', 5, S1, { cancel: { mode: 'running', by: 'op-kim-sy', reason: '모델 엔드포인트 점검 공지로 선제 취소' } });
  spec('ko', 'TIMED_OUT', 1, [['TIMED_OUT']]); spec('en', 'TIMED_OUT', 3, [['TIMED_OUT']]); spec('ko', 'TIMED_OUT', 6, [['TIMED_OUT']]);
  // past succeeded (56)
  for (var day = 1; day <= 7; day++) for (var k = 0; k < 8; k++) {
    var lang = R.weighted({ ko: 0.55, en: 0.22, ja: 0.13, es: 0.10 });
    var att = R.chance(0.1) ? F(R.weighted({ MODEL_TRANSIENT: 3, QUOTA: day === 3 ? 4 : 1, PIPELINE_EXECUTION: 1 }), 1, 'SUCCEEDED') : R.chance(0.03) ? F('MODEL_TRANSIENT', 2, 'SUCCEEDED') : S1;
    spec(lang, 'SUCCEEDED', day, att);
  }
  // — older history (days 8 … HISTORY_DAYS-1), lower density —
  var CLOSE_NOTES = ['영구 실패 — 원천 배치 재생성 후 신규 업로드로 대체 (원본 종료)', '동일 입력은 다음 정기 배치에서 재평가됨', '일시 장애 구간 배치 — 재평가 불필요로 종료'];
  for (var dd = 8; dd < HISTORY_DAYS; dd++) {
    var dw = kstParts(BASE_NOW - dd * DAY).dow, cnt = (dw === 0 || dw === 6) ? R.int(2, 3) : R.int(3, 5);
    for (var kk = 0; kk < cnt; kk++) {
      var lg = R.weighted({ ko: 0.55, en: 0.22, ja: 0.13, es: 0.10 }), xr = R.next();
      if (xr < 0.035) { var cat0 = R.weighted({ MODEL_TRANSIENT: 2, PIPELINE_EXECUTION: 2, INPUT_SCHEMA: 1 }); D.push(spec(lg, 'DEAD_LETTERED', dd, F(cat0, cat0 === 'INPUT_SCHEMA' ? 1 : 3), { dlq: { status: 'CLOSED', op: R.pick(['op-han-dy', 'op-park-jh', 'op-lee-he']), resolution: R.pick(CLOSE_NOTES) } })); }
      else if (xr < 0.055) spec(lg, 'TIMED_OUT', dd, [['TIMED_OUT']]);
      else if (xr < 0.07) spec(lg, 'CANCELLED', dd, S1, { cancel: { mode: 'queued', by: 'op-park-jh', reason: '중복 업로드된 배치 (generation 상이)' } });
      else spec(lg, 'SUCCEEDED', dd, R.chance(0.1) ? F(R.weighted({ MODEL_TRANSIENT: 3, PIPELINE_EXECUTION: 1 }), 1, 'SUCCEEDED') : S1);
    }
  }
  // — nightly regression (02:00 KST) —
  for (var nd0 = 1; nd0 < HISTORY_DAYS; nd0++) {
    spec('ko', 'SUCCEEDED', nd0, R.chance(0.08) ? F('MODEL_TRANSIENT', 1, 'SUCCEEDED') : S1, { pipeline: 'bixby-regression-nightly', nightly: true });
    if (nd0 % 2 === 0) spec('en', 'SUCCEEDED', nd0, S1, { pipeline: 'bixby-regression-nightly', nightly: true });
  }
  // replays (REPLAYING → active, REPLAYED → succeeded)
  D.forEach(function (d) {
    if (!d.dlq || ['REPLAYING', 'REPLAYED'].indexOf(d.dlq.status) < 0) return;
    var st = d.dlq.status === 'REPLAYED' ? 'SUCCEEDED' : (d.lang === 'ko' ? 'RUNNING' : 'QUEUED');
    d.replaySpec = spec(d.lang, st, d.dlq.status === 'REPLAYED' ? Math.max(1, d.day - 1) : 0, S1, { version: d.dlq.replayVersion || (d.version === 'v1.0' ? 'v1.1' : d.version), priority: 8, replayOf: d, replayCycle: 1, utteranceCount: d.utteranceCount });
  });

  // ── pipeline assignment (mixed registry) ──
  var PR = makeRng(31337);
  function assignPipeline(s) {
    if (s.replayOf) { s.pipeline = s.replayOf.pipeline && pipeVer(s.replayOf.pipeline, s.version) ? s.replayOf.pipeline : 'bixby-eval-full'; return; }
    if (s.pipeline && pipeVer(s.pipeline, s.version)) return;
    var cats = s.attempts.filter(function (a) { return a[0] === 'FAILED'; }).map(function (a) { return a[1]; });
    var cands = ROOT_PIPELINES.filter(function (p) {
      if (!pipeVer(p.id, s.version) || !p.mixWeight || p.id === 'bixby-regression-nightly') return false;
      if (p.languages && p.languages.indexOf(s.lang) < 0) return false;
      return cats.every(function (c) { return supportsCategory(p.id, s.version, c); });
    });
    s.pipeline = cands.length ? PR.weighted(cands.map(function (p) { return [p.id, p.mixWeight]; })) : 'bixby-eval-full';
  }
  SPECS.forEach(function (s) { if (!s.replayOf) assignPipeline(s); });
  SPECS.forEach(function (s) { if (s.replayOf) assignPipeline(s); });

  // ── planning: offsets relative to created, then anchor ──
  function planSpec(s) {
    var o = {}, rng = R;
    s.plans = s.attempts.map(function (a) { return makePlan(rng, s.lang, s.version, s.utteranceCount, a[0], a[1], a[2], s.pipeline); });
    o.validated = rng.int(250, 900); o.queued = o.validated + rng.int(60, 260);
    var wait = s.status === 'QUEUED' ? 0 : (s.lang === 'ko' ? rng.int(20, 480) : rng.int(3, 70)) * 1000;
    o.reserved = o.queued + wait; o.dispatch = o.reserved + rng.int(600, 1800);
    o.starts = []; o.ends = [];
    for (var i = 0; i < s.plans.length; i++) {
      o.starts[i] = i === 0 ? o.dispatch + rng.int(1800, 4200) : o.ends[i - 1] + config.retry.backoffSeconds[i - 1] * 1000 + rng.int(3500, 30000);
      o.ends[i] = o.starts[i] + planEndOffset(s.plans[i]);
    }
    var last = s.plans.length - 1;
    o.final = o.ends[last] + 12000;
    if (s.cancel && s.cancel.mode === 'queued') { o.cancelAt = o.queued + rng.int(2, 25) * MIN; o.final = o.cancelAt + 2000; }
    if (s.cancel && s.cancel.mode === 'running') { o.cancelAt = o.starts[0] + Math.round(planEndOffset(s.plans[0]) * rng.float(0.25, 0.7)); o.final = o.cancelAt + 40000; }
    var now = BASE_NOW, created;
    switch (s.status) {
      case 'RECEIVED': created = now - rng.int(300, 900); break;
      case 'VALIDATED': created = now - o.validated - rng.int(400, 1500); break;
      case 'QUEUED': created = now - o.queued - (s.lang === 'ko' ? rng.int(30, 38 * 60) : rng.int(8, 50)) * 1000; break;
      case 'RESERVED': created = now - o.reserved - rng.int(1000, 6000); break;
      case 'DISPATCHING': created = now - o.dispatch - rng.int(600, 3000); break;
      case 'RUNNING': created = now - o.starts[last] - Math.round(planEndOffset(s.plans[last]) * rng.float(0.04, 0.9)); break;
      case 'RETRY_WAIT': created = now - o.ends[last] - rng.int(8, config.retry.backoffSeconds[last] - 15) * 1000; break;
      default:
        if (s.replayOf) {
          var oe = s.replayOf.T.final;
          created = Math.min(oe + rng.int(60, 600) * MIN, now - o.final - 20 * MIN);
          if (created < oe + 20 * MIN) created = oe + 20 * MIN;
        } else if (s.nightly) {
          created = kstDayStart(now - s.day * DAY) + 2 * HOUR + rng.int(0, 25) * MIN;
        } else if (s.day === 0) {
          var lo = TODAY_START + 25 * MIN, hi = now - o.final - 3 * MIN;
          created = lo + rng.float(0, Math.max(0, hi - lo));
        } else {
          var ds = kstDayStart(now - s.day * DAY);
          created = ds + rng.float(0, (s.dlq ? 0.8 : 0.96) * DAY - o.final);
        }
    }
    s.created = Math.round(created);
    s.T = { created: s.created };
    Object.keys(o).forEach(function (k) { s.T[k] = Array.isArray(o[k]) ? o[k].map(function (x) { return s.created + x; }) : s.created + o[k]; });
    if (s.cancel && s.cancel.mode === 'running') s.plans[0].cancelAt = s.T.cancelAt;
  }
  SPECS.forEach(function (s) { if (!s.replayOf) planSpec(s); });
  SPECS.forEach(function (s) { if (s.replayOf) planSpec(s); });
  SPECS.sort(function (a, b) { return a.created - b.created; });

  function linkReplay(orig, wf, s) {
    var d = s.replayOf.dlq, dl = DLQ.filter(function (x) { return x.workflow_id === orig.workflow_id; })[0];
    var tReq = s.T.created - R.int(8, 50) * MIN, tApp = s.T.created - R.int(40, 280) * SEC;
    var rp = { replay_id: 'rpl-' + kstCompact(tReq) + '-' + pad(++REPLAY_SEQ, 3), dead_letter_id: dl.dead_letter_id, original_workflow_id: orig.workflow_id, replay_workflow_id: wf.workflow_id,
      replay_cycle: wf.replay_cycle, requested_by: d.by, approved_by: d.approver, reason: d.reason, pipeline_version_from: orig.pipeline_version, pipeline_version_to: wf.pipeline_version,
      status: 'QUEUED', created_at: Math.round(tReq), approved_at: Math.round(tApp), completed_at: null };
    REPLAYS.push(rp); dl.replay_ids.push(rp.replay_id); dl.status = 'REPLAYING'; dl.updated_at = Math.round(tApp); dl.assigned_operator = d.op || d.by;
    orig.replayed_by = wf.workflow_id;
    addEvent(orig, 'REPLAY_REQUESTED', tReq, { dead_letter_id: dl.dead_letter_id, replay_id: rp.replay_id, requested_by: d.by, reason: d.reason, pipeline_version: wf.pipeline_version, event_type: 'pipeline.batch.replay.requested' });
    addEvent(orig, 'REPLAY_APPROVED', tApp, { dead_letter_id: dl.dead_letter_id, replay_id: rp.replay_id, approved_by: d.approver, replay_workflow_id: wf.workflow_id, replay_cycle: wf.replay_cycle });
    addLog(orig, tApp, 'INFO', 'dlq-manager', 'Replay ' + rp.replay_id + ' approved by ' + OP[d.approver].name + ' → new workflow ' + wf.workflow_id + ' (cycle ' + wf.replay_cycle + ', ' + wf.pipeline_version + ')', { event_type: 'REPLAY_APPROVED', att: null });
    AUDIT.push(audit(tReq, d.by, 'DLQ_REPLAY_REQUESTED', dl.dead_letter_id, null, { replay_id: rp.replay_id, pipeline_version: wf.pipeline_version }, d.reason));
    AUDIT.push(audit(tApp, d.approver, 'DLQ_REPLAY_APPROVED', dl.dead_letter_id, { status: 'PENDING_REVIEW' }, { status: 'REPLAYING', replay_workflow_id: wf.workflow_id }, d.reason));
  }
  function audit(ts, actor, action, target, before, after, reason) {
    return { audit_id: 'aud-' + pad(++AUDIT_SEQ, 5), ts: Math.round(ts), timestamp: isoKst(Math.round(ts)), actor: actor, actorName: OP[actor] ? OP[actor].name : actor, role: OP[actor] ? OP[actor].role : 'System',
      action: action, target: target, before: before, after: after, reason: reason || null, request_id: 'req-' + R.hex(12), source_ip: '10.20.' + R.int(1, 30) + '.' + R.int(2, 250) };
  }

  function runSpec(s) {
    var wf = makeWorkflow({ created: s.T.created, lang: s.lang, utteranceCount: s.utteranceCount, version: s.version, priority: s.priority, pipeline: s.pipeline, replayOf: s.replayOf ? s.replayOf.wf.workflow_id : null, replayCycle: s.replayCycle });
    s.wf = wf;
    if (s.replayOf) linkReplay(s.replayOf.wf, wf, s);
    var T = s.T;
    stepReceived(wf, T.created); if (s.status === 'RECEIVED') return;
    stepValidated(wf, T.validated); if (s.status === 'VALIDATED') return;
    stepQueued(wf, T.queued);
    if (s.cancel && s.cancel.mode === 'queued') { cancelBeforeRun(wf, T.cancelAt, s.cancel.by, s.cancel.reason); AUDIT.push(audit(T.cancelAt, s.cancel.by, 'WORKFLOW_CANCELLED', wf.workflow_id, { status: 'QUEUED' }, { status: 'CANCELLED' }, s.cancel.reason)); return; }
    if (s.status === 'QUEUED') return;
    stepReserved(wf, T.reserved); if (s.status === 'RESERVED') return;
    var att = stepDispatching(wf, T.dispatch, s.plans[0]); if (s.status === 'DISPATCHING') return;
    if (s.cancel) { wf.cancelled_by = s.cancel.by; wf.cancel_reason = s.cancel.reason; }
    for (var i = 0; i < s.plans.length; i++) {
      if (i === 0) stepPipelineStarted(wf, att, T.starts[0]);
      else att = stepRetryStart(wf, T.starts[i] - 2500, s.plans[i]);
      var term = syncAttempt(wf, att, BASE_NOW, false);
      if (!term) return;
      finishAttempt(wf, att, term);
      if (s.cancel && s.cancel.mode === 'running') AUDIT.push(audit(wf.cancel_requested_at, s.cancel.by, 'WORKFLOW_CANCELLED', wf.workflow_id, { status: 'RUNNING' }, { status: 'CANCELLED' }, s.cancel.reason));
      if (wf.status !== 'RETRY_WAIT') return;
    }
  }
  SPECS.forEach(runSpec);

  // replay status sync + DLQ post-processing
  function syncReplayStatus(rp) {
    var w = WF[rp.replay_workflow_id]; if (!w) return;
    var map = { SUCCEEDED: 'SUCCEEDED', DEAD_LETTERED: 'FAILED', CANCELLED: 'CANCELLED', TIMED_OUT: 'FAILED', RUNNING: 'RUNNING', RETRY_WAIT: 'RUNNING', DISPATCHING: 'RUNNING', RESERVED: 'QUEUED' };
    rp.status = map[w.status] || 'QUEUED';
    if (TERMINAL_STATES.indexOf(w.status) >= 0) {
      rp.completed_at = w.completed_at;
      var dl = DLQ.filter(function (x) { return x.dead_letter_id === rp.dead_letter_id; })[0];
      if (dl && dl.status === 'REPLAYING') { dl.status = w.status === 'SUCCEEDED' ? 'REPLAYED' : 'PENDING_REVIEW'; dl.updated_at = w.completed_at; if (w.status === 'SUCCEEDED') dl.resolution = 'Replay ' + rp.replay_id + ' 성공 (' + w.workflow_id + ')'; }
    }
  }
  REPLAYS.forEach(syncReplayStatus);
  D.forEach(function (s) {
    var dl = DLQ.filter(function (x) { return x.workflow_id === s.wf.workflow_id; })[0];
    if (!dl) return;
    if (s.dlq.op && !dl.assigned_operator) dl.assigned_operator = s.dlq.op;
    if (s.dlq.status === 'CLOSED') {
      var tc = Math.min(BASE_NOW - HOUR, dl.created_at + R.int(2, 20) * HOUR);
      dl.status = 'CLOSED'; dl.resolution = s.dlq.resolution; dl.updated_at = tc;
      addEvent(s.wf, 'DEAD_LETTER_CLOSED', tc, { dead_letter_id: dl.dead_letter_id, closed_by: s.dlq.op, resolution: s.dlq.resolution }, { att: null });
      AUDIT.push(audit(tc, s.dlq.op, 'DLQ_CLOSED', dl.dead_letter_id, { status: 'PENDING_REVIEW' }, { status: 'CLOSED' }, s.dlq.resolution));
    } else if (s.dlq.status === 'APPROVED') {
      var ta = BASE_NOW - 4 * MIN - 12000;
      var rp = { replay_id: 'rpl-' + kstCompact(ta) + '-' + pad(++REPLAY_SEQ, 3), dead_letter_id: dl.dead_letter_id, original_workflow_id: s.wf.workflow_id, replay_workflow_id: null, replay_cycle: 1,
        requested_by: s.dlq.by, approved_by: s.dlq.approver, reason: s.dlq.reason, pipeline_version_from: s.wf.pipeline_version, pipeline_version_to: s.wf.pipeline_version,
        status: 'APPROVED', created_at: ta - 22 * MIN, approved_at: ta, scheduled_for: BASE_NOW + 30 * MIN, completed_at: null };
      REPLAYS.push(rp); dl.replay_ids.push(rp.replay_id); dl.status = 'APPROVED'; dl.updated_at = ta;
      addEvent(s.wf, 'REPLAY_REQUESTED', rp.created_at, { dead_letter_id: dl.dead_letter_id, replay_id: rp.replay_id, requested_by: rp.requested_by, reason: rp.reason }, { att: null });
      addEvent(s.wf, 'REPLAY_APPROVED', ta, { dead_letter_id: dl.dead_letter_id, replay_id: rp.replay_id, approved_by: rp.approved_by, scheduled_for: isoKst(rp.scheduled_for) }, { att: null });
      AUDIT.push(audit(rp.created_at, rp.requested_by, 'DLQ_REPLAY_REQUESTED', dl.dead_letter_id, null, { replay_id: rp.replay_id }, rp.reason));
      AUDIT.push(audit(ta, rp.approved_by, 'DLQ_REPLAY_APPROVED', dl.dead_letter_id, { status: 'PENDING_REVIEW' }, { status: 'APPROVED', scheduled_for: isoKst(rp.scheduled_for) }, rp.reason));
    }
    if (dl.assigned_operator) dl.notes.push({ at: dl.created_at + 25 * MIN, by: dl.assigned_operator, text: { PIPELINE_EXECUTION: 'OOM/Row mismatch 재현 확인 중', MODEL_TRANSIENT: 'Gemini 503 일시 장애 구간과 겹침', QUOTA: 'L4 GPU 할당량 16개 모두 사용 중이었음', INPUT_SCHEMA: '수집기 v2.3 스키마 누락 필드 확인', AUTH_PERMISSION: 'es 버킷 IAM 바인딩 누락 — Terraform PR #482 확인 중', CODE_DEFECT: 'aggregate capsule_map에 신규 intent 누락', TIMEOUT: 'judge 동시성 64 → 32 조정 필요' }[dl.failure_category] });
  });
  // orphaned reservation (slot drift → reconciler alert)
  (function () {
    var w = WORKFLOWS.filter(function (x) { return x.status === 'SUCCEEDED' && x.language === 'ko' && kstDate(x.created_at) === TODAY; }).slice(-1)[0];
    if (!w) return;
    var r = { reservation_id: 'rsv-' + TODAY.replace(/-/g, '') + '-' + R.hex(6), workflow_id: w.workflow_id, language: 'ko', slot_weight: 1, status: 'ORPHANED', attempt: w.attempt,
      lease_expires_at: w.completed_at + 10 * MIN, fencing_token: ++FENCE, created_at: w.completed_at - 900, updated_at: w.completed_at, released_at: null,
      note: 'RELEASE 쓰기 중 Firestore DEADLINE_EXCEEDED → Reconciler가 Vertex 상태(SUCCEEDED) 확인 후 정리 예정' };
    RESERVATIONS.push(r);
  })();

  // system logs (scheduler / reconciler / operations-api)
  (function () {
    var t0 = BASE_NOW - 3 * HOUR;
    for (var t = t0; t <= BASE_NOW - 31000; t += 2 * MIN) {
      var failed = Math.abs(t - (BASE_NOW - 18 * MIN)) < MIN;
      if (failed) {
        addLog(null, t + 8400, 'ERROR', 'reconciler', 'Reconcile run failed after 8.4s: Firestore transaction aborted', { component: 'reconciler', event_type: 'RECONCILE_FAILED', error_code: 'DEADLINE_EXCEEDED', duration_ms: 8400,
          stack_trace: 'Traceback (most recent call last):\n  File "/app/reconciler/main.py", line 64, in run\n    drift = reconcile_slots(db, vertex)\n  File "/app/reconciler/slots.py", line 112, in reconcile_slots\n    txn.commit()\n  File "/usr/local/lib/python3.11/site-packages/google/cloud/firestore_v1/transaction.py", line 302, in commit\n    raise exceptions.DeadlineExceeded(\ngoogle.api_core.exceptions.DeadlineExceeded: 504 Deadline Exceeded' });
      } else addLog(null, t + R.int(800, 2600), 'INFO', 'reconciler', 'Reconcile run ok: checked ' + R.int(14, 19) + ' active reservations, 0 orphaned pipelines, 0 lost dispatches', { component: 'reconciler', event_type: 'RECONCILE_OK', duration_ms: R.int(800, 2600) });
      addLog(null, t + 15000, 'INFO', 'scheduler', 'admission tick: ko 10/10 backlog=' + Math.max(0, Math.round((t - (BASE_NOW - 3 * HOUR)) / (18 * MIN))) + ', en ' + R.int(3, 6) + '/25, ja ' + R.int(1, 3) + '/5, es ' + R.int(0, 2) + '/4, global ' + R.int(14, 19) + '/36', { component: 'admission', event_type: 'ADMISSION_TICK', duration_ms: R.int(40, 140) });
      if (R.chance(0.3)) addLog(null, t + 30000, 'DEBUG', 'operations-api', 'GET /api/v1/overview 200 (' + R.int(60, 240) + 'ms) user=' + R.pick(OPERATORS).email, { component: 'http', event_type: 'HTTP_REQUEST' });
    }
  })();
  addEvent(null, 'SLOT_RECONCILED', BASE_NOW - 16 * MIN, { orphaned_reservations: 1, action: 'flagged', note: 'next reconcile will release after Vertex state verification' }, { att: null, language: 'ko', severity: 'WARNING' });

  // audit (static operator actions) + config events
  [
    [Date.parse('2026-11-05T11:02:00+09:00'), 'op-kim-sy', 'PIPELINE_VERSION_PROMOTED', 'pipeline:v1.1', { default: 'v1.0' }, { default: 'v1.1' }, 'v1.1 정식 배포 (judge gemini-2.5-flash)'],
    [Date.parse('2026-11-08T10:00:00+09:00'), 'op-kim-sy', 'PIPELINE_VERSION_DEPRECATED', 'pipeline:v1.0', { status: 'STABLE' }, { status: 'DEPRECATED' }, '신규 배치에 v1.0 사용 중단'],
    [Date.parse('2026-11-08T13:30:00+09:00'), 'op-han-dy', 'CONFIG_UPDATED', 'workflowTimeoutMin', { value: 60 }, { value: 90 }, DRIFT_NOTES.workflowTimeoutMin.reason],
    [Date.parse('2026-11-09T16:05:00+09:00'), 'op-park-jh', 'LANGUAGE_PAUSED', 'language:es', { paused: false }, { paused: true }, 'es 입력 버킷 IAM 점검'],
    [Date.parse('2026-11-09T16:47:00+09:00'), 'op-park-jh', 'LANGUAGE_RESUMED', 'language:es', { paused: true }, { paused: false }, '점검 완료'],
    [Date.parse('2026-11-10T05:40:00+09:00'), 'op-han-dy', 'CAPACITY_UPDATED', 'language:en.maxStartsPerMinute', { value: 10 }, { value: 8 }, DRIFT_NOTES['languages.en.maxStartsPerMinute'].reason],
    [Date.parse('2026-11-10T09:12:00+09:00'), 'op-kim-sy', 'CAPACITY_UPDATED', 'language:ko.maxConcurrent', { value: 8 }, { value: 10 }, DRIFT_NOTES['languages.ko.maxConcurrent'].reason],
    [Date.parse('2026-11-10T09:13:00+09:00'), 'op-kim-sy', 'CAPACITY_UPDATED', 'global.maxConcurrent', { value: 32 }, { value: 36 }, DRIFT_NOTES['global.maxConcurrent'].reason],
    [Date.parse('2026-11-11T09:30:00+09:00'), 'op-kim-sy', 'PIPELINE_VERSION_CANARY', 'pipeline:v1.2-rc', { trafficPct: 0 }, { trafficPct: 50 }, 'v1.2-rc 카나리 50% 시작'],
    [Date.parse('2026-11-11T18:20:00+09:00'), 'op-kim-sy', 'ROLE_GRANTED', 'operator:op-sato-k', { role: null }, { role: 'Viewer' }, 'JA 로케일 담당자 조회 권한'],
    [BASE_NOW - 35 * MIN, 'op-park-jh', 'ALERT_ACKNOWLEDGED', 'alert:ALT-0004', { status: 'OPEN' }, { status: 'ACKNOWLEDGED' }, 'Reconciler 재실행 대기']
  ].forEach(function (a) {
    AUDIT.push(audit(a[0], a[1], a[2], a[3], a[4], a[5], a[6]));
    if (/CAPACITY|CONFIG|VERSION|LANGUAGE/.test(a[2])) addEvent(null, 'CONFIG_UPDATED', a[0], { event_type: 'pipeline.config.updated', key: a[3], before: a[4], after: a[5], changed_by: a[1], reason: a[6] }, { att: null });
  });
  AUDIT.sort(function (a, b) { return b.ts - a.ts; });

  // alerts & incidents
  function mkAlert(o) { o.alert_id = 'ALT-' + pad(++ALERT_SEQ, 4); ALERTS.push(o); return o; }
  (function () {
    var todayDl = DLQ.filter(function (d) { return kstDate(d.created_at) === TODAY; });
    var koQ = WORKFLOWS.filter(function (w) { return w.language === 'ko' && w.status === 'QUEUED'; });
    mkAlert({ policy_id: 'ap-vertex-errors', severity: 'CRITICAL', title: 'Vertex AI API 오류율 증가 (429 ResourceExhausted)', message: 'aiplatform 429 비율 14.2% (임계 2%) — L4 GPU 할당량 소진', language: null, status: 'RESOLVED', opened_at: Date.parse('2026-11-10T03:12:00+09:00'), resolved_at: Date.parse('2026-11-10T06:05:00+09:00'), acknowledged_by: 'op-han-dy', incident_id: 'INC-20261110-01' });
    mkAlert({ policy_id: 'ap-fail-rate', severity: 'CRITICAL', title: 'Workflow 실패율 증가', message: '30분 실패율 11.8% (임계 5%)', language: 'en', status: 'RESOLVED', opened_at: Date.parse('2026-11-10T03:31:00+09:00'), resolved_at: Date.parse('2026-11-10T06:20:00+09:00'), acknowledged_by: 'op-han-dy', incident_id: 'INC-20261110-01' });
    mkAlert({ policy_id: 'ap-timeout', severity: 'WARNING', title: 'Pipeline 실행 Timeout 증가', message: '1시간 내 Timeout 3건 (en 대형 배치)', language: 'en', status: 'RESOLVED', opened_at: Date.parse('2026-11-08T12:40:00+09:00'), resolved_at: Date.parse('2026-11-08T13:35:00+09:00'), acknowledged_by: 'op-han-dy', incident_id: null });
    mkAlert({ policy_id: 'ap-reconciler', severity: 'WARNING', title: 'Reconciler 실행 실패', message: 'reconciler run failed: 504 Deadline Exceeded (Firestore transaction)', language: null, status: 'ACKNOWLEDGED', opened_at: BASE_NOW - 18 * MIN + 9000, resolved_at: null, acknowledged_by: 'op-park-jh', incident_id: null });
    mkAlert({ policy_id: 'ap-slot-mismatch', severity: 'WARNING', title: 'Capacity Slot 불일치 (ko)', message: 'ORPHANED reservation 1건 — 완료된 workflow의 Slot이 반환되지 않음', language: 'ko', status: 'OPEN', opened_at: BASE_NOW - 16 * MIN, resolved_at: null, acknowledged_by: null, incident_id: null });
    mkAlert({ policy_id: 'ap-backlog', severity: 'WARNING', title: '한국어 Backlog 임계치 초과', message: 'ko backlog ' + koQ.length + '건 (임계 ' + LANG.ko.backlogAlertThreshold + ') — ko 동시 실행 10/10 포화', language: 'ko', status: 'OPEN', opened_at: BASE_NOW - 42 * MIN, resolved_at: null, acknowledged_by: null, incident_id: 'INC-20261112-01' });
    mkAlert({ policy_id: 'ap-wait-p95', severity: 'WARNING', title: '한국어 p95 대기 시간 초과', message: 'ko p95 대기 시간 ' + Math.round(pctl(koQ.map(function (w) { return BASE_NOW - w.queued_at; }), 0.95) / 60000) + '분 (SLO 15분)', language: 'ko', status: 'OPEN', opened_at: BASE_NOW - 21 * MIN, resolved_at: null, acknowledged_by: null, incident_id: 'INC-20261112-01' });
    todayDl.forEach(function (d) { mkAlert({ policy_id: 'ap-dlq-new', severity: 'CRITICAL', title: 'DLQ 신규 발생: ' + d.dead_letter_id, message: d.language + ' · ' + d.failure_category + ' · ' + d.error_code + ' (' + d.attempts + '회 시도)', language: d.language, workflow_id: d.workflow_id, dead_letter_id: d.dead_letter_id, status: d.assigned_operator ? 'ACKNOWLEDGED' : 'OPEN', opened_at: d.created_at + 4000, resolved_at: null, acknowledged_by: d.assigned_operator, incident_id: null }); });
    ALERTS.sort(function (a, b) { return b.opened_at - a.opened_at; });
    INCIDENTS.push({ incident_id: 'INC-20261112-01', title: '한국어 대기열 적체 (ko Capacity 포화)', severity: 'SEV3', status: 'MONITORING', started_at: BASE_NOW - 42 * MIN, resolved_at: null, commander: 'op-kim-sy', alerts: ALERTS.filter(function (a) { return a.incident_id === 'INC-20261112-01'; }).map(function (a) { return a.alert_id; }), languages: ['ko'],
      summary: '오후 실발화 업로드 급증으로 ko 대기열이 임계치를 초과. ko maxConcurrent 10 포화 상태이며 Global 여유 있음. maxConcurrent 12 상향 검토 중.',
      timeline: [{ at: BASE_NOW - 42 * MIN, text: 'ko backlog 알림 발생' }, { at: BASE_NOW - 30 * MIN, text: '김서연: Global 여유(16/36) 확인, ko 상향 검토' }, { at: BASE_NOW - 21 * MIN, text: 'p95 대기 시간 SLO 초과' }] });
    INCIDENTS.push({ incident_id: 'INC-20261110-01', title: 'Vertex AI L4 GPU 할당량 소진 → en/ko 대량 재시도 및 DLQ', severity: 'SEV2', status: 'RESOLVED', started_at: Date.parse('2026-11-10T03:12:00+09:00'), resolved_at: Date.parse('2026-11-10T06:20:00+09:00'), commander: 'op-han-dy', alerts: ALERTS.filter(function (a) { return a.incident_id === 'INC-20261110-01'; }).map(function (a) { return a.alert_id; }), languages: ['en', 'ko'],
      summary: '동일 리전 다른 프로젝트의 학습 Job이 L4 할당량을 점유하여 response_eval 태스크가 429로 실패. en 시작률 10→8 제한, 할당량 증설 요청 후 복구. DLQ 건은 Replay 완료.',
      timeline: [{ at: Date.parse('2026-11-10T03:12:00+09:00'), text: 'Vertex 429 오류율 알림' }, { at: Date.parse('2026-11-10T05:40:00+09:00'), text: 'en maxStartsPerMinute 10→8' }, { at: Date.parse('2026-11-10T06:05:00+09:00'), text: '할당량 증설 반영, 오류율 정상화' }, { at: Date.parse('2026-11-10T06:20:00+09:00'), text: '종료' }],
      postmortem: 'https://docs.bixby-eval.example/postmortems/INC-20261110-01' });
  })();

  // ───────────────────────────────────────────── metrics (BigQuery-style aggregates) ──
  var MR = makeRng(777);
  function diurnal(h) { return 0.22 + 0.78 * Math.exp(-Math.pow(h - 14.5, 2) / (2 * 4.2 * 4.2)); }
  var PEAK = {}, COST_PER_PIPE = {}; LANGS.forEach(function (l) { PEAK[l.code] = l.peakPerHour; COST_PER_PIPE[l.code] = l.costPerRunUsd; });
  var METRIC_HOURS = (HISTORY_DAYS + 1) * 24;
  var ERR_CATS = Object.keys(failureCategoryMeta);
  var hourly = { ts: [], throughput: {}, utterances: {}, queueDepth: {}, active: {}, successRate: [], retryRate: [], avgDurationSec: [], p95DurationSec: [], errors: {} };
  LANG_CODES.forEach(function (l) { hourly.throughput[l] = []; hourly.utterances[l] = []; hourly.queueDepth[l] = []; hourly.active[l] = []; });
  ERR_CATS.forEach(function (c) { hourly.errors[c] = []; });
  var hourNow = Math.floor(BASE_NOW / HOUR) * HOUR;
  for (var hi = METRIC_HOURS - 1; hi >= 0; hi--) {
    var ht = hourNow - hi * HOUR, hp = kstParts(ht), hd = kstDate(ht);
    var weekend = hp.dow === 0 || hp.dow === 6 ? 0.62 : 1;
    var inc = hd === '2026-11-10' && hp.h >= 3 && hp.h <= 6, tmo = hd === '2026-11-08' && hp.h >= 11 && hp.h <= 13;
    hourly.ts.push(ht);
    var partial = hi === 0 ? (BASE_NOW - ht) / HOUR : 1;
    LANG_CODES.forEach(function (l) {
      var v = Math.max(0, Math.round(PEAK[l] * diurnal(hp.h) * weekend * MR.float(0.78, 1.2) * partial * (inc && (l === 'en' || l === 'ko') ? 0.55 : 1)));
      hourly.throughput[l].push(v); hourly.utterances[l].push(v * LANG[l].batchSize);
      var qd = l === 'ko' ? Math.max(0, Math.round((diurnal(hp.h) - 0.55) * 14 * MR.float(0.6, 1.3))) : MR.chance(0.15) ? 1 : 0;
      if (hi === 0) qd = WORKFLOWS.filter(function (w) { return w.language === l && w.status === 'QUEUED'; }).length;
      hourly.queueDepth[l].push(qd);
      var ac = hi === 0 ? activeCount(l) : Math.min(LANG[l].maxConcurrent, Math.round(PEAK[l] * 1.25 * diurnal(hp.h) * weekend * MR.float(0.7, 1.15)));
      hourly.active[l].push(ac);
    });
    hourly.successRate.push(round(inc ? MR.float(0.78, 0.88) : MR.float(0.965, 0.998), 4));
    hourly.retryRate.push(round(inc ? MR.float(0.22, 0.38) : MR.float(0.03, 0.09), 4));
    var ad = MR.normal(tmo ? 980 : 760, 45); hourly.avgDurationSec.push(Math.round(ad)); hourly.p95DurationSec.push(Math.round(ad * MR.float(1.45, 1.7)));
    ERR_CATS.forEach(function (c) {
      var base = { PIPELINE_EXECUTION: 0.12, MODEL_TRANSIENT: 0.25, QUOTA: 0.04, TIMEOUT: 0.05, INPUT_SCHEMA: 0.03, AUTH_PERMISSION: 0.01, CODE_DEFECT: 0.04 }[c];
      if (inc && c === 'QUOTA') base = 6; if (tmo && c === 'TIMEOUT') base = 1.5;
      var v = 0, x = base * diurnal(hp.h) * 1.4; while (MR.next() < x && v < 12) { v++; x -= 1; }
      hourly.errors[c].push(v);
    });
  }
  var fiveMin = { ts: [], utterances: {}, completed: {}, active: {}, queue: {}, successRate: [], passRate: [] };
  LANG_CODES.forEach(function (l) { fiveMin.utterances[l] = []; fiveMin.completed[l] = []; fiveMin.active[l] = []; fiveMin.queue[l] = []; });
  function pushFive(t, exact) {
    var h = kstParts(t).h + kstParts(t).mi / 60;
    fiveMin.ts.push(t);
    LANG_CODES.forEach(function (l) {
      var L = LANG[l], act, q;
      if (exact) { act = activeCount(l); q = WORKFLOWS.filter(function (w) { return w.language === l && w.status === 'QUEUED'; }).length; }
      else {
        act = Math.min(L.maxConcurrent, Math.round(PEAK[l] * 1.25 * diurnal(h) * MR.float(0.7, 1.15)));
        if (l === 'ko' && h > 12.5) act = Math.min(10, act + 2);
        q = l === 'ko' ? Math.max(0, Math.round((h - 13.2) * 7 * MR.float(0.8, 1.2))) : (MR.chance(0.08) ? 1 : 0);
      }
      fiveMin.active[l].push(act); fiveMin.queue[l].push(q);
      var c = MR.chance(act / 12) ? MR.int(1, Math.max(1, Math.round(act / 6))) : 0;
      fiveMin.completed[l].push(c); fiveMin.utterances[l].push(Math.round(act * L.batchSize * 5 / (BASE_MIN[l] * 1.0) * MR.float(0.8, 1.1)));
    });
    fiveMin.successRate.push(round(MR.float(0.95, 1), 4));
    fiveMin.passRate.push(round(MR.float(0.835, 0.89), 4));
  }
  for (var ft = TODAY_START - DAY; ft < BASE_NOW; ft += 5 * MIN) pushFive(ft, false);
  pushFive(BASE_NOW, true);
  var lastFive = BASE_NOW;
  var daily = [];
  for (var di = HISTORY_DAYS; di >= 0; di--) {
    var dStart = TODAY_START - di * DAY, dKey = kstDate(dStart), pipes = {}, utt = 0, tot = 0, errs = {}, retries = 0;
    LANG_CODES.forEach(function (l) { pipes[l] = 0; });
    ERR_CATS.forEach(function (c) { errs[c] = 0; });
    var succW = [];
    hourly.ts.forEach(function (t, i) {
      if (kstDate(t) !== dKey) return;
      LANG_CODES.forEach(function (l) { pipes[l] += hourly.throughput[l][i]; utt += hourly.utterances[l][i]; });
      ERR_CATS.forEach(function (c) { errs[c] += hourly.errors[c][i]; });
      succW.push(hourly.successRate[i]); retries += Math.round(hourly.retryRate[i] * (hourly.throughput.ko[i] + hourly.throughput.en[i] + hourly.throughput.ja[i] + hourly.throughput.es[i]));
    });
    tot = sum(LANG_CODES.map(function (l) { return pipes[l]; }));
    var vertex = sum(LANG_CODES.map(function (l) { return pipes[l] * COST_PER_PIPE[l]; }));
    var cost = { vertex: round(vertex, 2), llmJudge: round(utt * 0.0021, 2), workflows: round(0.6 + tot * 0.004, 2), cloudRun: round(MR.float(2.8, 3.6), 2), firestore: round(0.7 + tot * 0.006, 2), bigquery: round(MR.float(1.9, 2.8), 2), storage: round(0.45 + utt * 0.000004, 2) };
    cost.total = round(sum(Object.keys(cost).map(function (k) { return cost[k]; })), 2);
    daily.push({ date: dKey, pipelines: Object.assign({ total: tot }, pipes), utterances: utt, successRate: round(avg(succW), 4), retries: retries,
      deadLettered: DLQ.filter(function (d) { return kstDate(d.created_at) === dKey; }).length, timedOut: WORKFLOWS.filter(function (w) { return w.status === 'TIMED_OUT' && kstDate(w.completed_at) === dKey; }).length,
      errorCategories: errs, costUsd: cost, partial: di === 0 });
  }
  var errorCategories7d = ERR_CATS.map(function (c) { return { category: c, label: failureCategoryMeta[c].label, count: sum(hourly.errors[c].slice(-168)) }; }).sort(function (a, b) { return b.count - a.count; });

  // aggregate result files
  var AGG_FILES = [];
  function succeededToday() { var ds = kstDayStart(clock.now); return WORKFLOWS.filter(function (w) { return w.status === 'SUCCEEDED' && w.completed_at >= ds && w.completed_at <= clock.now; }); }
  function refreshAgg(f) {
    var ws = succeededToday().filter(f.filter);
    f.rowCount = sum(ws.map(function (w) { return w.result ? w.result.rows : 0; }));
    f.sizeBytes = Math.round(f.rowCount * 612 + 420); f.generatedAt = clock.now;
    if (f._obj) { f._obj.size = f.sizeBytes; f._obj.updated = clock.now; f._obj.metadata.rows = String(f.rowCount); }
  }
  function aggFile(name, filterFn, label) {
    var o = addGcsObject(BUCKET_RES, TODAY + '/aggregate/' + name, 0, BASE_NOW - 2 * MIN, 'text/csv; charset=utf-8', { rows: '0', scope: label, generated_by: 'aggregate-daily' }, null);
    var f = { uri: o.uri, bucket: BUCKET_RES, name: o.name, sizeBytes: 0, generatedAt: o.timeCreated, rowCount: 0, scope: label, filter: filterFn };
    Object.defineProperty(f, '_obj', { value: o, enumerable: false });
    refreshAgg(f); f.generatedAt = o.timeCreated;
    AGG_FILES.push(f); return f;
  }
  var RESULT_FILE = aggFile('results_v1.2-rc.csv', function () { return true; }, 'all-versions (candidate v1.2-rc vs baseline v1.1)');
  aggFile('results_v1.2-rc_only.csv', function (w) { return w.pipeline_version === 'v1.2-rc'; }, 'v1.2-rc');
  aggFile('results_v1.1_only.csv', function (w) { return w.pipeline_version === 'v1.1'; }, 'v1.1');

  // finalize static build
  function byTs(a, b) { return a.ts - b.ts; }
  EVENTS_ALL.sort(byTs); LOGS_ALL.sort(byTs); LOGS_SYSTEM.sort(byTs);
  Object.keys(GCS_OBJECTS).forEach(function (b) { GCS_OBJECTS[b].sort(function (x, y) { return x.timeCreated - y.timeCreated; }); });
  BUILDING = false;

  // ───────────────────────────────────────────── query helpers ──
  function getWorkflow(id) { return WF[id] || null; }
  function asArr(x) { return x == null ? null : Array.isArray(x) ? x : [x]; }
  function listWorkflows(f) {
    f = f || {};
    var langs = asArr(f.language), sts = asArr(f.status), vers = asArr(f.pipeline_version), pids = asArr(f.pipeline_id), mods = asArr(f.model_version), q = f.q ? String(f.q).toLowerCase() : null;
    var out = WORKFLOWS.filter(function (w) {
      if (langs && langs.indexOf(w.language) < 0) return false;
      if (sts && sts.indexOf(w.status) < 0) return false;
      if (vers && vers.indexOf(w.pipeline_version) < 0) return false;
      if (pids && pids.indexOf(w.pipeline_id) < 0) return false;
      if (mods && mods.indexOf(w.model_version) < 0) return false;
      if (f.stage && w.stage !== f.stage) return false;
      if (f.event_type && w.event_type !== f.event_type) return false;
      if (f.batch_id && w.batch_id !== f.batch_id) return false;
      if (f.error_code && !w.attempts.some(function (a) { return a.error_code === f.error_code; })) return false;
      if (f.error_category && !w.attempts.some(function (a) { return a.error_category === f.error_category; })) return false;
      if (f.from != null && w.created_at < f.from) return false;
      if (f.to != null && w.created_at > f.to) return false;
      if (f.hasRetries && w.attempts.length < 2) return false;
      if (f.replay === true && !w.replay_of) return false;
      if (q) {
        var hay = [w.workflow_id, w.batch_id, w.input.object, w.idempotency_key, w.correlation_id, w.trace_id, w.dead_letter_id || '', w.pipeline_id, w.model_version].concat(w.attempts.map(function (a) { return a.pipeline_job_id + ' ' + (a.error_code || '') + ' ' + (a.failed_path || ''); })).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var sorters = {
      created_desc: function (a, b) { return b.created_at - a.created_at; }, created_asc: function (a, b) { return a.created_at - b.created_at; },
      wait_desc: function (a, b) { return (b.waitMs || 0) - (a.waitMs || 0); }, run_desc: function (a, b) { return (b.runMs || 0) - (a.runMs || 0); },
      updated_desc: function (a, b) { return b.updated_at - a.updated_at; }
    };
    out.sort(sorters[f.sort || 'created_desc'] || sorters.created_desc);
    return f.limit ? out.slice(0, f.limit) : out;
  }
  function workflowsByStage() {
    var o = {}; STAGES.forEach(function (s) { o[s.id] = []; });
    WORKFLOWS.forEach(function (w) { o[STATE_TO_STAGE[w.status]].push(w); });
    return o;
  }
  function lowerBound(arr, ts) { var lo = 0, hi = arr.length; while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m].ts < ts) lo = m + 1; else hi = m; } return lo; }
  function sliceByTs(arr, from, to) { var a = from != null ? lowerBound(arr, from) : 0, b = to != null ? lowerBound(arr, to + 1) : arr.length; return a === 0 && b === arr.length ? arr : arr.slice(a, b); }
  var SEV_ORDER = { DEBUG: 0, INFO: 1, NOTICE: 2, WARNING: 3, ERROR: 4, CRITICAL: 5 };
  function queryLogs(f) {
    f = f || {};
    var src = f.workflow_id ? (LOGS_BY_WF[f.workflow_id] || []) : f.system ? LOGS_SYSTEM : LOGS_ALL;
    if (f.from != null || f.to != null) src = sliceByTs(src, f.from, f.to);
    var sevs = asArr(f.severity), svcs = asArr(f.service), comps = asArr(f.component), q = f.q ? String(f.q).toLowerCase() : null;
    var minS = f.minSeverity ? SEV_ORDER[f.minSeverity] : null;
    var out = src.filter(function (l) {
      if (sevs && sevs.indexOf(l.severity) < 0) return false;
      if (minS != null && SEV_ORDER[l.severity] < minS) return false;
      if (svcs && svcs.indexOf(l.service) < 0) return false;
      if (comps && comps.indexOf(l.component) < 0) return false;
      if (f.attempt != null && l.attempt !== f.attempt) return false;
      if (f.language && l.language !== f.language) return false;
      if (f.trace_id && l.trace_id !== f.trace_id) return false;
      if (f.pipeline_job_id && l.pipeline_job_id !== f.pipeline_job_id && !(f.job_scope !== 'self' && l.pipeline_job_id && l.pipeline_job_id.indexOf(f.pipeline_job_id + '.') === 0)) return false;
      if (f.pipeline_id && l.pipeline_id !== f.pipeline_id) return false;
      if (f.node_path && (!l.node_path || (l.node_path !== f.node_path && l.node_path.indexOf(f.node_path + '/') !== 0))) return false;
      if (f.error_code && l.error_code !== f.error_code) return false;
      if (f.event_type && l.event_type !== f.event_type) return false;
      if (f.from != null && l.ts < f.from) return false;
      if (f.to != null && l.ts > f.to) return false;
      if (q && (l.message + ' ' + (l.stack_trace || '') + ' ' + l.component).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if ((f.order || (f.workflow_id ? 'asc' : 'desc')) === 'desc') out = out.slice().reverse();
    return f.limit ? out.slice(0, f.limit) : out;
  }
  function recentEvents(n, f) {
    f = f || {}; n = n || 30;
    var out = [];
    var upper = Math.min(clock.now, f.to != null ? f.to : Infinity);
    for (var i = EVENTS_ALL.length - 1; i >= 0 && out.length < n; i--) {
      var e = EVENTS_ALL[i];
      if (e.ts > upper) continue;
      if (f.from != null && e.ts < f.from) break;
      if (f.workflow_id && e.workflow_id !== f.workflow_id) continue;
      if (f.pipeline_id && e.pipeline_id !== f.pipeline_id) continue;
      if (f.component && e.component !== f.component) continue;
      if (f.pipeline_job_id && e.pipeline_job_id !== f.pipeline_job_id && !(f.job_scope !== 'self' && e.pipeline_job_id && e.pipeline_job_id.indexOf(f.pipeline_job_id + '.') === 0)) continue;
      if (f.stage && e.stage !== f.stage) continue;
      if (f.language && e.language !== f.language) continue;
      if (f.severity && asArr(f.severity).indexOf(e.severity) < 0) continue;
      if (f.names && asArr(f.names).indexOf(e.name) < 0) continue;
      out.push(e);
    }
    return out;
  }
  function getDeadLetter(id) { return DLQ.filter(function (d) { return d.dead_letter_id === id || d.workflow_id === id; })[0] || null; }

  // ───────────────────────────────────────────── capacity / overview ──
  function getCapacity() {
    var now = clock.now, langs = LANGS.map(function (l) {
      var ws = WORKFLOWS.filter(function (w) { return w.language === l.code; });
      var c = function (s) { return ws.filter(function (w) { return w.status === s; }).length; };
      var queued = ws.filter(function (w) { return w.status === 'QUEUED'; });
      var running = c('RUNNING'), reserved = c('RESERVED'), dispatching = c('DISPATCHING'), active = running + reserved + dispatching;
      var curWaits = queued.map(function (w) { return now - w.queued_at; });
      var recent = ws.filter(function (w) { return w.waitMs != null && w.reserved_at > now - DAY; }).map(function (w) { return w.waitMs; });
      var allW = curWaits.concat(recent);
      var lastHourDone = ws.filter(function (w) { return w.status === 'SUCCEEDED' && w.completed_at > now - HOUR; }).length;
      return {
        code: l.code, name: l.name, nameEn: l.nameEn, enabled: l.enabled, paused: l.paused,
        active: active, max: l.maxConcurrent, running: running, reserved: reserved, dispatching: dispatching, retryWait: c('RETRY_WAIT'),
        backlog: queued.length, intake: c('RECEIVED') + c('VALIDATED'), utilization: l.maxConcurrent ? round(active / l.maxConcurrent, 4) : 0,
        avgWaitSec: Math.round(avg(allW) / 1000), p95WaitSec: Math.round(pctl(allW, 0.95) / 1000), oldestQueuedAt: queued.length ? Math.min.apply(null, queued.map(function (w) { return w.queued_at; })) : null,
        throughputPerHour: hourly.throughput[l.code][hourly.ts.length - 2], completedLastHour: lastHourDone,
        utterancesPerHour: hourly.utterances[l.code][hourly.ts.length - 2],
        priorityWeight: l.priorityWeight, maxStartsPerMinute: l.maxStartsPerMinute, batchSize: l.batchSize,
        backlogAlertThreshold: l.backlogAlertThreshold, p95WaitSloSec: l.p95WaitSloSec,
        status: l.paused ? 'PAUSED' : !l.enabled ? 'DISABLED' : active >= l.maxConcurrent ? 'SATURATED' : queued.length > l.backlogAlertThreshold ? 'BACKLOGGED' : 'OK'
      };
    });
    var gActive = sum(langs.map(function (l) { return l.active; }));
    return { at: now, global: { active: gActive, max: config.global.maxConcurrent, utilization: round(gActive / config.global.maxConcurrent, 4), maxStartsPerMinute: config.global.maxStartsPerMinute, backlog: sum(langs.map(function (l) { return l.backlog; })) },
      languages: langs, reservationsActive: RESERVATIONS.filter(function (r) { return r.status === 'ACTIVE'; }).length, reservationsOrphaned: RESERVATIONS.filter(function (r) { return r.status === 'ORPHANED'; }).length };
  }
  function countBy(arr, fn) { var o = {}; arr.forEach(function (x) { var k = fn(x); o[k] = (o[k] || 0) + 1; }); return o; }
  function overview() {
    var now = clock.now, dayStart = kstDayStart(now), wk = now - 7 * DAY;
    var dist = {}; STATES.forEach(function (s) { dist[s] = 0; }); WORKFLOWS.forEach(function (w) { dist[w.status]++; });
    var doneToday = WORKFLOWS.filter(function (w) { return w.completed_at && w.completed_at >= dayStart; });
    var succToday = doneToday.filter(function (w) { return w.status === 'SUCCEEDED'; });
    var failToday = doneToday.filter(function (w) { return w.status === 'DEAD_LETTERED' || w.status === 'TIMED_OUT'; });
    var term7 = WORKFLOWS.filter(function (w) { return w.completed_at && w.completed_at >= wk && w.status !== 'CANCELLED'; });
    var succ7 = term7.filter(function (w) { return w.status === 'SUCCEEDED'; });
    var runs = succ7.map(function (w) { return w.attempts[w.attempts.length - 1].duration_ms; });
    var errs = {}; Object.keys(failureCategoryMeta).forEach(function (c) { errs[c] = 0; });
    WORKFLOWS.forEach(function (w) { w.attempts.forEach(function (a) { if (a.error_category && a.completed_at >= wk) errs[a.error_category]++; }); });
    var uttRows = sum(succToday.map(function (w) { return w.result ? w.result.rows : 0; })), pass = sum(succToday.map(function (w) { return w.result ? w.result.passCount : 0; }));
    return {
      at: now, running: dist.RUNNING, pending: dist.RECEIVED + dist.VALIDATED + dist.QUEUED + dist.RESERVED + dist.DISPATCHING, queued: dist.QUEUED,
      completedToday: succToday.length, failedToday: failToday.length, cancelledToday: doneToday.filter(function (w) { return w.status === 'CANCELLED'; }).length,
      retryWaiting: dist.RETRY_WAIT, dlqPendingReview: DLQ.filter(function (d) { return d.status === 'PENDING_REVIEW'; }).length, dlqTotal: DLQ.length,
      successRate7d: term7.length ? round(succ7.length / term7.length, 4) : null, successRateToday: (succToday.length + failToday.length) ? round(succToday.length / (succToday.length + failToday.length), 4) : null,
      avgProcessingMs: Math.round(avg(runs)), p95ProcessingMs: pctl(runs, 0.95), avgWaitMs: Math.round(avg(succ7.map(function (w) { return w.waitMs || 0; }))),
      utterancesEvaluatedToday: uttRows, utterancePassRateToday: uttRows ? round(pass / uttRows, 4) : null,
      statusDistribution: dist, errorDistribution7d: errs, openAlerts: ALERTS.filter(function (a) { return a.status !== 'RESOLVED'; }).length,
      capacity: getCapacity()
    };
  }

  // ───────────────────────────────────────────── GCS api ──
  var BUCKETS = [
    { name: BUCKET_IN, location: REGION, storageClass: 'STANDARD', purpose: '언어별 실발화 입력 배치 (JSONL)', versioning: true, retentionDays: 90, trigger: 'Eventarc: object.finalized → event-ingress' },
    { name: BUCKET_ART, location: REGION, storageClass: 'STANDARD', purpose: 'Vertex AI pipeline_root (컴포넌트 중간 산출물) · 템플릿', versioning: false, retentionDays: 30, trigger: null },
    { name: BUCKET_RES, location: REGION, storageClass: 'STANDARD', purpose: '발화별 PASS/FAIL 결과 CSV · summary.json · 일별 aggregate', versioning: true, retentionDays: 365, trigger: null }
  ];
  PIPELINES.forEach(function (p) { p.versions.forEach(function (v, i) { addGcsObject(BUCKET_ART, templateObject(p.id, v.version), 18211 + v.nodes.length * 3170 + i * 211, v.releasedTs, 'application/x-yaml', { pipeline_id: p.id, pipeline_version: v.version, kind: p.kind }, null); }); });
  GCS_OBJECTS[BUCKET_ART].sort(function (a, b) { return a.timeCreated - b.timeCreated; });
  BUCKETS.forEach(function (b) { Object.defineProperty(b, 'objectCount', { enumerable: true, get: function () { return GCS_OBJECTS[b.name].length; } }); Object.defineProperty(b, 'totalBytes', { enumerable: true, get: function () { return sum(GCS_OBJECTS[b.name].map(function (o) { return o.size; })); } }); });
  function gcsGet(bucket, name) { var l = GCS_OBJECTS[bucket] || []; for (var i = l.length - 1; i >= 0; i--) if (l[i].name === name) return l[i]; return null; }
  function gcsList(bucket, prefix, opts) {
    prefix = prefix || ''; opts = opts || {};
    var delim = opts.delimiter === undefined ? '/' : opts.delimiter, pre = {}, objs = [];
    (GCS_OBJECTS[bucket] || []).forEach(function (o) {
      if (o.timeCreated > clock.now || o.name.indexOf(prefix) !== 0) return;
      var rest = o.name.slice(prefix.length), k = delim ? rest.indexOf(delim) : -1;
      if (k >= 0) pre[prefix + rest.slice(0, k + 1)] = (pre[prefix + rest.slice(0, k + 1)] || 0) + 1; else objs.push(o);
    });
    objs.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return { bucket: bucket, prefix: prefix, prefixes: Object.keys(pre).sort(), prefixCounts: pre, objects: opts.limit ? objs.slice(0, opts.limit) : objs };
  }
  function inputLine(r, wf, i) {
    var h = hashStr(r.utterance_id);
    return JSON.stringify({ utterance_id: r.utterance_id, session_id: 'sess-' + (h % 0xffffff).toString(16), language: r.language, locale: LANG[r.language].locale, device_type: r.device_type,
      capsule_hint: r.capsule_id, utterance_text: r.utterance_text, asr_text: r.asr_text, asr_confidence: r.failure_reason === 'ASR_ERROR' ? round(0.41 + (h % 30) / 100, 2) : round(0.86 + (h % 13) / 100, 2),
      expected_intent: r.intent_expected, expected_response: r.expected_response, audio_uri: 'gs://bixby-utterance-audio/' + kstDate(wf.created_at) + '/' + r.language + '/' + r.utterance_id + '.opus',
      client_ts: isoKst(wf.created_at - DAY + i * 4000 + (h % 4000)), app_version: 'bixby-' + (r.device_type === 'Galaxy S26' ? '4.2.18' : '4.1.' + (h % 9)) });
  }
  function sampleLines(wfId, n) {
    var wf = WF[wfId]; if (!wf) return [];
    var rows = genUtterances(wf);
    return rows.slice(0, n || 5).map(function (r, i) { return inputLine(r, wf, i); });
  }
  function gcsRead(bucket, name, opts) {
    opts = opts || {}; var lim = opts.limit || 20, o = gcsGet(bucket, name);
    if (!o) return null;
    var wf = o.workflow_id ? WF[o.workflow_id] : null;
    if (bucket === BUCKET_IN && wf) return sampleLines(wf.workflow_id, lim).join('\n') + '\n';
    if (bucket === BUCKET_RES) {
      if (/aggregate\//.test(name)) {
        var f = AGG_FILES.filter(function (x) { return x.name === name; })[0], out = [];
        succeededToday().filter(f ? f.filter : function () { return true; }).some(function (w) { Array.prototype.push.apply(out, rowsFor(w).slice(0, lim - out.length)); return out.length >= lim; });
        return toCSV(out);
      }
      if (wf && /results\.csv$/.test(name)) return toCSV(rowsFor(wf).slice(0, lim));
      if (wf && /summary\.json$/.test(name)) return JSON.stringify(resultsSummary(rowsFor(wf)), null, 2);
    }
    if (/\.yaml$/.test(name)) {
      var pv = pipeVer(o.metadata.pipeline_id, o.metadata.pipeline_version);
      if (!pv) return '';
      var dash = function (x) { return x.replace(/_/g, '-'); };
      return '# PIPELINE SPEC (compiled KFP v2)\npipelineInfo:\n  name: ' + o.metadata.pipeline_id + '\n  version: ' + o.metadata.pipeline_version + '\n  description: ' + PIPE[o.metadata.pipeline_id].description + '\nroot:\n  dag:\n    tasks:\n' + pv.nodes.map(function (d) {
        return '      ' + dash(d.id) + ':\n' + (d.kind === 'component' ? '        componentRef: {name: comp-' + dash(d.component) + '}\n' : '        pipelineRef: {name: ' + d.ref.pipeline + ', version: ' + d.ref.version + '}  # sub-pipeline → child PipelineJob\n') + (d.deps.length ? '        dependentTasks: [' + d.deps.map(dash).join(', ') + ']\n' : '');
      }).join('');
    }
    if (/\.json$/.test(name)) return JSON.stringify({ pipeline_job_id: o.metadata.pipeline_job_id, pipeline_id: o.metadata.pipeline_id, task: o.metadata.task, generated_at: isoKst(o.timeCreated), metrics: wf ? wfRates(wf) : {} }, null, 2);
    if (wf) return genUtterances(wf).slice(0, lim).map(function (r) { return JSON.stringify({ utterance_id: r.utterance_id, intent_predicted: r.intent_predicted, judge_score: r.judge_score, latency_ms: r.latency_ms }); }).join('\n') + '\n';
    return '';
  }

  // ───────────────────────────────────────────── results api ──
  function rate(rows) { var p = rows.filter(function (r) { return r.result === 'PASS'; }).length; return { total: rows.length, pass: p, fail: rows.length - p, passRate: rows.length ? round(p / rows.length, 4) : null }; }
  function groupRate(rows, key) { var g = {}; rows.forEach(function (r) { (g[r[key]] = g[r[key]] || []).push(r); }); var o = {}; Object.keys(g).forEach(function (k) { o[k] = rate(g[k]); }); return o; }
  function resultsSummary(rows) {
    rows = rows || todayRows();
    var s = rate(rows), lat = rows.map(function (r) { return r.latency_ms; }), cv = {};
    CAPSULES.forEach(function (c) { var rs = rows.filter(function (r) { return r.capsule_id === c.id; }); cv[c.id] = groupRate(rs, 'pipeline_version'); });
    s.byLanguage = groupRate(rows, 'language'); s.byCapsule = groupRate(rows, 'capsule_id'); s.byVersion = groupRate(rows, 'pipeline_version'); s.byDevice = groupRate(rows, 'device_type');
    s.byCapsuleVersion = cv;
    s.byFailureReason = countBy(rows.filter(function (r) { return r.result === 'FAIL'; }), function (r) { return r.failure_reason; });
    s.latency = { avgMs: Math.round(avg(lat)), p50Ms: pctl(lat, 0.5), p95Ms: pctl(lat, 0.95) };
    s.avgJudgeScore = round(avg(rows.map(function (r) { return r.judge_score; })), 3);
    return s;
  }

  // ───────────────────────────────────────────── actions ──
  function refreshRuntime() { config.runtimeConfig = flattenRuntime(); }
  function pushAudit(a) { AUDIT.unshift(a); emit('audit', a); return a; }
  function injectBatch(o) {
    o = o || {};
    var lang = o.language || G.weighted({ ko: 0.5, en: 0.25, ja: 0.15, es: 0.1 });
    var t = Math.round(o.at || clock.now);
    var ver = o.pipelineVersion || (G.chance(0.5) ? 'v1.2-rc' : 'v1.1');
    var pc = ROOT_PIPELINES.filter(function (p) { return pipeVer(p.id, ver) && p.mixWeight && p.id !== 'bixby-regression-nightly' && (!p.languages || p.languages.indexOf(lang) >= 0); });
    var pid = o.pipelineId && pipeVer(o.pipelineId, ver) ? o.pipelineId : pc.length ? G.weighted(pc.map(function (p) { return [p.id, p.mixWeight]; })) : 'bixby-eval-full';
    var wf = makeWorkflow({ created: t, lang: lang, utteranceCount: o.utteranceCount || LANG[lang].batchSize, version: ver, pipeline: pid, priority: o.priority || (G.chance(0.1) ? 7 : 5) });
    stepReceived(wf, t);
    return wf;
  }
  var actions = {
    injectBatch: injectBatch,
    cancelWorkflow: function (id, o) {
      o = o || {}; var wf = WF[id]; if (!wf || TERMINAL_STATES.indexOf(wf.status) >= 0) return null;
      var by = o.operator || 'op-park-jh', reason = o.reason || '운영자 요청에 의한 취소', t = clock.now, from = wf.status;
      if (wf.status === 'RUNNING') {
        var att = wf.attempts[wf.attempts.length - 1];
        requestCancelEvents(wf, t, by, reason);
        PLANS[att.pipeline_job_id].cancelAt = t;
        var term = syncAttempt(wf, att, t, false); if (term) finishAttempt(wf, att, term);
      } else cancelBeforeRun(wf, t, by, reason);
      pushAudit(audit(t, by, 'WORKFLOW_CANCELLED', id, { status: from }, { status: 'CANCELLED' }, reason));
      return wf;
    },
    replayDeadLetter: function (dlqId, o) {
      o = o || {}; var dl = getDeadLetter(dlqId); if (!dl || dl.status === 'REPLAYING' || dl.status === 'REPLAYED') return null;
      var orig = WF[dl.workflow_id], by = o.operator || 'op-kim-sy', t = clock.now, reason = o.reason || '일시 장애 해소 확인 후 수동 Replay';
      var ver = o.pipelineVersion || dl.pipeline_version;
      var wf = makeWorkflow({ created: t + 1500, lang: orig.language, utteranceCount: orig.input.utteranceCount, version: ver, pipeline: orig.pipeline_id, priority: o.priority || 8, replayOf: orig.workflow_id, replayCycle: orig.replay_cycle + 1 });
      var rp = { replay_id: 'rpl-' + kstCompact(t) + '-' + pad(++REPLAY_SEQ, 3), dead_letter_id: dl.dead_letter_id, original_workflow_id: orig.workflow_id, replay_workflow_id: wf.workflow_id, replay_cycle: wf.replay_cycle,
        requested_by: by, approved_by: by, reason: reason, pipeline_version_from: orig.pipeline_version, pipeline_version_to: ver, status: 'QUEUED', created_at: t, approved_at: t + 500, completed_at: null };
      var prevApproved = REPLAYS.filter(function (r) { return r.dead_letter_id === dl.dead_letter_id && r.status === 'APPROVED'; })[0];
      if (prevApproved) { prevApproved.status = 'SUPERSEDED'; }
      REPLAYS.push(rp); dl.replay_ids.push(rp.replay_id); dl.status = 'REPLAYING'; dl.updated_at = t; dl.assigned_operator = dl.assigned_operator || by; orig.replayed_by = wf.workflow_id;
      addEvent(orig, 'REPLAY_REQUESTED', t, { dead_letter_id: dl.dead_letter_id, replay_id: rp.replay_id, requested_by: by, reason: reason, pipeline_version: ver, event_type: 'pipeline.batch.replay.requested' }, { att: null });
      addEvent(orig, 'REPLAY_APPROVED', t + 500, { dead_letter_id: dl.dead_letter_id, replay_id: rp.replay_id, approved_by: by, replay_workflow_id: wf.workflow_id, replay_cycle: wf.replay_cycle }, { att: null });
      stepReceived(wf, t + 1500);
      pushAudit(audit(t, by, 'DLQ_REPLAY_APPROVED', dl.dead_letter_id, { status: 'PENDING_REVIEW' }, { status: 'REPLAYING', replay_workflow_id: wf.workflow_id, pipeline_version: ver }, reason));
      emit('dlq', dl);
      return { deadLetter: dl, replay: rp, workflow: wf };
    },
    replayBatch: function (ids, o) { return ids.map(function (id) { return actions.replayDeadLetter(id, o); }).filter(Boolean); },
    closeDeadLetter: function (dlqId, o) {
      o = o || {}; var dl = getDeadLetter(dlqId); if (!dl || dl.status === 'CLOSED') return null;
      var by = o.operator || 'op-kim-sy', t = clock.now, prev = dl.status;
      dl.status = 'CLOSED'; dl.resolution = o.resolution || '영구 실패로 종료 처리'; dl.updated_at = t;
      addEvent(WF[dl.workflow_id], 'DEAD_LETTER_CLOSED', t, { dead_letter_id: dl.dead_letter_id, closed_by: by, resolution: dl.resolution }, { att: null });
      pushAudit(audit(t, by, 'DLQ_CLOSED', dl.dead_letter_id, { status: prev }, { status: 'CLOSED' }, dl.resolution));
      emit('dlq', dl);
      return dl;
    },
    assignDeadLetter: function (dlqId, operatorId) { var dl = getDeadLetter(dlqId); if (!dl) return null; dl.assigned_operator = operatorId; dl.updated_at = clock.now; emit('dlq', dl); return dl; },
    updateLanguage: function (code, patch, o) {
      o = o || {}; var l = LANG[code]; if (!l) return null;
      var by = o.operator || 'op-kim-sy', before = {}, after = {}, t = clock.now;
      Object.keys(patch).forEach(function (k) { before[k] = l[k]; l[k] = patch[k]; after[k] = patch[k]; });
      noteDrift(Object.keys(patch).filter(function (k) { return ['maxConcurrent', 'maxStartsPerMinute', 'priorityWeight'].indexOf(k) >= 0; }).map(function (k) { return 'languages.' + code + '.' + k; }), by, o.reason);
      refreshRuntime();
      var act = patch.paused === true ? 'LANGUAGE_PAUSED' : patch.paused === false ? 'LANGUAGE_RESUMED' : 'CAPACITY_UPDATED';
      addEvent(null, 'CONFIG_UPDATED', t, { event_type: 'pipeline.config.updated', key: 'language:' + code, before: before, after: after, changed_by: by, reason: o.reason || null }, { att: null, language: code });
      pushAudit(audit(t, by, act, 'language:' + code, before, after, o.reason));
      emit('config', { language: code, before: before, after: after });
      return l;
    },
    setGlobalCapacity: function (n, o) {
      o = o || {}; var by = o.operator || 'op-kim-sy', before = config.global.maxConcurrent, t = clock.now;
      config.global.maxConcurrent = n; noteDrift(['global.maxConcurrent'], by, o.reason); refreshRuntime();
      addEvent(null, 'CONFIG_UPDATED', t, { event_type: 'pipeline.config.updated', key: 'global.maxConcurrent', before: before, after: n, changed_by: by, reason: o.reason || null }, { att: null });
      pushAudit(audit(t, by, 'CAPACITY_UPDATED', 'global.maxConcurrent', { value: before }, { value: n }, o.reason));
      emit('config', { global: true, before: before, after: n });
      return config.global;
    },
    updateRetryPolicy: function (patch, o) {
      o = o || {}; var by = o.operator || 'op-kim-sy', before = JSON.parse(JSON.stringify(config.retry));
      Object.assign(config.retry, patch); noteDrift(['retry.maxRetries', 'retry.backoffSeconds'], by, o.reason); refreshRuntime();
      pushAudit(audit(clock.now, by, 'CONFIG_UPDATED', 'retry', before, JSON.parse(JSON.stringify(config.retry)), o.reason));
      emit('config', { retry: config.retry });
      return config.retry;
    },
    acknowledgeAlert: function (id, operatorId) { var a = ALERTS.filter(function (x) { return x.alert_id === id; })[0]; if (!a) return null; a.status = 'ACKNOWLEDGED'; a.acknowledged_by = operatorId || 'op-park-jh'; emit('alert', a); return a; },
    resolveAlert: function (id) { var a = ALERTS.filter(function (x) { return x.alert_id === id; })[0]; if (!a) return null; a.status = 'RESOLVED'; a.resolved_at = clock.now; emit('alert', a); return a; }
  };

  // ───────────────────────────────────────────── simulator ──
  var SIM_ACTIVE = null;
  function createSimulator(opts) {
    opts = opts || {};
    var speed = opts.speed || 1, tickMs = opts.tickMs || 1200, vsec = opts.virtualSecondsPerTick || 20;
    var injectRate = opts.injectRate != null ? opts.injectRate : 0.22, failMul = opts.failureRate != null ? opts.failureRate : 1;
    var rng = makeRng(opts.seed || 4242), timer = null, tickNo = 0, starts = [];
    function simPlan(w, n) {
      var p = n === 1 ? 0.09 : n === 2 ? 0.3 : 0.4;
      var fail = rng.chance(Math.min(0.95, p * failMul));
      var cat = null;
      if (fail) { cat = rng.weighted(n === 1 ? { MODEL_TRANSIENT: 4, PIPELINE_EXECUTION: 2, QUOTA: 1.5, CODE_DEFECT: 0.6, INPUT_SCHEMA: 0.35, TIMEOUT: 0.5, AUTH_PERMISSION: 0.15 } : { MODEL_TRANSIENT: 4, PIPELINE_EXECUTION: 2, QUOTA: 1.5, TIMEOUT: 0.5 }); }
      return makePlan(rng, w.language, w.pipeline_version, w.input.utteranceCount, fail ? 'FAILED' : 'SUCCEEDED', cat, undefined, w.pipeline_id);
    }
    function canAdmit(lang, now) {
      var L = LANG[lang];
      if (!L.enabled || L.paused) return false;
      if (activeCount(lang) >= L.maxConcurrent || activeCount() >= config.global.maxConcurrent) return false;
      var recent = starts.filter(function (s) { return s.t > now - MIN; });
      if (recent.filter(function (s) { return s.lang === lang; }).length >= L.maxStartsPerMinute) return false;
      if (recent.length >= config.global.maxStartsPerMinute) return false;
      return true;
    }
    function raiseAlert(o) { var a = mkAlert(Object.assign({ status: 'OPEN', resolved_at: null, acknowledged_by: null, incident_id: null }, o)); ALERTS.sort(function (x, y) { return y.opened_at - x.opened_at; }); emit('alert', a); return a; }
    function after(w, prevStatus) {
      if (w.replay_of) REPLAYS.filter(function (r) { return r.replay_workflow_id === w.workflow_id; }).forEach(function (r) { var s = r.status; syncReplayStatus(r); if (r.status !== s) { var dl = getDeadLetter(r.dead_letter_id); if (dl) emit('dlq', dl); } });
      if (w.status === 'DEAD_LETTERED' && prevStatus !== 'DEAD_LETTERED') {
        var dl2 = getDeadLetter(w.dead_letter_id);
        raiseAlert({ policy_id: 'ap-dlq-new', severity: 'CRITICAL', title: 'DLQ 신규 발생: ' + dl2.dead_letter_id, message: w.language + ' · ' + dl2.failure_category + ' · ' + dl2.error_code + ' (' + dl2.attempts + '회 시도)', language: w.language, workflow_id: w.workflow_id, dead_letter_id: dl2.dead_letter_id, opened_at: dl2.created_at + 4000 });
      }
      if (w.status === 'SUCCEEDED' && prevStatus !== 'SUCCEEDED') emit('result', { workflow_id: w.workflow_id, file: w.result });
    }
    function tick() {
      var prevG = G; G = rng;
      try {
        tickNo++;
        var prev = clock.now, now = prev + Math.round(vsec * 1000 * speed), span = now - prev;
        clock.now = now;
        var tin = function (w) { return Math.min(now, Math.max((w ? w.updated_at : prev) + 400, prev + span * rng.float(0.1, 0.9))); };
        // 1. running pipelines
        WORKFLOWS.filter(function (w) { return w.status === 'RUNNING'; }).forEach(function (w) {
          var att = w.attempts[w.attempts.length - 1], term = syncAttempt(w, att, now, true);
          if (term && term.at <= now - 8000) { var ps = w.status; finishAttempt(w, att, term); after(w, ps); }
        });
        // 2. dispatching -> running
        WORKFLOWS.filter(function (w) { return w.status === 'DISPATCHING' && w.updated_at <= prev; }).forEach(function (w) { stepPipelineStarted(w, w.attempts[w.attempts.length - 1], tin(w)); after(w, 'DISPATCHING'); });
        // 3. reserved -> dispatching
        WORKFLOWS.filter(function (w) { return w.status === 'RESERVED' && w.updated_at <= prev; }).forEach(function (w) { stepDispatching(w, tin(w), simPlan(w, 1)); });
        // 4. retry wait due -> re-admission
        WORKFLOWS.filter(function (w) { return w.status === 'RETRY_WAIT' && w.retry_at <= now && w.updated_at <= prev; }).sort(function (a, b) { return a.retry_at - b.retry_at; }).forEach(function (w) {
          if (!canAdmit(w.language, now)) return;
          var t = Math.min(now - 2600, Math.max(w.retry_at + 1000, prev + 500)); starts.push({ lang: w.language, t: t });
          stepRetryStart(w, t, simPlan(w, w.attempts.length + 1)); after(w, 'RETRY_WAIT');
        });
        // 5. admission (priority + aging, then FIFO)
        var q = WORKFLOWS.filter(function (w) { return w.status === 'QUEUED' && w.updated_at <= prev; });
        var eff = function (w) { var ag = config.queuePolicy.aging; return w.priority + (ag.enabled ? Math.min(ag.maxBoost, Math.floor((now - w.queued_at) / (ag.boostPerMinutes * MIN))) : 0); };
        q.sort(function (a, b) { return (eff(b) - eff(a)) || (a.queued_at - b.queued_at); });
        q.forEach(function (w) { if (!canAdmit(w.language, now)) return; var t = tin(w); starts.push({ lang: w.language, t: t }); stepReserved(w, t); after(w, 'QUEUED'); });
        starts = starts.filter(function (s) { return s.t > now - 2 * MIN; });
        // 6. intake
        WORKFLOWS.filter(function (w) { return w.status === 'VALIDATED' && w.updated_at <= prev; }).forEach(function (w) { stepQueued(w, tin(w)); });
        WORKFLOWS.filter(function (w) { return w.status === 'RECEIVED' && w.updated_at <= prev; }).forEach(function (w) { stepValidated(w, tin(w)); });
        // 7. new GCS batches
        var p = Math.min(0.95, injectRate * speed), k = 0;
        while (k < 3 && rng.chance(p)) { k++; var nw = injectBatch({ at: prev + span * rng.float(0.05, 0.95) }); emit('ingest', { workflow_id: nw.workflow_id, object: gcsGet(BUCKET_IN, nw.input.object), workflow: nw }); p *= 0.35; }
        // 8. lease renewal + reconciler
        RESERVATIONS.forEach(function (r) { if (r.status === 'ACTIVE') { r.lease_expires_at = now + config.reservationLeaseMin * MIN; r.updated_at = now; } });
        if (now >= BASE_NOW + 2 * MIN) RESERVATIONS.forEach(function (r) {
          if (r.status !== 'ORPHANED') return;
          r.status = 'RELEASED'; r.released_at = now; r.updated_at = now; r.note = 'Reconciler: Vertex 상태 SUCCEEDED 확인 후 반환';
          addEvent(null, 'SLOT_RECONCILED', now - 1000, { reservation_id: r.reservation_id, workflow_id: r.workflow_id, action: 'released' }, { att: null, language: r.language });
          addLog(null, now - 900, 'INFO', 'reconciler', 'Released orphaned reservation ' + r.reservation_id + ' (' + r.workflow_id + ' already SUCCEEDED)', { component: 'reconciler', event_type: 'RECONCILE_OK' });
          ALERTS.forEach(function (a) { if (a.policy_id === 'ap-slot-mismatch' && a.status !== 'RESOLVED') { a.status = 'RESOLVED'; a.resolved_at = now; emit('alert', a); } });
        });
        // 9. backlog alerts
        getCapacity().languages.forEach(function (l) {
          var open = ALERTS.filter(function (a) { return a.policy_id === 'ap-backlog' && a.language === l.code && a.status !== 'RESOLVED'; })[0];
          if (!open && l.backlog > l.backlogAlertThreshold) raiseAlert({ policy_id: 'ap-backlog', severity: 'WARNING', title: LANG[l.code].name + ' Backlog 임계치 초과', message: l.code + ' backlog ' + l.backlog + '건 (임계 ' + l.backlogAlertThreshold + ')', language: l.code, opened_at: now });
          else if (open && l.backlog <= Math.floor(l.backlogAlertThreshold / 2)) { open.status = 'RESOLVED'; open.resolved_at = now; emit('alert', open); }
        });
        // 10. 5-min metrics
        while (lastFive + 5 * MIN <= now) { lastFive += 5 * MIN; pushFive(lastFive, true); emit('metrics', { series: 'fiveMin', ts: lastFive }); }
      } finally { G = prevG; }
      var snap = snapshot();
      emit('tick', snap);
      return snap;
    }
    function snapshot() {
      var ov = overview();
      var stageCounts = {}; STAGES.forEach(function (s) { stageCounts[s.id] = 0; }); WORKFLOWS.forEach(function (w) { stageCounts[w.stage]++; });
      return { tick: tickNo, now: clock.now, nowIso: isoKst(clock.now), speed: speed, running: !!timer, counts: ov.statusDistribution, stageCounts: stageCounts, overview: ov, capacity: ov.capacity,
        activeWorkflows: WORKFLOWS.filter(function (w) { return TERMINAL_STATES.indexOf(w.status) < 0; }).map(function (w) { return w.workflow_id; }), recentEvents: recentEvents(20) };
    }
    var sim = {
      start: function () { if (timer) return sim; if (SIM_ACTIVE && SIM_ACTIVE !== sim) SIM_ACTIVE.stop(); SIM_ACTIVE = sim; timer = setInterval(tick, tickMs); emit('sim', { running: true, speed: speed }); return sim; },
      stop: function () { if (timer) { clearInterval(timer); timer = null; emit('sim', { running: false, speed: speed }); } return sim; },
      tick: tick, step: function (n) { var s; for (var i = 0; i < (n || 1); i++) s = tick(); return s; },
      on: on, off: off, snapshot: snapshot,
      setSpeed: function (n) { speed = Math.max(0.1, +n || 1); emit('sim', { running: !!timer, speed: speed }); return sim; },
      getSpeed: function () { return speed; }, isRunning: function () { return !!timer; }, now: function () { return clock.now; }
    };
    return sim;
  }

  // ───────────────────────────────────────────── export ──

  // ───────────────────────────────────────────── AIPO web extensions (not in the prototype) ──
  // Added for the Operations API. They never run during the static build, so they do not
  // change any generated ID / value (determinism is identical to designs/mock-data.js).
  function configChange(by, key, before, after, reason, action) {
    var t = clock.now;
    refreshRuntime();
    addEvent(null, 'CONFIG_UPDATED', t, { event_type: 'pipeline.config.updated', key: key, before: before, after: after, changed_by: by, reason: reason || null }, { att: null });
    var a = pushAudit(audit(t, by, action || 'CONFIG_UPDATED', key, before, after, reason));
    emit('config', { key: key, before: before, after: after });
    return a;
  }
  actions.updateConfig = function (patch, o) {
    o = o || {}; var by = o.operator || 'op-kim-sy', reason = o.reason || null, changed = [];
    if (patch.retry) {
      var rb = { maxRetries: config.retry.maxRetries, backoffSeconds: config.retry.backoffSeconds.slice() };
      if (patch.retry.maxRetries != null) { config.retry.maxRetries = patch.retry.maxRetries; config.retry.maxAttempts = patch.retry.maxRetries + 1; }
      if (patch.retry.backoffSeconds) config.retry.backoffSeconds = patch.retry.backoffSeconds.slice();
      noteDrift(['retry.maxRetries', 'retry.backoffSeconds'], by, reason);
      configChange(by, 'retry', rb, { maxRetries: config.retry.maxRetries, backoffSeconds: config.retry.backoffSeconds.slice() }, reason); changed.push('retry');
    }
    ['workflowTimeoutMin', 'pipelineTimeoutMin'].forEach(function (k) {
      if (patch[k] == null || patch[k] === config[k]) return;
      var b = config[k]; config[k] = patch[k];
      noteDrift([k], by, reason);
      configChange(by, k, { value: b }, { value: patch[k] }, reason); changed.push(k);
    });
    if (patch.queuePolicy) {
      var qb = JSON.parse(JSON.stringify(config.queuePolicy));
      if (patch.queuePolicy.mode) config.queuePolicy.mode = patch.queuePolicy.mode;
      if (patch.queuePolicy.aging) Object.assign(config.queuePolicy.aging, patch.queuePolicy.aging);
      configChange(by, 'queuePolicy', qb, JSON.parse(JSON.stringify(config.queuePolicy)), reason); changed.push('queuePolicy');
    }
    if (patch.defaultPipelineVersion && patch.defaultPipelineVersion !== config.defaultPipelineVersion) {
      var dv = config.defaultPipelineVersion; config.defaultPipelineVersion = patch.defaultPipelineVersion; noteDrift(['defaultPipelineVersion'], by, reason);
      configChange(by, 'defaultPipelineVersion', { default: dv }, { default: patch.defaultPipelineVersion }, reason, 'PIPELINE_VERSION_PROMOTED'); changed.push('defaultPipelineVersion');
    }
    if (patch.versionTraffic) {
      var tb = {}, ta = {};
      PIPELINE_VERSIONS.forEach(function (v) { if (patch.versionTraffic[v.version] != null) { tb[v.version] = v.trafficPct; v.trafficPct = patch.versionTraffic[v.version]; ta[v.version] = v.trafficPct; } });
      configChange(by, 'pipeline.traffic', tb, ta, reason, 'PIPELINE_VERSION_TRAFFIC'); changed.push('versionTraffic');
    }
    if (patch.services) Object.keys(patch.services).forEach(function (id) {
      var s = SERVICES.filter(function (x) { return x.id === id; })[0]; if (!s) return;
      var en = !!patch.services[id].enabled; if (s.enabled === en) return;
      s.enabled = en;
      configChange(by, 'service:' + id, { enabled: !en }, { enabled: en }, reason, en ? 'SERVICE_ENABLED' : 'SERVICE_DISABLED'); changed.push('service:' + id);
    });
    if (patch.alertPolicies) Object.keys(patch.alertPolicies).forEach(function (id) {
      var p = ALERT_POLICIES.filter(function (x) { return x.id === id; })[0]; if (!p) return;
      var en = !!patch.alertPolicies[id].enabled; if (p.enabled === en) return;
      p.enabled = en;
      configChange(by, 'alertPolicy:' + id, { enabled: !en }, { enabled: en }, reason, en ? 'ALERT_POLICY_ENABLED' : 'ALERT_POLICY_DISABLED'); changed.push('alertPolicy:' + id);
    });
    return changed;
  };
  actions.setGlobalStartsPerMinute = function (n, o) {
    o = o || {}; var by = o.operator || 'op-kim-sy', before = config.global.maxStartsPerMinute;
    config.global.maxStartsPerMinute = n;
    noteDrift(['global.maxStartsPerMinute'], by, o.reason);
    configChange(by, 'global.maxStartsPerMinute', { value: before }, { value: n }, o.reason, 'CAPACITY_UPDATED');
    return config.global;
  };
  var _internal = {
    audit: audit, pushAudit: pushAudit, addEvent: addEvent, addLog: addLog, refreshRuntime: refreshRuntime, emit: emit,
    clock: clock, OP: OP, LANG: LANG, WF: WF, gcsGet: gcsGet, inputLine: inputLine, genUtterances: genUtterances, kstDayStart: kstDayStart,
    DRIFT_NOTES: DRIFT_NOTES, rowCacheStats: function () { return { workflows: ROW_CACHE.size, rows: ROW_CACHE_ROWS, max: ROW_CACHE_MAX, hits: ROW_STATS.hits, misses: ROW_STATS.misses, evictions: ROW_STATS.evictions }; },
    RESULTS_BY_WF: RESULTS_BY_WF, PIPELINE_VERSIONS: PIPELINE_VERSIONS, SERVICES: SERVICES, ALERT_POLICIES: ALERT_POLICIES,
    kstDate: kstDate, isoKst: isoKst, BASE_NOW: BASE_NOW, TODAY_START: TODAY_START
  };

  var MOCK = {
    meta: { name: 'AIPO · 빅스비 실발화 평가 Mock', version: '1.0.0', baseNow: BASE_NOW, baseNowIso: isoKst(BASE_NOW), timezone: 'Asia/Seoul', seed: 20261112, project: PROJECT, region: REGION,
      notes: 'Design-stage mock. workflows[] is the Firestore page loaded by the console; metrics.* are BigQuery platform-wide aggregates (larger scale than the sample). All *_at / ts fields are epoch ms numbers.' },
    now: function () { return clock.now; },
    config: config, languages: LANGS, operators: OPERATORS, stages: STAGES, stageEdges: STAGE_EDGES, STATE_TO_STAGE: STATE_TO_STAGE,
    states: STATES, ACTIVE_STATES: ACTIVE_STATES, TERMINAL_STATES: TERMINAL_STATES, DAG_TEMPLATE: DAG_TEMPLATE,
    statusMeta: statusMeta, nodeStatusMeta: nodeStatusMeta, attemptStatusMeta: attemptStatusMeta, dlqStatusMeta: dlqStatusMeta, severityMeta: severityMeta,
    failureCategoryMeta: failureCategoryMeta, failureReasonMeta: failureReasonMeta, eventCatalog: EVENT_CATALOG, capsules: CAPSULES, devices: DEVICES.map(function (d) { return d.id; }),
    workflows: WORKFLOWS, getWorkflow: getWorkflow, listWorkflows: listWorkflows, workflowsByStage: workflowsByStage,
    events: { all: EVENTS_ALL, byWorkflow: EVENTS_BY_WF, recent: recentEvents, forWorkflow: function (id) { return EVENTS_BY_WF[id] || []; } },
    getEvents: function (id) { return EVENTS_BY_WF[id] || []; },
    logs: { all: LOGS_ALL, byWorkflow: LOGS_BY_WF, system: LOGS_SYSTEM, recent: function (n, f) { return queryLogs(Object.assign({ limit: n || 50, order: 'desc', to: clock.now }, f || {})); }, query: queryLogs },
    getLogs: function (id, f) { return queryLogs(Object.assign({ workflow_id: id, order: 'asc' }, f || {})); },
    gcs: { buckets: BUCKETS, objects: GCS_OBJECTS, list: gcsList, get: gcsGet, read: gcsRead, sampleLines: sampleLines },
    dlq: DLQ, replays: REPLAYS, getDeadLetter: getDeadLetter,
    reservations: RESERVATIONS, getCapacity: getCapacity, overview: overview,
    metrics: { hourly: hourly, fiveMin: fiveMin, daily: daily, errorCategories7d: errorCategories7d },
    pipelines: {
      registry: PIPELINES, components: COMPONENTS, models: MODELS, get: pipeVer, leafComponents: leafComponents, templateObject: templateObject,
      jobTree: jobTree, plan: function (jobId) { return PLANS[jobId] || null; }
    },
    dataWindow: function () {
      var e = hourly.ts[0];
      for (var i = 0; i < WORKFLOWS.length; i++) if (WORKFLOWS[i].created_at != null && WORKFLOWS[i].created_at < e) e = WORKFLOWS[i].created_at;
      return { earliest: e, now: clock.now, historyDays: HISTORY_DAYS };
    },
    alerts: ALERTS, incidents: INCIDENTS, audit: AUDIT,
    results: { columns: RESULT_COLUMNS, get rows() { return todayRows(); }, file: RESULT_FILE, files: AGG_FILES, byWorkflow: function (id) { return rowsFor(WF[id]); }, forWorkflow: function (id) { return rowsFor(WF[id]); }, summary: resultsSummary, toCSV: toCSV,
      rowsFor: rowsFor, rowsInRange: rowsInRange, succeededBetween: succeededBetween },
    actions: actions, on: on, off: off, createSimulator: createSimulator, fmt: fmt
  };
  on('result', function () { AGG_FILES.forEach(refreshAgg); });
  MOCK._internal = _internal;
  return MOCK;
}
