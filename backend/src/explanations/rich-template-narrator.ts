/**
 * RichTemplateNarrator（14 号方案 §12）：Nosana 超时/输出不合格时的同结构丰富降级。
 * 只使用确定性上下文与版本化城市资料，绝不退回旧空泛模板。
 */

import { StopoverExperienceContext } from './experience-context.builder';
import { RichStopoverNarrative } from './rich-narrative.validator';

const PERIOD_ZH: Record<string, string> = {
  EARLY_MORNING: '清晨', MORNING: '上午', AFTERNOON: '下午', EVENING: '傍晚', LATE_NIGHT: '深夜',
};
const PERIOD_EN: Record<string, string> = {
  EARLY_MORNING: 'early morning', MORNING: 'morning', AFTERNOON: 'afternoon', EVENING: 'evening', LATE_NIGHT: 'late night',
};
const LEVEL_ZH: Record<string, string> = { EASY: '轻松', SMOOTH: '顺畅', PLAN_CAREFULLY: '需规划', DEMANDING: '较折腾' };
const LEVEL_EN: Record<string, string> = { EASY: 'Easy', SMOOTH: 'Smooth', PLAN_CAREFULLY: 'Plan carefully', DEMANDING: 'Demanding' };

const POSITIVE_ZH: Record<string, string> = {
  SAME_AIRPORT: '到达和离开使用同一机场',
  STRUCTURED_AIRPORT_RAIL: '机场交通路径清晰',
  FAST_AIRPORT_TO_CORE: '机场到核心区很快',
  DAYTIME_ARRIVAL: '抵达时间适合直接进城',
  COMFORTABLE_DEPARTURE: '离境时间不需要凌晨赶路',
  SUBSTANTIAL_EXPERIENCE_WINDOW: '净体验窗口足够安排完整内容',
};
const POSITIVE_EN: Record<string, string> = {
  SAME_AIRPORT: 'Arrival and departure use the same airport',
  STRUCTURED_AIRPORT_RAIL: 'Clear airport rail link',
  FAST_AIRPORT_TO_CORE: 'Quick ride from airport to core districts',
  DAYTIME_ARRIVAL: 'Daytime arrival suits going straight into town',
  COMFORTABLE_DEPARTURE: 'Departure does not require a pre-dawn rush',
  SUBSTANTIAL_EXPERIENCE_WINDOW: 'The usable window fits full content',
};
const CAUTION_ZH: Record<string, string> = {
  CROSS_AIRPORT_TRANSFER: '需要跨机场换乘',
  SLOW_AIRPORT_TO_CORE: '机场到市区耗时较长',
  RED_EYE_ARRIVAL: '凌晨到达需要先补觉',
  EARLY_DEPARTURE: '离境偏早，最后一晚要留缓冲',
  THIN_EXPERIENCE_WINDOW: '可安排的外出时间有限',
  SEPARATE_TICKETS: '两张独立机票需要重新托运行李',
  BAGGAGE_RECHECK: '行李需要重新托运',
  RED_EYE_SEGMENTS: '含红眼航段',
  ELIGIBILITY_NEEDS_REVIEW: '入境资格仍需人工复核',
};
const CAUTION_EN: Record<string, string> = {
  CROSS_AIRPORT_TRANSFER: 'Cross-airport transfer required',
  SLOW_AIRPORT_TO_CORE: 'Long airport-to-city ride',
  RED_EYE_ARRIVAL: 'Late-night arrival needs recovery first',
  EARLY_DEPARTURE: 'Early departure; keep the last night buffered',
  THIN_EXPERIENCE_WINDOW: 'Limited time to go out',
  SEPARATE_TICKETS: 'Separate tickets mean baggage recheck',
  BAGGAGE_RECHECK: 'Bags must be rechecked',
  RED_EYE_SEGMENTS: 'Includes red-eye segments',
  ELIGIBILITY_NEEDS_REVIEW: 'Entry eligibility still needs manual review',
};

export function buildRichTemplateNarrative(ctx: StopoverExperienceContext, lang: 'zh' | 'en'): RichStopoverNarrative {
  const zh = lang === 'zh';
  const P = zh ? PERIOD_ZH : PERIOD_EN;
  const s = ctx.schedule;

  // 兴趣匹配优先的城市优势
  const scored = [...ctx.cityEvidence].sort((a, b) => overlap(b) - overlap(a));
  function overlap(e: { interestTags: string[] }) {
    return e.interestTags.filter((t) => ctx.matchedInterests.includes(t)).length;
  }
  const advantages = scored.slice(0, 2);

  // 贪心小行程：抵达日 → 完整日 → 离境日，不凑数
  const miniPlan: RichStopoverNarrative['miniPlan'] = [];
  const pick = (slot: 'ARRIVAL_DAY' | 'FULL_DAY' | 'DEPARTURE_DAY') =>
    [...ctx.feasibleExperienceBlocks].sort((a, b) => overlap(b) - overlap(a)).find((b) => b.slot === slot && !miniPlan.some((m) => m.evidenceKeys[0] === b.evidenceKey));
  for (const slot of ['ARRIVAL_DAY', 'FULL_DAY', 'DEPARTURE_DAY'] as const) {
    const b = pick(slot);
    if (!b) continue;
    miniPlan.push({
      slot,
      title: zh ? b.title : b.titleEn,
      description: zh
        ? slot === 'ARRIVAL_DAY' ? `抵达后以「${b.area}」为主，不跨区。` : slot === 'DEPARTURE_DAY' ? `离境前在「${b.area}」短安排，按时返回机场。` : `以「${b.area}」为核心的完整时间块。`
        : slot === 'ARRIVAL_DAY' ? `After arrival, stay around ${b.areaEn}; no cross-city hops.` : slot === 'DEPARTURE_DAY' ? `A short ${b.areaEn} block before heading to the airport.` : `A full block around ${b.areaEn}.`,
      evidenceKeys: [b.evidenceKey],
    });
  }

  const topInterest = ctx.matchedInterests[0];
  const windowLabel = zh ? s.experienceWindowLabelZh : s.experienceWindowLabelEn;
  const level = zh ? LEVEL_ZH[ctx.ease.level] : LEVEL_EN[ctx.ease.level];

  const verdict: RichStopoverNarrative['verdict'] =
    s.experienceWindowCode === 'NO_CITY_VISIT' ? 'NOT_RECOMMENDED'
    : ctx.ease.cautionReasonCodes.includes('RED_EYE_ARRIVAL') && ctx.ease.cautionReasonCodes.includes('EARLY_DEPARTURE') ? 'ONLY_IF_INTERESTED'
    : ctx.ease.level === 'DEMANDING' ? 'ONLY_IF_INTERESTED'
    : ctx.ease.score >= 80 && topInterest ? 'EXCELLENT_FIT'
    : ctx.ease.score >= 60 ? 'GOOD_FIT'
    : 'BALANCED';

  const headline = zh
    ? `${windowLabel}·${level}的一程城市停留`
    : `A ${windowLabel.toLowerCase()} stop, ${level.toLowerCase()}`;

  const summary = zh
    ? `${P[s.arrivalPeriod]}抵达、${P[s.departurePeriod]}离境，${s.sameAirport ? '同一机场往返' : '需要换机场'}，节奏${ctx.ease.level === 'DEMANDING' ? '偏紧' : '从容'}；${windowLabel}里可以把${advantages[0] ? advantages[0].title : '城市核心体验'}和一段夜间内容自然串起来。`
    : `Arriving in the ${P[s.arrivalPeriod]} and leaving in the ${P[s.departurePeriod]}, ${s.sameAirport ? 'on the same airport' : 'with an airport change'}, the rhythm is ${ctx.ease.level === 'DEMANDING' ? 'tight' : 'comfortable'}; a ${windowLabel.toLowerCase()} lets you chain ${advantages[0] ? advantages[0].titleEn.toLowerCase() : 'the core city experience'} with an evening block.`;

  const positives = ctx.ease.positiveReasonCodes.slice(0, 3).map((c) => (zh ? POSITIVE_ZH[c] ?? c : POSITIVE_EN[c] ?? c));
  const cautions = ctx.ease.cautionReasonCodes.slice(0, 2).map((c) => (zh ? CAUTION_ZH[c] ?? c : CAUTION_EN[c] ?? c));

  const gain = zh
    ? ctx.fareTradeoffBand === 'SAVES' ? '比直飞更低的票价，换一段有内容的城市时间。' : '用一段可控的中转时间，换一整段城市体验。'
    : ctx.fareTradeoffBand === 'SAVES' ? 'A lower fare than direct, plus real city time.' : 'A controlled stopover window traded for a full city experience.';
  const sacrifice = zh
    ? ctx.riskFlags.includes('SEPARATE_TICKETS') || ctx.riskFlags.includes('RECHECK_BAGGAGE')
      ? '需要处理独立机票与重新托运行李，机场缓冲要更宽松。'
      : '需要保留更宽松的机场缓冲。'
    : ctx.riskFlags.includes('SEPARATE_TICKETS') || ctx.riskFlags.includes('RECHECK_BAGGAGE')
      ? 'Separate tickets and baggage recheck need handling; keep a wider airport buffer.'
      : 'Keep a wider airport buffer.';

  const tipSrc = ctx.feasibleExperienceBlocks.length ? ctx.cityEvidence : ctx.cityEvidence;
  const practicalTip = zh
    ? (tipSrc[0]?.body ?? '把活动集中在同一区域，减少往返移动。')
    : (tipSrc[0]?.bodyEn ?? 'Cluster activities in one district to cut cross-city trips.');

  return {
    schemaVersion: '2.0',
    lang,
    verdict,
    headline,
    summary,
    cityAdvantages: advantages.map((a) => ({ title: zh ? a.title : a.titleEn, body: zh ? a.body : a.bodyEn, evidenceKeys: [a.evidenceKey] })),
    miniPlan,
    easeNarrative: {
      summary: zh
        ? `转机便利度 ${ctx.ease.score}/100（${level}）。`
        : `Stopover ease ${ctx.ease.score}/100 (${level}).`,
      positives,
      cautions,
    },
    tradeoff: { gain, sacrifice },
    practicalTip,
  };
}
