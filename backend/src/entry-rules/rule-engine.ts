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
  /** 续程票是否已确认（第二段已 Verify） */
  onwardTicketConfirmed?: boolean;
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

  // 5. E_VISA_REQUIRED 且没有对应有效签证 -> NEEDS_INFO
  if (rule.entryMode === 'E_VISA_REQUIRED') {
    const visa = (input.visas || []).find(
      (v) => v.country === rule.transitCountry && (!v.validUntil || new Date(v.validUntil) >= travelDate),
    );
    if (!visa) {
      return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['E_VISA_REQUIRED'] };
    }
  }

  // 6. 需要续程票但第二段尚未 Verify -> NEEDS_INFO
  if (rule.requiredEvidence.includes('CONFIRMED_ONWARD_TICKET') && input.onwardTicketConfirmed === false) {
    return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['ONWARD_TICKET_UNCONFIRMED'] };
  }

  // 7. 所有条件满足 -> ELIGIBLE
  return {
    ...base,
    ...meta,
    status: 'ELIGIBLE',
    reasonCodes: [
      rule.entryMode === 'VISA_FREE' ? 'VISA_EXEMPT' : rule.entryMode === 'TRANSIT_PERMISSION' ? 'TRANSIT_PERMISSION' : 'E_VISA_HELD',
      'STAY_WITHIN_LIMIT',
    ],
  };
}
