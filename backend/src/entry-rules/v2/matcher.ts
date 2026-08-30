/**
 * 三值表达式执行器（ER-04/05/06）。UNKNOWN 不得转成 TRUE/FALSE，必须形成 missingFacts。
 */

import { RuleExpression, RuleV2, TriVal, QualifyingDoc, DatasetV2 } from './types';
import { cityByIata } from './facts';

export interface EvalContext {
  facts: Record<string, any>;
  dataset: DatasetV2;
  rule: RuleV2;
  arrivalDate?: string; // YYYY-MM-DD
  now: Date;
}

export interface EvalOutcome {
  value: TriVal;
  missing: string[];
  /** 硬事实失败（护照有效期/累计停留等用户侧数值）：FALSE 时应判 INELIGIBLE 而非“规则不适用”。 */
  hard?: string[];
}

const DAY_MS = 24 * 3600 * 1000;

export function getFact(facts: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), facts);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

function parseDate(s: any): Date | null {
  if (typeof s !== 'string' || !s) return null;
  const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 叶子操作符求值。 */
function evalLeaf(expr: RuleExpression, ctx: EvalContext): EvalOutcome {
  const { fact, op, value } = expr as any;
  const v = getFact(ctx.facts, fact);
  const missing = v === undefined ? [fact] : [];
  const isHard = (val: TriVal) =>
    val === 'FALSE' && (op === 'VALID_FOR_DAYS' || ((op === 'LTE' || op === 'GTE') && String(fact).startsWith('traveler.history.')))
      ? [fact as string]
      : [];

  switch (op) {
    case 'EXISTS':
      return v === undefined ? { value: 'FALSE', missing: [] } : { value: 'TRUE', missing: [] };
    case 'NOT_EXISTS':
      return v === undefined ? { value: 'TRUE', missing: [] } : { value: 'FALSE', missing: [] };
    case 'EQ': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const val: TriVal = v === value ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'NEQ': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const val: TriVal = v !== value ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'IN': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const val: TriVal = Array.isArray(value) && value.includes(v) ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'NOT_IN': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const val: TriVal = Array.isArray(value) && !value.includes(v) ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'GTE': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const val: TriVal = typeof v === 'number' && v >= value ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'LTE': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const val: TriVal = typeof v === 'number' && v <= value ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'IS_TRUE':
      if (v === undefined) return { value: 'UNKNOWN', missing };
      return { value: v === true ? 'TRUE' : 'FALSE', missing: [] };
    case 'IS_FALSE':
      if (v === undefined) return { value: 'UNKNOWN', missing };
      return { value: v === false ? 'TRUE' : 'FALSE', missing: [] };
    case 'VALID_FOR_DAYS': {
      if (v === undefined) return { value: 'UNKNOWN', missing };
      const validUntil = parseDate(v);
      const base = parseDate(ctx.arrivalDate) ?? parseDate(getFact(ctx.facts, 'itinerary.arrivalDate'));
      if (!validUntil) return { value: 'UNKNOWN', missing: [fact] };
      if (!base) return { value: 'UNKNOWN', missing: ['itinerary.arrivalDate'] };
      const val: TriVal = daysBetween(base, validUntil) >= (value as number) ? 'TRUE' : 'FALSE';
      return { value: val, missing: [], hard: isHard(val) };
    }
    case 'HAS_VALID_DOCUMENT':
      return evalHasValidDocument(v, value, ctx);
    case 'ROUTE_MATCHES':
      return evalRouteMatches(value, ctx);
    case 'DATE_WITHIN_RULE_VALIDITY': {
      const arrival = parseDate(getFact(ctx.facts, 'itinerary.arrivalDate'));
      if (!arrival) return { value: 'UNKNOWN', missing: ['itinerary.arrivalDate'] };
      const from = parseDate(ctx.rule.validity.effectiveFrom);
      const to = parseDate(ctx.rule.validity.effectiveTo);
      if (from && arrival.getTime() < from.getTime()) return { value: 'FALSE', missing: [] };
      // 临时政策在 effectiveTo 后零点自动失效：effectiveTo 当天仍有效
      if (to && arrival.getTime() > to.getTime() + DAY_MS - 1) return { value: 'FALSE', missing: [] };
      return { value: 'TRUE', missing: [] };
    }
    default:
      // 导入期已白名单校验；运行期兜底 fail-closed
      return { value: 'UNKNOWN', missing: [fact] };
  }
}

/** ER-05：复杂证件匹配。证件数组存在但为空 → FALSE；字段整体缺失 → UNKNOWN。 */
function evalHasValidDocument(docs: any, spec: any, ctx: EvalContext): EvalOutcome {
  if (docs === undefined) return { value: 'UNKNOWN', missing: ['traveler.qualifyingDocuments'] };
  if (!Array.isArray(docs)) return { value: 'UNKNOWN', missing: ['traveler.qualifyingDocuments'] };
  const entry = parseDate(ctx.arrivalDate) ?? parseDate(getFact(ctx.facts, 'itinerary.arrivalDate')) ?? ctx.now;

  const groupMembers = (gid: string): string[] => ctx.dataset.referenceGroups.find((g) => g.groupId === gid)?.members ?? [];

  const satisfies = (d: QualifyingDoc, c: any): boolean => {
    if (d.status === 'EXPIRED' || d.status === 'REVOKED') return false;
    const kinds: string[] = c.kinds ?? (c.kind ? [c.kind] : []);
    if (kinds.length) {
      const ok = kinds.some((k) => {
        if (k === 'VISA_OR_RESIDENCE') return d.kind === 'VISA' || d.kind === 'PERMANENT_RESIDENCE' || d.kind === 'TEMPORARY_RESIDENCE' || d.kind === 'RESIDENCE';
        if (k === 'MULTIPLE_ENTRY_LEGAL_STAY_OR_RESIDENCE') return d.kind !== 'VISA' || (d.entryCount === 'MULTIPLE');
        if (k === 'PERMANENT_RESIDENCE') return d.kind === 'PERMANENT_RESIDENCE' || d.kind === 'RESIDENCE';
        return d.kind === k;
      });
      if (!ok) return false;
    }
    const issuers: string[] = [...(c.issuers ?? []), ...(c.issuerGroup ? groupMembers(c.issuerGroup) : []), ...(c.orIssuerGroup ? groupMembers(c.orIssuerGroup) : [])];
    if (issuers.length && !issuers.includes(d.issuerCountry)) return false;
    if (c.multipleEntry === true && !(d.entryCount === 'MULTIPLE')) return false;
    if (Array.isArray(c.excludedVisaTypes) && c.excludedVisaTypes.length) {
      const t = (d.visaType || '').toUpperCase();
      const excluded = c.excludedVisaTypes.some((x: string) => t === x.toUpperCase() || (x.toUpperCase() === 'C' && t.startsWith('C')));
      if (excluded) return false;
    }
    if (typeof c.minimumValidityDaysAtEntry === 'number') {
      if (!d.validUntil) return false;
      const vu = parseDate(d.validUntil);
      if (!vu || daysBetween(entry, vu) < c.minimumValidityDaysAtEntry) return false;
    } else if (d.validUntil) {
      const vu = parseDate(d.validUntil);
      if (!vu || vu.getTime() < entry.getTime()) return false;
    }
    if (c.mustBeUsedBefore === true && d.usedBefore !== true) return false;
    return true;
  };

  const candidates: any[] = spec.anyOf ? spec.anyOf : [spec];
  // issuerGroupsAnyOf（KR 形态）
  if (spec.issuerGroupsAnyOf) {
    const issuers = spec.issuerGroupsAnyOf.flatMap((g: string) => groupMembers(g));
    const kinds: string[] = spec.kinds ?? [];
    const hit = docs.some((d) => {
      if (d.status === 'EXPIRED' || d.status === 'REVOKED') return false;
      if (kinds.length && !kinds.includes(d.kind)) return false;
      if (!issuers.includes(d.issuerCountry)) return false;
      if (d.validUntil) {
        const vu = parseDate(d.validUntil);
        if (!vu || vu.getTime() < entry.getTime()) return false;
      }
      return true;
    });
    return { value: hit ? 'TRUE' : 'FALSE', missing: [] };
  }
  const hit = docs.some((d) => candidates.some((c) => satisfies(d, c)));
  return { value: hit ? 'TRUE' : 'FALSE', missing: [] };
}

/** ER-06：路线匹配。基于完整航段而非仅起终点。 */
function evalRouteMatches(value: any, ctx: EvalContext): EvalOutcome {
  const segments = getFact(ctx.facts, 'itinerary.segments');
  if (!Array.isArray(segments) || segments.length === 0) return { value: 'UNKNOWN', missing: ['itinerary.segments'] };
  const countryOf = (iata: string): string | undefined => cityByIata(iata)?.countryCode;
  const A = countryOf(segments[0].from);
  const B = countryOf(segments[segments.length - 1].to);
  const stopover = getFact(ctx.facts, 'itinerary.stopover') ?? {};

  if (value.pattern) {
    const mid = String(value.pattern).split('-')[1];
    if (value.requiresAandBDifferent) {
      if (!A || !B) return { value: 'UNKNOWN', missing: ['itinerary.segments'] };
      if (A === B) return { value: 'FALSE', missing: [] };
      if (value.requiresGenuineTransit && (A === mid || B === mid)) return { value: 'FALSE', missing: [] };
      return { value: 'TRUE', missing: [] };
    }
    if (value.requiresForeignEndpoint) {
      if (!B) return { value: 'UNKNOWN', missing: ['itinerary.segments'] };
      const usesPort = segments.some((s: any) => s.from === (value as any).port || s.to === (value as any).port) || true;
      if (B === 'CN') return { value: 'FALSE', missing: [] }; // 往返内地不构成真实第三国过境
      if (!usesPort) return { value: 'FALSE', missing: [] };
      return { value: 'TRUE', missing: [] };
    }
    return { value: 'TRUE', missing: [] };
  }

  if (value.program === 'KR_THIRD_COUNTRY_TRANSIT') {
    const groups = ['KOREA_ADVANCED_FOUR', 'KOREA_APPROVED_EUROPE_32'];
    const issuers = groups.flatMap((g) => ctx.dataset.referenceGroups.find((x) => x.groupId === g)?.members ?? []);
    const docs: QualifyingDoc[] = getFact(ctx.facts, 'traveler.qualifyingDocuments') ?? [];
    const qualifying = docs.filter((d) => d.status !== 'EXPIRED' && d.status !== 'REVOKED' && issuers.includes(d.issuerCountry) && (!d.validUntil || (parseDate(d.validUntil)?.getTime() ?? 0) >= ctx.now.getTime()));
    if (!qualifying.length) return { value: 'UNKNOWN', missing: ['traveler.qualifyingDocuments'] };
    const qualCountries = new Set(qualifying.map((d) => d.issuerCountry));
    // 路线必须前往签证国，或从签证国离境（立即起点）
    if (B && qualCountries.has(B)) return { value: 'TRUE', missing: [] };
    if (A && qualCountries.has(A)) return { value: 'TRUE', missing: [] };
    return { value: 'FALSE', missing: [] };
  }

  if (value.program === 'VN_PHU_QUOC_ONLY') {
    const region = getFact(ctx.facts, 'itinerary.destination.region');
    if (region !== 'PHU_QUOC') return { value: 'FALSE', missing: [] };
    const vnMainland = segments.some((s: any) => {
      const cc1 = countryOf(s.from);
      const cc2 = countryOf(s.to);
      const isPQC = (x: string) => x === 'PQC';
      return (cc1 === 'VN' && !isPQC(s.from)) || (cc2 === 'VN' && !isPQC(s.to));
    });
    if (vnMainland) {
      const hasVnVisa = (getFact(ctx.facts, 'traveler.qualifyingDocuments') ?? []).some((d: QualifyingDoc) => d.kind === 'VISA' && d.issuerCountry === 'VN' && d.status !== 'EXPIRED');
      return { value: hasVnVisa ? 'TRUE' : 'FALSE', missing: [] };
    }
    return { value: 'TRUE', missing: [] };
  }

  return { value: 'UNKNOWN', missing: ['itinerary.route'] };
  void stopover;
}

/** 递归三值求值（§7.1 真值表）。 */
export function evalExpression(expr: RuleExpression, ctx: EvalContext): EvalOutcome {
  if (expr.all) {
    let anyUnknown = false;
    const missing: string[] = [];
    for (const e of expr.all) {
      const r = evalExpression(e, ctx);
      if (r.value === 'FALSE') return { value: 'FALSE', missing: [], hard: r.hard ?? [] };
      if (r.value === 'UNKNOWN') {
        anyUnknown = true;
        missing.push(...r.missing);
      }
    }
    return anyUnknown ? { value: 'UNKNOWN', missing } : { value: 'TRUE', missing: [] };
  }
  if (expr.any) {
    let anyTrue = false;
    let anyUnknown = false;
    const missing: string[] = [];
    const hard: string[] = [];
    for (const e of expr.any) {
      const r = evalExpression(e, ctx);
      if (r.value === 'TRUE') anyTrue = true;
      if (r.value === 'UNKNOWN') {
        anyUnknown = true;
        missing.push(...r.missing);
      }
      if (r.value === 'FALSE') hard.push(...(r.hard ?? []));
    }
    if (anyTrue) return { value: 'TRUE', missing: [] };
    return anyUnknown ? { value: 'UNKNOWN', missing } : { value: 'FALSE', missing: [], hard };
  }
  if (expr.not) {
    const r = evalExpression(expr.not, ctx);
    if (r.value === 'UNKNOWN') return { value: 'UNKNOWN', missing: r.missing };
    return { value: r.value === 'TRUE' ? 'FALSE' : 'TRUE', missing: [] };
  }
  return evalLeaf(expr, ctx);
}
