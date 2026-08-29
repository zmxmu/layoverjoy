import { describe, expect, it } from 'vitest';
import { evaluateEligibility, EligibilityInput, RuleSeed } from '../src/entry-rules/rule-engine';

/**
 * 规则引擎验收用例（审查报告 P0-05/P1-08）：
 * fail-closed 原则——任何缺失信息都不得默认放行。
 */

const baseRule: RuleSeed = {
  id: 'RULE_MY_001',
  version: '2026-08',
  passportCountry: 'CN',
  passportType: 'ORDINARY',
  transitCountry: 'MY',
  candidateCities: ['KUL'],
  entryMode: 'VISA_FREE',
  maxStayDays: 30,
  requiredEvidence: ['CONFIRMED_ONWARD_TICKET'],
  hardConditions: [],
  sourceUrl: 'https://example.gov.my',
  sourceVersion: '2026-08',
  verifiedAt: new Date().toISOString().slice(0, 10),
};

const eVisaRule: RuleSeed = { ...baseRule, id: 'RULE_VN_001', transitCountry: 'VN', entryMode: 'E_VISA_REQUIRED' };

const baseInput: EligibilityInput = {
  travelDate: '2026-09-15',
  purpose: 'TOURISM',
  stayDays: 2,
  passport: { issuingCountry: 'CN', type: 'ORDINARY', validUntil: '2030-01-01' },
  destinationCountry: 'MY',
  onwardTicketConfirmed: true,
  now: '2026-08-29',
};

describe('evaluateEligibility fail-closed', () => {
  it('缺护照有效期 -> NEEDS_INFO，不得放行', () => {
    const r = evaluateEligibility(baseRule, { ...baseInput, passport: { issuingCountry: 'CN', type: 'ORDINARY' } });
    expect(r.status).toBe('NEEDS_INFO');
    expect(r.reasonCodes).toContain('PASSPORT_INFO_MISSING');
  });

  it('无匹配规则 -> INELIGIBLE', () => {
    const r = evaluateEligibility(null, baseInput);
    expect(r.status).toBe('INELIGIBLE');
    expect(r.reasonCodes).toContain('NO_RULE_FOUND');
  });

  it('续程票未确认（undefined）+ BOOKING 模式 -> NEEDS_INFO，绝不默认放行', () => {
    const r = evaluateEligibility(baseRule, { ...baseInput, onwardTicketConfirmed: undefined });
    expect(r.status).toBe('NEEDS_INFO');
    expect(r.reasonCodes).toContain('ONWARD_TICKET_UNCONFIRMED');
  });

  it('续程票未确认 + SEARCH_SCREEN 模式 -> ELIGIBLE 但标记 provisional', () => {
    const r = evaluateEligibility(baseRule, { ...baseInput, onwardTicketConfirmed: undefined, mode: 'SEARCH_SCREEN' });
    expect(r.status).toBe('ELIGIBLE');
    expect(r.provisional).toBe(true);
    expect(r.reasonCodes).toContain('ONWARD_TICKET_PENDING_VERIFY');
  });

  it('两段均 Verify 后（=== true）-> ELIGIBLE 且非 provisional', () => {
    const r = evaluateEligibility(baseRule, baseInput);
    expect(r.status).toBe('ELIGIBLE');
    expect(r.provisional).toBeFalsy();
  });

  it('停留超限 -> INELIGIBLE', () => {
    const r = evaluateEligibility(baseRule, { ...baseInput, stayDays: 31 });
    expect(r.status).toBe('INELIGIBLE');
    expect(r.reasonCodes).toContain('STAY_EXCEEDS_LIMIT');
  });
});

describe('evaluateEligibility E_VISA 核验', () => {
  const input = { ...baseInput, destinationCountry: 'VN' };

  it('持有有效电子签 -> ELIGIBLE', () => {
    const r = evaluateEligibility(eVisaRule, { ...input, visas: [{ country: 'VN', validUntil: '2026-12-31' }] });
    expect(r.status).toBe('ELIGIBLE');
  });

  it('签证无有效期 -> NEEDS_INFO，不得视为有效', () => {
    const r = evaluateEligibility(eVisaRule, { ...input, visas: [{ country: 'VN' }] });
    expect(r.status).toBe('NEEDS_INFO');
    expect(r.reasonCodes).toContain('VISA_EXPIRY_MISSING');
  });

  it('签证已过期 -> INELIGIBLE', () => {
    const r = evaluateEligibility(eVisaRule, { ...input, visas: [{ country: 'VN', validUntil: '2025-01-01' }] });
    expect(r.status).toBe('INELIGIBLE');
    expect(r.reasonCodes).toContain('VISA_EXPIRED');
  });

  it('完全没有签证 -> NEEDS_INFO', () => {
    const r = evaluateEligibility(eVisaRule, input);
    expect(r.status).toBe('NEEDS_INFO');
    expect(r.reasonCodes).toContain('E_VISA_REQUIRED');
  });
});
