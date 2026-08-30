/**
 * DecisionAggregator（ER-07）：收集所有匹配规则，负向优先、优先级、来源新鲜度与信息完整度合并。
 * 默认 NEEDS_REVIEW，不是 ELIGIBLE。
 */

import { DatasetV2, DecisionCode, RuleV2, TriVal } from './types';
import { EvalOutcome } from './matcher';
import { ruleSourcesStale, ruleValidForArrival, temporaryRecheckSatisfied } from './freshness';

export interface RuleEval {
  rule: RuleV2;
  outcome: EvalOutcome;
}

export interface AggregatedDecision {
  searchDecision: DecisionCode;
  bookingDecision: DecisionCode;
  matched: RuleV2[];
  missingFacts: string[];
  reasonCodes: string[];
}

const NEGATIVE_FIRST = (r: RuleV2) => (r.status === 'NEGATIVE' || r.decision.search === 'INELIGIBLE' ? 0 : 1);

export function aggregate(
  dataset: DatasetV2,
  evals: RuleEval[],
  opts: { mode: 'SEARCH' | 'BOOKING'; arrivalDate?: string; now: Date },
): AggregatedDecision {
  const missingAll: string[] = [];
  const considered = evals.filter((e) => {
    if (!ruleValidForArrival(e.rule, opts.arrivalDate, opts.now)) return false; // 临时政策到期自动失效
    return true;
  });

  // 1) 负向规则优先：任一 NEGATIVE 规则求值 TRUE → 直接 INELIGIBLE
  const negativeHit = considered
    .filter((e) => NEGATIVE_FIRST(e.rule) === 0 && e.outcome.value === 'TRUE')
    .sort((a, b) => b.rule.priority - a.rule.priority)[0];
  if (negativeHit) {
    return {
      searchDecision: 'INELIGIBLE',
      bookingDecision: 'INELIGIBLE',
      matched: [negativeHit.rule],
      missingFacts: [],
      reasonCodes: ['NEGATIVE_RULE_MATCHED', negativeHit.rule.ruleId],
    };
  }

  // 1.5) 硬事实失败（护照有效期/累计停留）→ INELIGIBLE，优先于正向规则
  const hardHit = considered
    .filter((e) => e.outcome.value === 'FALSE' && (e.outcome.hard?.length ?? 0) > 0)
    .sort((a, b) => b.rule.priority - a.rule.priority)[0];
  if (hardHit) {
    return {
      searchDecision: 'INELIGIBLE',
      bookingDecision: 'INELIGIBLE',
      matched: [hardHit.rule],
      missingFacts: [],
      reasonCodes: ['HARD_FACT_FAILED', hardHit.rule.ruleId, ...(hardHit.outcome.hard ?? [])],
    };
  }

  // 2) 正向/条件规则：TRUE 优先于 UNKNOWN；同值按 priority 降序
  const positives = considered
    .filter((e) => NEGATIVE_FIRST(e.rule) === 1 && (e.outcome.value === 'TRUE' || e.outcome.value === 'UNKNOWN'))
    .sort((a, b) => {
      const rank = (e: RuleEval) => (e.outcome.value === 'TRUE' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (b.rule.priority !== a.rule.priority) return b.rule.priority - a.rule.priority;
      return a.rule.ruleId.localeCompare(b.rule.ruleId);
    });

  const best = positives[0];
  if (!best) {
    // 无任何匹配：收集 UNKNOWN 的缺失事实；默认 NEEDS_REVIEW
    for (const e of considered) if (e.outcome.value === 'UNKNOWN') missingAll.push(...e.outcome.missing);
    return {
      searchDecision: dataset.policy.defaultSearchDecision,
      bookingDecision: dataset.policy.defaultBookingDecision,
      matched: [],
      missingFacts: [...new Set(missingAll)],
      reasonCodes: ['NO_MATCHING_RULE'],
    };
  }

  if (best.outcome.value === 'UNKNOWN') {
    // 缺失事实分类：
    // - documents.*：证件/材料（续程票、住宿证明等），预订期必须齐备，缺失仍 NEEDS_INFO；
    // - traveler.history.*：累计停留声明，产品不采集，属旅客自主申报义务（边境最终裁定），
    //   互免/免签等确定性规则不应因此阻断下单——否则“搜索期显示符合资格、下单却被拦”自相矛盾。
    const missing = best.outcome.missing;
    const notTourProgram = best.rule.category !== 'TRANSIT_TOUR_PROGRAM';
    const declarativeOnly =
      missing.length > 0 && missing.every((m) => m.startsWith('documents.') || m.startsWith('traveler.history.'));
    const historyOnly = missing.length > 0 && missing.every((m) => m.startsWith('traveler.history.'));
    // 搜索期材料宽容（T-08）：仅缺声明类事实时按规则搜索决策放行。
    const searchRelaxed = opts.mode === 'SEARCH' && notTourProgram && declarativeOnly;
    // 预订期：仅缺累计停留声明时按规则预订决策放行；缺证件材料仍 NEEDS_INFO（fail-closed）。
    const bookingRelaxed = notTourProgram && historyOnly;
    if (searchRelaxed || bookingRelaxed) {
      // 放宽时两个决策都取规则自身结论（T-08 契约：搜索期评估也如实给出规则的预订决策）。
      return {
        searchDecision: best.rule.decision.search,
        bookingDecision: best.rule.decision.booking,
        matched: [best.rule],
        missingFacts: [...new Set(missing)],
        reasonCodes: [best.rule.ruleId, 'DECLARATION_PENDING_VERIFY'],
      };
    }
    for (const e of positives) if (e.outcome.value === 'UNKNOWN') missingAll.push(...e.outcome.missing);
    return {
      searchDecision: 'NEEDS_INFO',
      bookingDecision: 'NEEDS_INFO',
      matched: [best.rule],
      missingFacts: [...new Set(missingAll)],
      reasonCodes: ['MISSING_FACTS', best.rule.ruleId],
    };
  }

  // 3) TRUE：按规则决策 + 新鲜度/复核降级
  let search: DecisionCode = best.rule.decision.search;
  let booking: DecisionCode = best.rule.decision.booking;
  const reasons: string[] = [best.rule.ruleId];

  if (best.rule.status === 'REVIEW_REQUIRED' || ruleSourcesStale(best.rule, dataset, opts.now)) {
    search = cap(search, 'NEEDS_REVIEW');
    booking = cap(booking, 'NEEDS_REVIEW');
    reasons.push('SOURCE_REVIEW_REQUIRED');
  }
  if (best.rule.decision.manualReviewRequired) {
    booking = cap(booking, 'NEEDS_REVIEW');
    reasons.push('MANUAL_REVIEW_REQUIRED');
  }
  if (opts.mode === 'BOOKING' && !temporaryRecheckSatisfied(best.rule, dataset, opts.now)) {
    booking = cap(booking, 'NEEDS_REVIEW');
    reasons.push('TEMPORARY_POLICY_RECHECK_REQUIRED');
  }

  return { searchDecision: search, bookingDecision: booking, matched: [best.rule], missingFacts: [], reasonCodes: reasons };
}

/** 只允许向更保守方向调整。 */
const ORDER: DecisionCode[] = ['ELIGIBLE', 'CONDITIONALLY_ELIGIBLE', 'NEEDS_INFO', 'NEEDS_REVIEW', 'INELIGIBLE'];
function cap(current: DecisionCode, floor: DecisionCode): DecisionCode {
  return ORDER.indexOf(current) <= ORDER.indexOf(floor) ? floor : current;
}
