/**
 * 确定性入境资格规则引擎（纯函数）。
 * 契约来源：06-签证规则种子数据.md 判定算法。
 * 原则：默认 fail-closed；LLM 不参与结论；每个结果绑定规则来源。
 */

export interface RuleSeed {
  id: string;
  version: string;
  passportCountry: string;
  passportType: string;
  transitCountry: string;
  candidateCities: string[];
  entryMode: 'VISA_FREE' | 'TRANSIT_PERMISSION' | 'E_VISA_REQUIRED';
  maxStayDays: number;
  maxCumulativeStayDays?: number;
  cumulativeWindowDays?: number;
  minPassportValidityMonths?: number;
  requiredEvidence: string[];
  hardConditions: string[];
  sourceUrl: string;
  sourceVersion: string;
  verifiedAt: string; // ISO date
}

export interface EligibilityInput {
  travelDate: string; // YYYY-MM-DD
  purpose: string; // TOURISM
  stayDays: number;
  passport?: {
    issuingCountry?: string;
    type?: string;
    validUntil?: string; // YYYY-MM-DD
  };
  visas?: Array<{
    country: string;
    type?: string;
    validUntil?: string;
    entryType?: string;
  }>;
  destinationCountry: string;
  /** 近窗口内累计停留天数；MVP 默认 0 且视为已知 */
  cumulativeStayDaysInWindow?: number;
  cumulativeKnown?: boolean;
  /** 续程票是否已确认（第二段已 Verify）；缺失/未确认按未确认处理，绝不默认放行 */
  onwardTicketConfirmed?: boolean;
  /**
   * 判定阶段：SEARCH_SCREEN 为搜索期初筛（续程票尚未 Verify，不作为阻断项，
   * 但结果标记 provisional 并附 ONWARD_TICKET_PENDING_VERIFY）；
   * BOOKING（默认）为预订期硬判定，缺确认即 NEEDS_INFO，fail-closed。
   */
  mode?: 'SEARCH_SCREEN' | 'BOOKING';
  /** 判定时刻，默认 now */
  now?: string;
}

export interface EligibilityResult {
  status: 'ELIGIBLE' | 'NEEDS_INFO' | 'INELIGIBLE';
  ruleId?: string;
  ruleVersion?: string;
  reasonCodes: string[];
  requiredDocuments: string[];
  sourceUrl?: string;
  verifiedAt?: string;
  disclaimerRequired: boolean;
  /** 搜索期初筛结果：续程票尚未 Verify，不得展示为 booking-ready */
  provisional?: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

export function evaluateEligibility(
  rule: RuleSeed | null,
  input: EligibilityInput,
): EligibilityResult {
  const now = input.now ? new Date(input.now) : new Date();
  const base = { disclaimerRequired: true } as EligibilityResult;

  // 1. 缺少护照关键信息 -> NEEDS_INFO
  if (!input.passport?.issuingCountry || !input.passport?.type || !input.passport?.validUntil) {
    return { ...base, status: 'NEEDS_INFO', reasonCodes: ['PASSPORT_INFO_MISSING'], requiredDocuments: [] };
  }

  // 无匹配规则 -> fail-closed
  if (!rule) {
    return { ...base, status: 'INELIGIBLE', reasonCodes: ['NO_RULE_FOUND'], requiredDocuments: [] };
  }

  const meta = {
    ruleId: rule.id,
    ruleVersion: rule.version,
    sourceUrl: rule.sourceUrl,
    verifiedAt: rule.verifiedAt,
    requiredDocuments: [...rule.requiredEvidence],
  };

  // 8. 来源核验超过 30 天 -> 降级为 NEEDS_INFO
  const verifiedAt = new Date(rule.verifiedAt);
  if (daysBetween(verifiedAt, now) > 30) {
    return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['RULE_NEEDS_REVERIFY'] };
  }

  const travelDate = new Date(input.travelDate);

  // 2. 护照有效期不足 -> INELIGIBLE
  if (rule.minPassportValidityMonths) {
    const passportValidUntil = new Date(input.passport.validUntil);
    const requiredDays = rule.minPassportValidityMonths * 30;
    if (daysBetween(travelDate, passportValidUntil) < requiredDays) {
      return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['PASSPORT_VALIDITY_INSUFFICIENT'] };
    }
  }

  // 3. 停留天数超限 -> INELIGIBLE
  if (input.stayDays > rule.maxStayDays) {
    return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['STAY_EXCEEDS_LIMIT'] };
  }
  if (input.stayDays <= 0) {
    return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['STAY_DAYS_MISSING'] };
  }

  // 4. 累计停留数据未知且规则有限制 -> NEEDS_INFO
  if (rule.maxCumulativeStayDays && input.cumulativeKnown === false) {
    return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['CUMULATIVE_STAY_UNKNOWN'] };
  }
  if (rule.maxCumulativeStayDays) {
    const used = input.cumulativeStayDaysInWindow ?? 0;
    if (used + input.stayDays > rule.maxCumulativeStayDays) {
      return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['CUMULATIVE_STAY_EXCEEDS_LIMIT'] };
    }
  }

  // 5. E_VISA_REQUIRED 的签证核验：缺有效期→NEEDS_INFO；已过期→INELIGIBLE；均不得默认放行。
  if (rule.entryMode === 'E_VISA_REQUIRED') {
    const visasForCountry = (input.visas || []).filter((v) => v.country === rule.transitCountry);
    if (!visasForCountry.length) {
      return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['E_VISA_REQUIRED'] };
    }
    const validVisa = visasForCountry.find((v) => v.validUntil && new Date(v.validUntil) >= travelDate);
    if (!validVisa) {
      const allExpired = visasForCountry.every((v) => v.validUntil && new Date(v.validUntil) < travelDate);
      const anyMissingExpiry = visasForCountry.some((v) => !v.validUntil);
      if (anyMissingExpiry && !allExpired) {
        return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['VISA_EXPIRY_MISSING'] };
      }
      return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['VISA_EXPIRED'] };
    }
  }

  // 6. 需要续程票：只有第二段真正 Verify 过（=== true）才算确认；undefined/false 一律不放行。
  if (rule.requiredEvidence.includes('CONFIRMED_ONWARD_TICKET') && input.onwardTicketConfirmed !== true) {
    if (input.mode !== 'SEARCH_SCREEN') {
      return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['ONWARD_TICKET_UNCONFIRMED'] };
    }
    // 搜索期：不阻断候选，但标记为初筛，禁止展示为可预订。
  }

  // 7. 所有条件满足 -> ELIGIBLE（搜索期标记 provisional）
  const searchScreen = input.mode === 'SEARCH_SCREEN';
  return {
    ...base,
    ...meta,
    status: 'ELIGIBLE',
    provisional: searchScreen && input.onwardTicketConfirmed !== true ? true : undefined,
    reasonCodes: [
      rule.entryMode === 'VISA_FREE' ? 'VISA_EXEMPT' : rule.entryMode === 'TRANSIT_PERMISSION' ? 'TRANSIT_PERMISSION' : 'E_VISA_HELD',
      'STAY_WITHIN_LIMIT',
      ...(searchScreen && input.onwardTicketConfirmed !== true ? ['ONWARD_TICKET_PENDING_VERIFY'] : []),
    ],
  };
}
