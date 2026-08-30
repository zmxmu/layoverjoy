/**
 * 丰富解读闭环测试（14 号方案 A-01~A-10 子集）：
 * 上下文构建、兴趣影响、Validator 拒绝、RichTemplateNarrator 同结构降级。
 */
import { describe, expect, it } from 'vitest';
import { buildExperienceContext } from '../src/explanations/experience-context.builder';
import { validateRichNarrative } from '../src/explanations/rich-narrative.validator';
import { buildRichTemplateNarrative } from '../src/explanations/rich-template-narrator';

const leg1 = { origin: 'SIN', destination: 'KUL', departureAt: '2026-09-20T13:30:00Z', arrivalAt: '2026-09-20T13:30:00Z' };
const leg2 = { origin: 'KUL', destination: 'PVG', departureAt: '2026-09-22T18:40:00Z', arrivalAt: '2026-09-22T18:40:00Z' };

function ctxFor(interests: string[], over: Partial<Parameters<typeof buildExperienceContext>[0]> = {}) {
  return buildExperienceContext({
    cityId: 'my-kuala-lumpur',
    cityNameZh: '吉隆坡',
    cityNameEn: 'Kuala Lumpur',
    timeZone: 'Asia/Kuala_Lumpur',
    leg1: { ...leg1, arrivalAt: '2026-09-20T13:30:00Z' },
    leg2,
    riskFlags: ['SEPARATE_TICKETS', 'RECHECK_BAGGAGE'],
    interests,
    airfareDelta: -9,
    currency: 'SGD',
    eligibilityStatus: 'ELIGIBLE',
    ...over,
  });
}

describe('ExperienceContextBuilder (A-01/A-02/A-06)', () => {
  it('A-01 当地时间与净体验窗口（IANA 时区）', () => {
    const ctx = ctxFor(['food']);
    // KUL = UTC+8：13:30Z → 21:30 当地（EVENING）
    expect(ctx.schedule.arrivalPeriod).toBe('EVENING');
    expect(ctx.schedule.experienceWindowCode).not.toBe('');
    expect(ctx.schedule.confidence).toBe('HIGH');
    expect(ctx.matchedInterests).toContain('FOOD');
  });
  it('A-02 兴趣改变优势排序，确定性部分不变', () => {
    const a = ctxFor(['food']);
    const b = ctxFor(['oldtown']);
    expect(a.schedule).toEqual(b.schedule);
    expect(a.ease).toEqual(b.ease);
    const na = buildRichTemplateNarrative(a, 'zh');
    const nb = buildRichTemplateNarrative(b, 'zh');
    expect(na.cityAdvantages[0].evidenceKeys[0]).toBe('KUL_FOOD_DIVERSITY');
    expect(nb.cityAdvantages[0].evidenceKeys[0]).not.toBe('KUL_FOOD_DIVERSITY');
  });
  it('A-06 缺机场时间 → LOW 置信度', () => {
    const ctx = ctxFor([], { cityId: 'vn-hanoi', cityNameZh: '河内', cityNameEn: 'Hanoi', timeZone: 'Asia/Ho_Chi_Minh' });
    expect(ctx.schedule.confidence).toBe('LOW');
  });
  it('A-05 凌晨到达+清晨离境 → 不包装高质量体验', () => {
    const ctx = ctxFor([], {
      leg1: { ...leg1, arrivalAt: '2026-09-20T17:00:00Z' }, // KUL 01:00
      leg2: { ...leg2, departureAt: '2026-09-22T16:00:00Z' }, // KUL 00:00
    });
    const n = buildRichTemplateNarrative(ctx, 'zh');
    expect(['ONLY_IF_INTERESTED', 'NOT_RECOMMENDED', 'BALANCED']).toContain(n.verdict);
  });
});

describe('RichNarrativeValidator (A-07/A-08/A-09)', () => {
  const ctx = ctxFor(['food']);
  const good = buildRichTemplateNarrative(ctx, 'zh');

  it('模板自身输出通过校验（同结构降级）', () => {
    const v = validateRichNarrative(good, ctx, 'zh');
    expect(v.ok).toBe(true);
  });
  it('A-07 未提供证据 → 拒绝', () => {
    const bad = { ...good, cityAdvantages: [{ title: 'x', body: 'y', evidenceKeys: ['NOT_IN_CATALOG'] }] };
    expect(validateRichNarrative(bad, ctx, 'zh').ok).toBe(false);
  });
  it('A-08 技术归属 → 拒绝', () => {
    const bad = { ...good, summary: good.summary + '（由 Nosana 生成）' };
    expect(validateRichNarrative(bad, ctx, 'zh').ok).toBe(false);
  });
  it('A-09 金额/货币 → 拒绝', () => {
    const bad = { ...good, tradeoff: { gain: '省下 SGD 120', sacrifice: 'x' } };
    expect(validateRichNarrative(bad, ctx, 'zh').ok).toBe(false);
  });
  it('复述停留天数/小时 → 拒绝', () => {
    const bad = { ...good, summary: '停留 2 天，可玩 30 小时。' };
    expect(validateRichNarrative(bad, ctx, 'zh').ok).toBe(false);
  });
  it('A-12 语言混用 → 拒绝', () => {
    const bad = { ...good, summary: 'A nice stop 停留很好' };
    expect(validateRichNarrative(bad, ctx, 'en').ok).toBe(false);
  });
});

describe('RichTemplateNarrator (A-10)', () => {
  it('Nosana 不可用时仍有城市差异的完整结构', () => {
    const kul = buildRichTemplateNarrative(ctxFor(['food']), 'zh');
    const hkg = buildRichTemplateNarrative(
      buildExperienceContext({
        cityId: 'hk-hong-kong', cityNameZh: '香港', cityNameEn: 'Hong Kong', timeZone: 'Asia/Hong_Kong',
        leg1, leg2, riskFlags: [], interests: ['food'], airfareDelta: 10, currency: 'SGD', eligibilityStatus: 'CONDITIONALLY_ELIGIBLE',
      }),
      'zh',
    );
    expect(kul.cityAdvantages.length).toBeGreaterThan(0);
    expect(hkg.cityAdvantages[0].evidenceKeys[0]).toContain('HKG_');
    expect(kul.easeNarrative.summary).toContain('/100');
    expect(hkg.easeNarrative.summary).toContain('/100');
    expect(kul.miniPlan.length).toBeGreaterThan(0);
  });
});
