/**
 * StopoverEaseScore 确定性测试（14 号方案 §7 / A-03）。
 */
import { describe, expect, it } from 'vitest';
import { computeStopoverEase } from '../src/explanations/stopover-ease-score';

const base = {
  sameAirport: true,
  crossAirport: false,
  hasStructuredRail: true,
  airportToCoreMinutes: 34,
  arrivalLocalHour: 9,
  departureLocalHour: 18,
  usableExperienceMinutes: 32 * 60,
  separateTickets: false,
  recheckBaggage: false,
  redEyeLegs: 0,
  eligibilityNeedsReview: false,
};

describe('StopoverEaseScore', () => {
  it('同一输入结果稳定（确定性）', () => {
    const a = computeStopoverEase(base);
    const b = computeStopoverEase(base);
    expect(a).toEqual(b);
  });
  it('顺畅基准：同机场+轨道+白天到达', () => {
    const r = computeStopoverEase(base);
    // 50 +12 +10 +10 +6 +6 +8 = 102 → clamp 100? 50+12=62,+10=72,+10=82,+6=88,+6=94,+8=102→100 EASY
    expect(r.score).toBe(100);
    expect(r.level).toBe('EASY');
    expect(r.positiveReasonCodes).toContain('SAME_AIRPORT');
  });
  it('A-03 跨机场明显下降并解释代价', () => {
    const r = computeStopoverEase({ ...base, sameAirport: false, crossAirport: true });
    const good = computeStopoverEase(base);
    expect(r.score).toBeLessThan(good.score - 20);
    expect(r.cautionReasonCodes).toContain('CROSS_AIRPORT_TRANSFER');
  });
  it('A-04 独立机票+重新托运同时体现', () => {
    const r = computeStopoverEase({ ...base, separateTickets: true, recheckBaggage: true });
    expect(r.cautionReasonCodes).toContain('SEPARATE_TICKETS');
    expect(r.cautionReasonCodes).toContain('BAGGAGE_RECHECK');
  });
  it('A-05 凌晨到达+清晨离境扣分', () => {
    const good = computeStopoverEase(base);
    const r = computeStopoverEase({ ...base, arrivalLocalHour: 1, departureLocalHour: 5, usableExperienceMinutes: 6 * 60 });
    expect(r.cautionReasonCodes).toContain('RED_EYE_ARRIVAL');
    expect(r.cautionReasonCodes).toContain('EARLY_DEPARTURE');
    expect(r.score).toBeLessThan(good.score);
    expect(r.level).not.toBe('EASY');
  });
  it('分数限制 0-100', () => {
    const worst = computeStopoverEase({
      sameAirport: false, crossAirport: true, hasStructuredRail: false, airportToCoreMinutes: 90,
      arrivalLocalHour: 2, departureLocalHour: 3, usableExperienceMinutes: 30, separateTickets: true,
      recheckBaggage: true, redEyeLegs: 2, eligibilityNeedsReview: true,
    });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.level).toBe('DEMANDING');
  });
});
