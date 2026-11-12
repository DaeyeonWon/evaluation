import { LANG_CODES } from "@/lib/catalog";
import type {
  AuditEntry,
  CapacityChangeResult,
  CapacityImpact,
  GlobalCapacity,
  GlobalCapacityChangeResult,
  LangCode,
  LanguageConfig,
} from "@/lib/types";
import { V, badRequest, notFound } from "../http";
import { getEngine } from "../mock/runtime";

export function parseLang(lang: string): LangCode {
  if (!LANG_CODES.includes(lang as LangCode)) throw notFound(`지원하지 않는 언어 코드입니다: ${lang} (ko, en, ja, es 중 하나)`);
  return lang as LangCode;
}

export function globalCapacity(): GlobalCapacity {
  const e = getEngine();
  const cap = e.getCapacity();
  return {
    maxConcurrent: e.config.global.maxConcurrent,
    maxStartsPerMinute: e.config.global.maxStartsPerMinute,
    active: cap.global.active,
    utilization: cap.global.utilization,
  };
}

const FIELD_LABEL: Record<string, string> = {
  maxConcurrent: "최대 동시 실행",
  priorityWeight: "우선순위 가중치",
  maxStartsPerMinute: "분당 최대 시작",
  paused: "일시 중지",
  enabled: "활성화",
};

function impactFor(lang: LangCode, field: keyof LanguageConfig, before: number | boolean, after: number | boolean): CapacityImpact {
  const e = getEngine();
  const l = e.getCapacity().languages.find((x) => x.code === lang)!;
  const label = FIELD_LABEL[field] ?? field;
  let overLimitBy = 0;
  let message = `${l.name} ${label}: ${before} → ${after}`;
  if (field === "maxConcurrent" && typeof after === "number") {
    overLimitBy = Math.max(0, l.active - after);
    if (after > (before as number))
      message += ` · 대기열 ${l.backlog}건 중 최대 ${Math.min(l.backlog, after - l.active)}건이 다음 스케줄링 주기에 Slot을 확보할 수 있습니다.`;
    else if (overLimitBy > 0)
      message += ` · 현재 실행 중 ${l.active}건이 새 한도를 ${overLimitBy}건 초과합니다. 실행 중인 작업은 계속되며, 한도 아래로 내려갈 때까지 신규 Admission이 중단됩니다.`;
    else message += ` · 현재 실행 중 ${l.active}건은 영향 없음.`;
  } else if (field === "paused") {
    message = after
      ? `${l.name} 일시 중지: 실행 중 ${l.active}건은 계속 진행되고, 대기열 ${l.backlog}건은 재개 시까지 Admission되지 않습니다.`
      : `${l.name} 재개: 대기열 ${l.backlog}건이 다음 스케줄링 주기부터 Admission 대상이 됩니다.`;
  } else if (field === "priorityWeight") {
    message += " · 언어 간 Weighted Round Robin 비율이 다음 주기부터 반영됩니다.";
  } else if (field === "maxStartsPerMinute") {
    message += " · 분당 시작 Rate Limit이 즉시 반영됩니다.";
  }
  return { language: lang, field, before, after, activeNow: l.active, backlog: l.backlog, overLimitBy, message };
}

export function patchLanguageCapacity(
  langRaw: string,
  body: Record<string, unknown>,
  operatorId: string,
  dryRun: boolean,
): CapacityChangeResult {
  const e = getEngine();
  const lang = parseLang(langRaw);
  const gmax = e.config.global.maxConcurrent;
  const patch: Partial<LanguageConfig> = {};
  const mc = V.int(body, "max_concurrent", 0, 100, "max_concurrent");
  if (mc !== undefined) {
    if (mc > gmax) throw badRequest(`max_concurrent(${mc})는 Global 최대 동시 실행(${gmax})을 넘을 수 없습니다.`, { field: "max_concurrent", max: gmax });
    patch.maxConcurrent = mc;
  }
  const pw = V.int(body, "priority_weight", 1, 10, "priority_weight");
  if (pw !== undefined) patch.priorityWeight = pw;
  const sp = V.int(body, "max_starts_per_minute", 1, 60, "max_starts_per_minute");
  if (sp !== undefined) patch.maxStartsPerMinute = sp;
  const paused = V.bool(body, "paused");
  const enabled = V.bool(body, "enabled");
  if (!Object.keys(patch).length && paused === undefined && enabled === undefined)
    throw badRequest("변경할 항목이 없습니다. max_concurrent, priority_weight, max_starts_per_minute, paused, enabled 중 하나 이상을 지정해 주세요.");
  const reason = dryRun ? (V.str(body, "reason") ?? "") : V.reason(body);

  const L = e._internal.LANG[lang];
  const impact: CapacityImpact[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof LanguageConfig, number][]) {
    if (L[k] !== v) impact.push(impactFor(lang, k, L[k] as number, v));
  }
  if (paused !== undefined && paused !== L.paused) impact.push(impactFor(lang, "paused", L.paused, paused));
  if (enabled !== undefined && enabled !== L.enabled) impact.push(impactFor(lang, "enabled", L.enabled, enabled));

  const audit: AuditEntry[] = [];
  if (!dryRun) {
    const changedNums = Object.fromEntries(Object.entries(patch).filter(([k, v]) => L[k as keyof LanguageConfig] !== v));
    if (Object.keys(changedNums).length) {
      e.actions.updateLanguage(lang, changedNums, { operator: operatorId, reason });
      audit.push(e.audit[0]);
    }
    if (enabled !== undefined && enabled !== L.enabled) {
      e.actions.updateLanguage(lang, { enabled }, { operator: operatorId, reason });
      audit.push(e.audit[0]);
    }
    if (paused !== undefined && paused !== L.paused) {
      e.actions.updateLanguage(lang, { paused }, { operator: operatorId, reason });
      audit.push(e.audit[0]);
    }
  }
  const capacity = e.getCapacity();
  return { dryRun, language: capacity.languages.find((l) => l.code === lang)!, capacity, impact, audit };
}

export function patchGlobalCapacity(body: Record<string, unknown>, operatorId: string, dryRun: boolean): GlobalCapacityChangeResult {
  const e = getEngine();
  const mc = V.int(body, "max_concurrent", 1, 200, "max_concurrent");
  const sp = V.int(body, "max_starts_per_minute", 1, 120, "max_starts_per_minute");
  if (mc === undefined && sp === undefined) throw badRequest("변경할 항목이 없습니다. max_concurrent 또는 max_starts_per_minute를 지정해 주세요.");
  if (mc !== undefined) {
    const maxLang = Math.max(...e.languages.map((l) => l.maxConcurrent));
    if (mc < maxLang) throw badRequest(`Global 최대 동시 실행(${mc})은 언어별 최대값(${maxLang})보다 작을 수 없습니다.`, { field: "max_concurrent", min: maxLang });
  }
  const reason = dryRun ? (V.str(body, "reason") ?? "") : V.reason(body);
  const cap = e.getCapacity();
  const impact: CapacityImpact[] = [];
  if (mc !== undefined && mc !== e.config.global.maxConcurrent) {
    const over = Math.max(0, cap.global.active - mc);
    impact.push({
      language: "global",
      field: "maxConcurrent",
      before: e.config.global.maxConcurrent,
      after: mc,
      activeNow: cap.global.active,
      backlog: cap.global.backlog,
      overLimitBy: over,
      message:
        over > 0
          ? `Global 최대 동시 실행 ${e.config.global.maxConcurrent} → ${mc}: 현재 실행 ${cap.global.active}건이 ${over}건 초과합니다. 실행 중 작업은 유지되며 신규 Admission이 중단됩니다.`
          : `Global 최대 동시 실행 ${e.config.global.maxConcurrent} → ${mc}: 현재 실행 ${cap.global.active}건, 전체 대기열 ${cap.global.backlog}건.`,
    });
  }
  if (sp !== undefined && sp !== e.config.global.maxStartsPerMinute) {
    impact.push({
      language: "global",
      field: "maxStartsPerMinute",
      before: e.config.global.maxStartsPerMinute,
      after: sp,
      activeNow: cap.global.active,
      backlog: cap.global.backlog,
      overLimitBy: 0,
      message: `Global 분당 최대 시작 ${e.config.global.maxStartsPerMinute} → ${sp} (즉시 반영)`,
    });
  }
  const audit: AuditEntry[] = [];
  if (!dryRun) {
    if (mc !== undefined && mc !== e.config.global.maxConcurrent) {
      e.actions.setGlobalCapacity(mc, { operator: operatorId, reason });
      audit.push(e.audit[0]);
    }
    if (sp !== undefined && sp !== e.config.global.maxStartsPerMinute) {
      e.actions.setGlobalStartsPerMinute(sp, { operator: operatorId, reason });
      audit.push(e.audit[0]);
    }
  }
  return { dryRun, global: globalCapacity(), impact, audit };
}
