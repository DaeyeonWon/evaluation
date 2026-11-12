import { PIPELINE_VERSIONS } from "@/lib/catalog";
import type { AppConfig, AuditEntry, ConfigPatch, ConfigUpdateResult } from "@/lib/types";
import { V, badRequest } from "../http";
import { getEngine } from "../mock/runtime";

export function getConfig(): AppConfig {
  const e = getEngine();
  e._internal.refreshRuntime();
  const c = e.config;
  return { ...c, drift: c.drift() } as AppConfig;
}

function obj(v: unknown, label: string): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw badRequest(`${label}는 객체여야 합니다.`, { field: label });
  return v as Record<string, unknown>;
}

/** Validate + normalize a PATCH /config body into the engine's ConfigPatch. */
export function parseConfigPatch(body: Record<string, unknown>): ConfigPatch {
  const e = getEngine();
  const patch: ConfigPatch = {};
  const retry = obj(body.retry, "retry");
  if (retry) {
    const mr = V.int(retry, "maxRetries", 0, 5, "retry.maxRetries");
    let bo: number[] | undefined;
    if (retry.backoffSeconds !== undefined) {
      const b = retry.backoffSeconds;
      if (!Array.isArray(b) || !b.length || b.some((x) => typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > 3600))
        throw badRequest("retry.backoffSeconds는 1~3600 사이 정수 배열이어야 합니다.", { field: "retry.backoffSeconds" });
      bo = b as number[];
    }
    if (mr !== undefined || bo) patch.retry = { ...(mr !== undefined ? { maxRetries: mr } : {}), ...(bo ? { backoffSeconds: bo } : {}) };
  }
  const wt = V.int(body, "workflowTimeoutMin", 5, 360, "workflowTimeoutMin");
  const pt = V.int(body, "pipelineTimeoutMin", 5, 360, "pipelineTimeoutMin");
  const effW = wt ?? e.config.workflowTimeoutMin;
  const effP = pt ?? e.config.pipelineTimeoutMin;
  if (effP > effW) throw badRequest(`pipelineTimeoutMin(${effP})은 workflowTimeoutMin(${effW})보다 클 수 없습니다.`, { field: "pipelineTimeoutMin" });
  if (wt !== undefined) patch.workflowTimeoutMin = wt;
  if (pt !== undefined) patch.pipelineTimeoutMin = pt;
  const qp = obj(body.queuePolicy, "queuePolicy");
  if (qp) {
    const aging = obj(qp.aging, "queuePolicy.aging");
    const p: NonNullable<ConfigPatch["queuePolicy"]> = {};
    if (aging) {
      p.aging = {};
      const en = V.bool(aging, "enabled", "queuePolicy.aging.enabled");
      const bpm = V.int(aging, "boostPerMinutes", 1, 120, "queuePolicy.aging.boostPerMinutes");
      const mb = V.int(aging, "maxBoost", 0, 10, "queuePolicy.aging.maxBoost");
      if (en !== undefined) p.aging.enabled = en;
      if (bpm !== undefined) p.aging.boostPerMinutes = bpm;
      if (mb !== undefined) p.aging.maxBoost = mb;
    }
    const mode = V.str(qp, "mode", { label: "queuePolicy.mode" });
    if (mode) {
      if (!["PRIORITY_THEN_FIFO", "FIFO"].includes(mode)) throw badRequest("queuePolicy.mode는 PRIORITY_THEN_FIFO 또는 FIFO 입니다.");
      p.mode = mode;
    }
    patch.queuePolicy = p;
  }
  const dv = V.str(body, "defaultPipelineVersion");
  if (dv) {
    if (!PIPELINE_VERSIONS.includes(dv)) throw badRequest(`알 수 없는 pipeline 버전입니다: ${dv}`, { allowed: PIPELINE_VERSIONS });
    const det = e._internal.PIPELINE_VERSIONS.find((v) => v.version === dv);
    if (det?.status === "DEPRECATED") throw badRequest(`지원 종료(DEPRECATED)된 버전은 기본 버전으로 지정할 수 없습니다: ${dv}`);
    patch.defaultPipelineVersion = dv;
  }
  const vt = obj(body.versionTraffic, "versionTraffic");
  if (vt) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(vt)) {
      if (!PIPELINE_VERSIONS.includes(k)) throw badRequest(`알 수 없는 pipeline 버전입니다: ${k}`);
      if (typeof v !== "number" || v < 0 || v > 100) throw badRequest(`versionTraffic.${k}는 0~100 사이 숫자여야 합니다.`);
      out[k] = v;
    }
    const merged = Object.fromEntries(e._internal.PIPELINE_VERSIONS.map((p) => [p.version, out[p.version] ?? p.trafficPct]));
    const total = Object.values(merged).reduce((s, x) => s + x, 0);
    if (Math.round(total) !== 100) throw badRequest(`버전별 트래픽 합계는 100%여야 합니다 (현재 ${total}%).`, { merged });
    patch.versionTraffic = out;
  }
  const sv = obj(body.services, "services");
  if (sv) {
    patch.services = {};
    for (const [id, v] of Object.entries(sv)) {
      if (!e._internal.SERVICES.some((s) => s.id === id)) throw badRequest(`알 수 없는 서비스입니다: ${id}`);
      const en = V.bool(obj(v, `services.${id}`) ?? {}, "enabled", `services.${id}.enabled`);
      if (en === undefined) throw badRequest(`services.${id}.enabled를 지정해 주세요.`);
      patch.services[id] = { enabled: en };
    }
  }
  const ap = obj(body.alertPolicies, "alertPolicies");
  if (ap) {
    patch.alertPolicies = {};
    for (const [id, v] of Object.entries(ap)) {
      if (!e._internal.ALERT_POLICIES.some((s) => s.id === id)) throw badRequest(`알 수 없는 알림 정책입니다: ${id}`);
      const en = V.bool(obj(v, `alertPolicies.${id}`) ?? {}, "enabled", `alertPolicies.${id}.enabled`);
      if (en === undefined) throw badRequest(`alertPolicies.${id}.enabled를 지정해 주세요.`);
      patch.alertPolicies[id] = { enabled: en };
    }
  }
  if (!Object.keys(patch).length) throw badRequest("변경할 설정 항목이 없습니다.");
  return patch;
}

export function patchConfig(body: Record<string, unknown>, operatorId: string): ConfigUpdateResult {
  const e = getEngine();
  const patch = parseConfigPatch(body);
  const reason = V.reason(body);
  const before = e.audit.length;
  const changed = e.actions.updateConfig(patch, { operator: operatorId, reason });
  const audit: AuditEntry[] = e.audit.slice(0, e.audit.length - before);
  return { changed, config: getConfig(), audit };
}
