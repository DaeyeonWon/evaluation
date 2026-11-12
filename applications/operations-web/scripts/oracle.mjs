// Oracle: fingerprint the approved prototype (designs/mock-data.js) vs the port (src/server/mock/engine.ts).
// Usage: npm run oracle   (exit 0 = IDENTICAL). Run after ANY change to src/server/mock/engine.ts.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const PROTOTYPE = path.resolve(APP, '../../designs/mock-data.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aipo-oracle-'));

function fingerprint(M) {
  const h = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
  const out = {
    workflows: h(M.workflows.map((w) => [w.workflow_id, w.status, w.created_at, w.attempts.length, w.idempotency_key, w.progress])),
    nWorkflows: M.workflows.length,
    dlq: h(M.dlq), nDlq: M.dlq.length,
    replays: h(M.replays),
    rows: M.results.rows.length, rowsHash: h(M.results.rows),
    events: M.events.all.length, eventsHash: h(M.events.all),
    logs: M.logs.all.length, logsHash: h(M.logs.all),
    gcs: h(M.gcs.objects),
    overview: h(M.overview()), capacity: h(M.getCapacity()),
    audit: h(M.audit), alerts: h(M.alerts), incidents: h(M.incidents),
    metrics: h([M.metrics.hourly, M.metrics.fiveMin, M.metrics.daily, M.metrics.errorCategories7d, M.metrics.componentDurations(), M.metrics.versionComparison(), M.metrics.languageSummary()]),
    stage: h(['gcs_input', 'vertex', 'dlq', 'results'].map((s) => M.stageDetail(s))),
    csv: h(M.results.toCSV(M.results.rows.slice(0, 50), { bom: true })),
    config: h([M.config, M.config.drift()]),
  };
  const sim = M.createSimulator({ seed: 4242 });
  const snaps = [];
  for (let i = 0; i < 12; i++) snaps.push(sim.tick());
  out.simWorkflows = h(M.workflows.map((w) => [w.workflow_id, w.status, w.updated_at]));
  out.simEvents = M.events.all.length; out.simEventsHash = h(M.events.all);
  out.simLogs = M.logs.all.length;
  out.simAlerts = h(M.alerts);
  out.snap = h(snaps.map((s) => [s.now, s.counts, s.stageCounts, s.overview]));
  // actions
  const dl = M.dlq.find((d) => d.status === 'PENDING_REVIEW');
  const r = M.actions.replayDeadLetter(dl.dead_letter_id, { reason: 'x' });
  out.replay = h([r.replay, r.workflow.workflow_id]);
  M.actions.updateLanguage('ko', { maxConcurrent: 12 }, { reason: 'y' });
  out.afterActions = h([M.audit.slice(0, 3), M.getCapacity()]);
  return out;
}

// prototype
require(PROTOTYPE);
const A = fingerprint(globalThis.MOCK);

// port
fs.copyFileSync(path.join(APP, 'src/server/mock/engine.ts'), path.join(TMP, 'engine.mjs'));
const { createMockEngine } = await import(path.join(TMP, 'engine.mjs'));
const B = fingerprint(createMockEngine(globalThis));

let ok = true;
for (const k of Object.keys(A)) {
  const same = JSON.stringify(A[k]) === JSON.stringify(B[k]);
  if (!same) ok = false;
  console.log((same ? 'OK  ' : 'DIFF') + ' ' + k.padEnd(14) + ' ' + JSON.stringify(A[k]) + (same ? '' : ' vs ' + JSON.stringify(B[k])));
}
console.log(ok ? '\nORACLE: IDENTICAL' : '\nORACLE: MISMATCH');
process.exit(ok ? 0 : 1);
