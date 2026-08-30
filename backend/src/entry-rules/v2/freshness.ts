/**
 * RuleFreshnessService（ER-08）：按来源等级复核周期与临时政策窗口计算过期状态。
 * 临时规则在 effectiveTo 后零点自动失效，不允许缓存延长。
 */

import { DatasetV2, RuleV2, SourceDoc } from './types';

const DAY_MS = 24 * 3600 * 1000;

export function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 规则对给定抵达日期是否仍在有效期（effectiveTo 当天仍有效，次日零点失效）。 */
export function ruleValidForArrival(rule: RuleV2, arrivalDate: string | undefined, now: Date): boolean {
  const from = parseDay(rule.validity.effectiveFrom);
  const to = parseDay(rule.validity.effectiveTo);
  const arrival = (arrivalDate ? parseDay(arrivalDate) : now) ?? now;
  if (from && arrival.getTime() < from.getTime()) return false;
  if (to && arrival.getTime() > to.getTime() + DAY_MS - 1) return false;
  if (rule.status === 'EXPIRED' || rule.status === 'SUPERSEDED') return false;
  return true;
}

/** 来源是否陈旧：lastCheckedAt 超过该 tier 的复核天数。 */
export function sourceIsStale(source: SourceDoc, dataset: DatasetV2, now: Date): boolean {
  const days = dataset.policy.sourceTierReviewDays[source.tier] ?? 30;
  const checked = new Date(source.lastCheckedAt);
  return (now.getTime() - checked.getTime()) / DAY_MS > days;
}

/** 规则任一来源陈旧或状态 PARTIAL/STALE → 需要降级展示。 */
export function ruleSourcesStale(rule: RuleV2, dataset: DatasetV2, now: Date): boolean {
  return rule.sourceIds.some((id) => {
    const s = dataset.sourceDocuments.find((x) => x.sourceId === id);
    if (!s) return true;
    return sourceIsStale(s, dataset, now) || s.status === 'STALE' || s.status === 'PARTIAL';
  });
}

/** 临时规则在 BOOKING 阶段要求出票前 temporaryRuleSafetyHours 内重查。 */
export function temporaryRecheckSatisfied(rule: RuleV2, dataset: DatasetV2, now: Date): boolean {
  if (rule.status !== 'TEMPORARY_ACTIVE') return true;
  const hours = dataset.policy.temporaryRuleSafetyHours;
  const newest = rule.sourceIds
    .map((id) => dataset.sourceDocuments.find((x) => x.sourceId === id))
    .filter(Boolean)
    .map((s) => new Date(s!.lastCheckedAt).getTime())
    .sort((a, b) => b - a)[0];
  if (!newest) return false;
  return now.getTime() - newest <= hours * 3600 * 1000;
}
