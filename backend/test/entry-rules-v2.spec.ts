/**
 * v2 入境规则引擎测试（13 号方案 T-01~T-24 子集）。
 * 纯引擎级：不访问数据库与真实支付；Nosana 不参与（T-24）。
 */
import { describe, expect, it } from 'vitest';
import bundled from '../src/entry-rules/data/cn-ordinary-passport-entry-rules.v2.json';
import { validateDataset, validateExpression } from '../src/entry-rules/v2/schema-validator';
import { evalExpression } from '../src/entry-rules/v2/matcher';
import { aggregate } from '../src/entry-rules/v2/aggregator';
import { ruleValidForArrival } from '../src/entry-rules/v2/freshness';
import { buildFacts } from '../src/entry-rules/v2/facts';
import { DatasetV2, AssessInput, RuleV2 } from '../src/entry-rules/v2/types';

const ds = bundled as unknown as DatasetV2;
const NOW = new Date('2026-08-30T12:00:00Z');

const passport = (validUntil: string) => ({ issuingCountry: 'CN', type: 'ORDINARY', validUntil });
const usVisa = (over: Record<string, any> = {}) => ({
  kind: 'VISA', issuerCountry: 'US', visaType: 'B1_B2', entryCount: 'MULTIPLE',
  validFrom: '2025-01-01', validUntil: '2035-01-01', status: 'ACTIVE', ...over,
});

function baseInput(over: Partial<AssessInput> & { itinerary: AssessInput['itinerary'] }): AssessInput {
  return { userId: 'u_test', mode: 'SEARCH', now: NOW.toISOString(), traveler: { passport: passport('2034-01-01'), documents: [], history: {} }, documents: {}, ...over };
}

function runAgg(input: AssessInput) {
  const facts = buildFacts(input);
  const dest = input.itinerary.stopover?.country ?? input.itinerary.destination?.country;
  const jurisdiction = input.itinerary.stopover?.jurisdiction ?? null;
  const candidates = ds.verifiedRules.filter((r) => {
    if (jurisdiction && r.destination.jurisdictionCode) return r.destination.jurisdictionCode === jurisdiction;
    if (jurisdiction) return r.destination.countryCode === jurisdiction || r.destination.countryCode === dest;
    if (r.destination.jurisdictionCode) return false;
    return r.destination.countryCode === dest;
  });
  const arrivalDate = (facts as any).itinerary?.arrivalDate;
  const evals = candidates.map((rule) => ({ rule, outcome: evalExpression(rule.match, { facts, dataset: ds, rule, arrivalDate, now: NOW }) }));
  return aggregate(ds, evals, { mode: input.mode, arrivalDate, now: NOW });
}

const seg = (from: string, to: string, dep: string, arr: string) => ({ from, to, departureAt: dep, arrivalAt: arr });

describe('ER-01 Schema 校验', () => {
  it('内置数据集通过校验', () => {
    expect(validateDataset(ds)).toEqual([]);
  });
  it('T-23 未知操作符导入失败', () => {
    const bad = JSON.parse(JSON.stringify(ds));
    bad.verifiedRules[0].match.all.push({ fact: 'x', op: 'LIKE', value: 'y' });
    const errors = validateDataset(bad);
    expect(errors.some((e) => e.includes("unknown operator 'LIKE'"))).toBe(true);
  });
  it('表达式递归校验拒绝畸形节点', () => {
    const errors: string[] = [];
    validateExpression({ foo: 1 } as any, 'p', errors);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('ER-04 三值逻辑', () => {
  const ctx = (facts: any) => ({ facts, dataset: ds, rule: ds.verifiedRules[0], now: NOW });
  it('all: 任一 FALSE → FALSE', () => {
    const r = evalExpression({ all: [{ fact: 'a', op: 'EQ', value: 1 }, { fact: 'a', op: 'EQ', value: 2 }] }, ctx({ a: 1 }));
    expect(r.value).toBe('FALSE');
  });
  it('all: 无 FALSE 有 UNKNOWN → UNKNOWN 且收集 missing', () => {
    const r = evalExpression({ all: [{ fact: 'a', op: 'EQ', value: 1 }, { fact: 'missing', op: 'EQ', value: 1 }] }, ctx({ a: 1 }));
    expect(r.value).toBe('UNKNOWN');
    expect(r.missing).toContain('missing');
  });
  it('any: 无 TRUE 有 UNKNOWN → UNKNOWN', () => {
    const r = evalExpression({ any: [{ fact: 'missing', op: 'EQ', value: 1 }] }, ctx({}));
    expect(r.value).toBe('UNKNOWN');
  });
  it('not: 反转 UNKNOWN 仍 UNKNOWN', () => {
    const r = evalExpression({ not: { fact: 'missing', op: 'EQ', value: 1 } }, ctx({}));
    expect(r.value).toBe('UNKNOWN');
  });
});

describe('ER-05 HAS_VALID_DOCUMENT', () => {
  const spec = { anyOf: [{ kind: 'VISA', issuers: ['US'], multipleEntry: true }] };
  const leaf = (docs: any) => ({ fact: 'traveler.qualifyingDocuments', op: 'HAS_VALID_DOCUMENT', value: spec } as any);
  it('T-20 多次 B1/B2 匹配', () => {
    const r = evalExpression(leaf(null), { facts: { traveler: { qualifyingDocuments: [usVisa()] } } as any, dataset: ds, rule: ds.verifiedRules[0], now: NOW });
    expect(r.value).toBe('TRUE');
  });
  it('T-21 单次且已使用不匹配', () => {
    const r = evalExpression(leaf(null), { facts: { traveler: { qualifyingDocuments: [usVisa({ entryCount: 'SINGLE', usedBefore: true })] } } as any, dataset: ds, rule: ds.verifiedRules[0], now: NOW });
    expect(r.value).toBe('FALSE');
  });
  it('T-22 C1 过境签被排除', () => {
    const r = evalExpression({ fact: 'traveler.qualifyingDocuments', op: 'HAS_VALID_DOCUMENT', value: { anyOf: [{ kind: 'VISA', issuers: ['US'], excludedVisaTypes: ['C', 'C1', 'C2', 'C3'] }] } } as any, { facts: { traveler: { qualifyingDocuments: [usVisa({ visaType: 'C1' })] } } as any, dataset: ds, rule: ds.verifiedRules[0], now: NOW });
    expect(r.value).toBe('FALSE');
  });
  it('过期签证不匹配', () => {
    const r = evalExpression(leaf(null), { facts: { traveler: { qualifyingDocuments: [usVisa({ validUntil: '2025-06-01' })] } } as any, dataset: ds, rule: ds.verifiedRules[0], now: NOW });
    expect(r.value).toBe('FALSE');
  });
  it('证件数组缺失 → UNKNOWN', () => {
    const r = evalExpression(leaf(null), { facts: { traveler: {} } as any, dataset: ds, rule: ds.verifiedRules[0], now: NOW });
    expect(r.value).toBe('UNKNOWN');
  });
});

describe('ER-06 ROUTE_MATCHES', () => {
  const rule = ds.verifiedRules.find((r) => r.ruleId === 'CN_HK_GENUINE_THIRD_COUNTRY_TRANSIT')!;
  const evalRoute = (segments: any[], value: any) =>
    evalExpression({ fact: 'itinerary.route', op: 'ROUTE_MATCHES', value } as any, {
      facts: buildFacts(baseInput({ itinerary: { purpose: 'TOURISM', segments, stopover: { country: 'HK', jurisdiction: 'HK', airport: 'HKG' } } })),
      dataset: ds, rule, now: NOW,
    });
  it('T-05 PVG→HKG→SIN 真实第三国', () => {
    const r = evalRoute([seg('PVG', 'HKG', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z'), seg('HKG', 'SIN', '2026-09-24T06:00:00Z', '2026-09-24T10:00:00Z')], { pattern: 'A-HK-B', requiresAandBDifferent: true, requiresGenuineTransit: true });
    expect(r.value).toBe('TRUE');
  });
  it('T-06 PVG→HKG→PVG 不构成过境', () => {
    const r = evalRoute([seg('PVG', 'HKG', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z'), seg('HKG', 'PVG', '2026-09-24T06:00:00Z', '2026-09-24T10:00:00Z')], { pattern: 'A-HK-B', requiresAandBDifferent: true, requiresGenuineTransit: true });
    expect(r.value).toBe('FALSE');
  });
  it('T-09 韩国签证国方向：ICN→PVG 不匹配', () => {
    const kr = ds.verifiedRules.find((r) => r.ruleId === 'CN_KR_THIRD_COUNTRY_TRANSIT')!;
    const facts = buildFacts(baseInput({
      itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'ICN', '2026-09-20T02:00:00Z', '2026-09-20T10:00:00Z'), seg('ICN', 'PVG', '2026-09-23T06:00:00Z', '2026-09-23T09:00:00Z')], stopover: { country: 'KR', airport: 'ICN' } },
      traveler: { passport: passport('2034-01-01'), documents: [usVisa()], history: {} },
    }));
    const expr = (kr.match.all ?? []).find((e: any) => e.op === 'ROUTE_MATCHES')!;
    const r = evalExpression(expr, { facts, dataset: ds, rule: kr, now: NOW });
    expect(r.value).toBe('FALSE');
  });
  it('T-15/T-16 富国岛区域：PQC 可行；续程 SGN 无 eVisa 阻断', () => {
    const vn = ds.verifiedRules.find((r) => r.ruleId === 'CN_VN_PHU_QUOC_REGIONAL_VISA_FREE')!;
    const expr = (vn.match.all ?? []).find((e: any) => e.op === 'ROUTE_MATCHES')!;
    const ok = evalExpression(expr, { facts: buildFacts(baseInput({ itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'PQC', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z')], stopover: { country: 'VN', airport: 'PQC' }, destination: { country: 'VN', region: 'PHU_QUOC' } } })), dataset: ds, rule: vn, now: NOW });
    expect(ok.value).toBe('TRUE');
    const blocked = evalExpression(expr, { facts: buildFacts(baseInput({ itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'PQC', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z'), seg('PQC', 'SGN', '2026-09-23T06:00:00Z', '2026-09-23T07:00:00Z')], stopover: { country: 'VN', airport: 'PQC' }, destination: { country: 'VN', region: 'PHU_QUOC' } } })), dataset: ds, rule: vn, now: NOW });
    expect(blocked.value).toBe('FALSE');
  });
});

describe('ER-07 负向优先与聚合', () => {
  it('T-11 菲律宾第三国过境 INELIGIBLE 覆盖 14 天便利', () => {
    const r = runAgg(baseInput({
      itinerary: { purpose: 'TRANSIT', segments: [seg('SIN', 'MNL', '2026-09-20T02:00:00Z', '2026-09-20T06:00:00Z'), seg('MNL', 'PVG', '2026-09-22T06:00:00Z', '2026-09-22T11:00:00Z')], stopover: { country: 'PH', airport: 'MNL' }, stayDays: 2 },
    }));
    expect(r.searchDecision).toBe('INELIGIBLE');
    expect(r.matched[0]?.ruleId).toBe('CN_PH_TRANSIT_VISA_REQUIRED');
  });
  it('T-12 菲律宾旅游 CONDITIONAL 且非过境规则', () => {
    const r = runAgg(baseInput({
      itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'MNL', '2026-09-20T02:00:00Z', '2026-09-20T06:00:00Z')], stopover: { country: 'PH', airport: 'MNL' }, stayDays: 7 },
    }));
    expect(r.searchDecision).toBe('CONDITIONALLY_ELIGIBLE');
    expect(r.matched[0]?.ruleId).toBe('CN_PH_TEMP_14_DAY_VISITOR');
  });
  it('T-03 泰国 180 天累计超限 INELIGIBLE', () => {
    const r = runAgg(baseInput({
      itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'BKK', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z')], stopover: { country: 'TH', airport: 'BKK' }, stayDays: 5 },
      traveler: { passport: passport('2034-01-01'), documents: [], history: { TH: { daysInRollingWindowIncludingTrip: 91 } } },
    }));
    expect(r.searchDecision).toBe('INELIGIBLE');
  });
  it('T-04 新加坡匹配互免而非 VFTF', () => {
    const r = runAgg(baseInput({ itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'SIN', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z')], stopover: { country: 'SG' }, stayDays: 4 } }));
    expect(r.searchDecision).toBe('ELIGIBLE');
    expect(r.matched[0]?.ruleId).toBe('CN_SG_MUTUAL_VISA_FREE');
  });
});

describe('ER-08 时效与到期', () => {
  const kh = ds.verifiedRules.find((r) => r.ruleId === 'CN_KH_TEMP_14_DAY_VISA_FREE')!;
  const br = ds.verifiedRules.find((r) => r.ruleId === 'CN_BR_TEMP_30_DAY_VISA_FREE')!;
  it('T-17 10-10 抵达匹配临时规则', () => {
    expect(ruleValidForArrival(kh, '2026-10-10', NOW)).toBe(true);
  });
  it('T-18 10-16 抵达自动失效', () => {
    expect(ruleValidForArrival(kh, '2026-10-16', NOW)).toBe(false);
    const r = runAgg(baseInput({ itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'KUL', '2026-10-16T02:00:00Z', '2026-10-16T05:00:00Z')], stopover: { country: 'KH' }, stayDays: 4, arrivalDate: '2026-10-16' } }));
    expect(r.searchDecision).toBe('NEEDS_REVIEW');
  });
  it('T-19 2027 巴西临时规则过期', () => {
    expect(ruleValidForArrival(br, '2027-01-01', NOW)).toBe(false);
  });
  it('T-02 护照 5 个月到期不显示免签就绪', () => {
    const r = runAgg(baseInput({
      itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'KUL', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z')], stopover: { country: 'MY' }, stayDays: 4 },
      traveler: { passport: passport('2027-01-30'), documents: [], history: {} },
    }));
    expect(['NEEDS_INFO', 'INELIGIBLE', 'NEEDS_REVIEW']).toContain(r.searchDecision);
    expect(r.searchDecision).not.toBe('ELIGIBLE');
  });
  it('T-01 马来西亚互免：搜索 ELIGIBLE，预订 CONDITIONAL', () => {
    const r = runAgg(baseInput({ itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'KUL', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z')], stopover: { country: 'MY' }, stayDays: 4 } }));
    expect(r.searchDecision).toBe('ELIGIBLE');
    expect(r.bookingDecision).toBe('CONDITIONALLY_ELIGIBLE');
  });
  it('T-08 韩国+美签：搜索 CONDITIONAL，预订 NEEDS_REVIEW', () => {
    const r = runAgg(baseInput({
      itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'ICN', '2026-09-20T02:00:00Z', '2026-09-20T10:00:00Z'), seg('ICN', 'LAX', '2026-09-23T06:00:00Z', '2026-09-23T17:00:00Z')], stopover: { country: 'KR', airport: 'ICN' }, stayDays: 3 },
      traveler: { passport: passport('2034-01-01'), documents: [usVisa()], history: {} },
    }));
    expect(r.searchDecision).toBe('CONDITIONALLY_ELIGIBLE');
    expect(r.bookingDecision).toBe('NEEDS_REVIEW');
    expect(r.matched[0]?.ruleId).toBe('CN_KR_THIRD_COUNTRY_TRANSIT');
  });
});

describe('T-24 Nosana 不可用降级', () => {
  it('解释为本地模板且不依赖 LLM', async () => {
    const { EligibilityAssessService } = await import('../src/entry-rules/v2/assess.service');
    const fakePrisma: any = { eligibilityAssessment: { create: async () => { throw new Error('no db'); } } };
    const fakeLoader: any = { getActive: () => ({ dataset: ds, checksum: 'test', ruleSetId: 'rs_test' }) };
    const svc = new EligibilityAssessService(fakePrisma, fakeLoader);
    const r = svc.assess(baseInput({ itinerary: { purpose: 'TOURISM', segments: [seg('SIN', 'KUL', '2026-09-20T02:00:00Z', '2026-09-20T05:00:00Z')], stopover: { country: 'MY' }, stayDays: 4 } }), { persist: false });
    expect(r.searchDecision).toBe('ELIGIBLE');
    expect(r.explanationZh.length).toBeGreaterThan(0);
    expect(r.disclaimerZh).toContain('不构成');
  });
});

describe('问题 8 回归：预订期资格复核不得因累计停留声明缺失而阻断免签下单', () => {
  const toKul = (mode: 'SEARCH' | 'BOOKING', over: Partial<AssessInput> = {}) =>
    runAgg(baseInput({
      mode,
      itinerary: {
        purpose: 'TOURISM',
        segments: [seg('SIN', 'KUL', '2026-09-20T02:00:00Z', '2026-09-20T03:00:00Z'), seg('KUL', 'PVG', '2026-09-24T06:00:00Z', '2026-09-24T12:00:00Z')],
        stopover: { country: 'MY', airport: 'KUL', stayHours: 96 },
        stayDays: 4,
        arrivalDate: '2026-09-20',
      },
      documents: { onwardTicket: { status: 'CONFIRMED' } },
      ...over,
    }));

  it('护照有效且免签：仅缺累计停留声明时预订期按规则放行（搜索/预订结论一致）', () => {
    const r = toKul('BOOKING');
    expect(r.matched[0]?.ruleId).toBe('CN_MY_MUTUAL_VISA_FREE');
    expect(r.bookingDecision).toBe('CONDITIONALLY_ELIGIBLE');
    expect(r.missingFacts).toContain('traveler.history.MY.daysInRollingWindowIncludingTrip');
  });

  it('搜索期同样不因累计停留声明缺失而降级', () => {
    const r = toKul('SEARCH');
    expect(r.searchDecision).toBe('ELIGIBLE');
    expect(r.bookingDecision).toBe('CONDITIONALLY_ELIGIBLE');
  });

  it('fail-closed 保留：护照有效期事实缺失时预订期仍拦（不属声明类宽容）', () => {
    const r = toKul('BOOKING', {
      traveler: { passport: { issuingCountry: 'CN', type: 'ORDINARY', validUntil: undefined } as any, documents: [], history: {} },
    });
    expect(r.bookingDecision).toBe('NEEDS_INFO');
  });
});
