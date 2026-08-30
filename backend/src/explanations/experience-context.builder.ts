/**
 * ExperienceContextBuilder（14 号方案 §6/§9.1）：先确定性计算事实，再交给模型。
 * 时间一律按中转城市 IANA 时区换算；模型不参与任何数值计算。
 */

import { computeStopoverEase, EaseResult } from './stopover-ease-score';
import experienceCatalog from './data/city-experience-catalog.zh-en.json';

export const EXPERIENCE_CATALOG_VERSION = (experienceCatalog as any).schemaVersion as string;
export const PROMPT_VERSION = 'stopover-value-v2';

/** 确定性时间预算配置（MVP 默认值，UI/日志标记为估算）。 */
export const TIME_BUDGET = {
  arrivalImmigrationAndBaggageMinutes: 90,
  arrivalCarryOnOnlyMinutes: 60,
  preDepartureBufferMinutes: 180,
  separateTicketsExtraMinutes: 60,
  recheckBaggageExtraMinutes: 45,
  sleepPerNightMinutes: 7 * 60,
  defaultAirportToCityMinutes: 45, // 缺结构化数据时的保守默认，置信度 LOW
};

export type DayPeriod = 'EARLY_MORNING' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'LATE_NIGHT';

export function periodOfHour(h: number): DayPeriod {
  if (h >= 5 && h < 9) return 'EARLY_MORNING';
  if (h >= 9 && h < 12) return 'MORNING';
  if (h >= 12 && h < 17) return 'AFTERNOON';
  if (h >= 17 && h < 22) return 'EVENING';
  return 'LATE_NIGHT';
}

/** IANA 时区下的小时与日期（跨时区/跨日正确）。 */
export function localParts(iso: string, timeZone: string): { hour: number; dateKey: string } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = Number(get('hour')) % 24;
  return { hour, dateKey: `${get('year')}-${get('month')}-${get('day')}` };
}

export interface ExperienceWindow {
  code: string;
  labelZh: string;
  labelEn: string;
}

/** §6.3 体验窗口标签（分钟精确边界）。 */
export function experienceWindowOf(minutes: number): ExperienceWindow {
  const h = minutes / 60;
  if (h < 6) return { code: 'NO_CITY_VISIT', labelZh: '不建议出机场游玩', labelEn: 'Stay airside' };
  if (h < 10) return { code: 'HALF_DAY', labelZh: '半日快闪', labelEn: 'Half-day flash' };
  if (h < 18) return { code: 'ONE_FULL_DAY', labelZh: '1个完整白天', labelEn: 'One full day' };
  if (h < 30) return { code: 'ONE_DAY_ONE_NIGHT', labelZh: '1天1夜', labelEn: 'A day and a night' };
  if (h < 46) return { code: 'TWO_FULL_DAYS', labelZh: '2个完整白天', labelEn: 'Two full days' };
  if (h < 66) return { code: 'TWO_DAYS_PLUS_NIGHT', labelZh: '2天加1个夜晚', labelEn: 'Two days plus a night' };
  return { code: 'CITY_SHORT_BREAK', labelZh: '3天以上城市短假', labelEn: 'A city short break' };
}

export interface CityExperienceEntry {
  cityId: string;
  version: number;
  lastReviewedAt: string;
  timezone?: string;
  uniqueAdvantages: Array<{ id: string; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string; interestTags: string[] }>;
  airportAccess: Array<{ airportIata: string; primaryMode: string; typicalOneWayMinutes?: { min: number; max: number }; complexity: string; lateNightAvailability: string; sourceUrl: string; sourceAuthority?: string; verifiedAt: string }>;
  experienceBlocks: Array<{ id: string; titleZh: string; titleEn: string; areaZh: string; areaEn: string; durationMinutes: { min: number; max: number }; bestTimeWindows: string[]; interestTags: string[] }>;
  practicalTips: Array<{ id: string; textZh: string; textEn: string }>;
}

export function getCityExperience(cityId: string): CityExperienceEntry | null {
  const cities = (experienceCatalog as any).cities as CityExperienceEntry[];
  return cities.find((c) => c.cityId === cityId) ?? null;
}

/** 搜索兴趣 code → 资料库 interestTags。 */
export function interestTagsOf(interests: string[]): string[] {
  const map: Record<string, string[]> = {
    food: ['FOOD'],
    nature: ['NATURE'],
    museum: ['MUSEUM'],
    shopping: ['SHOPPING'],
    nightlife: ['NIGHTLIFE'],
    oldtown: ['LOCAL_CULTURE', 'WALKING'],
    family: ['FAMILY'],
  };
  return [...new Set(interests.flatMap((i) => map[i] ?? []))];
}

export interface BuilderInput {
  cityId: string;
  cityNameZh: string;
  cityNameEn: string;
  timeZone: string; // IANA，来自城市机场目录
  leg1: { origin: string; destination: string; departureAt: string; arrivalAt: string };
  leg2: { origin: string; destination: string; departureAt: string; arrivalAt: string };
  riskFlags: string[];
  interests: string[];
  airfareDelta: number | null;
  currency: string;
  eligibilityStatus?: string | null; // v2 评估状态
}

export interface StopoverExperienceContext {
  contextVersion: '2.0';
  city: { cityId: string; nameZh: string; nameEn: string };
  schedule: {
    arrivalLocal: string;
    departureLocal: string;
    arrivalPeriod: DayPeriod;
    departurePeriod: DayPeriod;
    sameAirport: boolean;
    arrivalAirport: string;
    departureAirport: string;
    grossStopoverMinutes: number;
    usableExperienceMinutes: number;
    experienceWindowCode: string;
    experienceWindowLabelZh: string;
    experienceWindowLabelEn: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    budgetNoteZh: string;
    budgetNoteEn: string;
  };
  ease: EaseResult;
  cityEvidence: Array<{ evidenceKey: string; title: string; titleEn: string; body: string; bodyEn: string; interestTags: string[] }>;
  feasibleExperienceBlocks: Array<{ evidenceKey: string; title: string; titleEn: string; area: string; areaEn: string; slot: 'ARRIVAL_DAY' | 'FULL_DAY' | 'DEPARTURE_DAY'; durationMinutes: number; interestTags: string[] }>;
  matchedInterests: string[];
  riskFlags: string[];
  fareTradeoffBand: 'SAVES' | 'SIMILAR' | 'SMALL_PREMIUM' | 'LARGE_PREMIUM' | 'UNKNOWN';
  eligibilityDisplayStatus: 'READY' | 'CONDITIONAL' | 'NEEDS_REVIEW';
  catalogVersion: string;
  promptVersion: string;
}

export function buildExperienceContext(input: BuilderInput): StopoverExperienceContext {
  const exp = getCityExperience(input.cityId);
  const arrival = localParts(input.leg1.arrivalAt, input.timeZone);
  const departure = localParts(input.leg2.departureAt, input.timeZone);

  const gross = Math.max(0, Math.round((new Date(input.leg2.departureAt).getTime() - new Date(input.leg1.arrivalAt).getTime()) / 60000));

  const sameAirport = input.leg1.destination === input.leg2.origin;
  const crossAirport = !sameAirport;

  const access = exp?.airportAccess.find((a) => a.airportIata === input.leg1.destination);
  const accessMedian = access?.typicalOneWayMinutes ? Math.round((access.typicalOneWayMinutes.min + access.typicalOneWayMinutes.max) / 2) : undefined;
  const airportToCity = accessMedian ?? TIME_BUDGET.defaultAirportToCityMinutes;
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = access?.typicalOneWayMinutes ? (sameAirport ? 'HIGH' : 'MEDIUM') : 'LOW';

  const separateTickets = input.riskFlags.includes('SEPARATE_TICKETS');
  const recheckBaggage = input.riskFlags.includes('RECHECK_BAGGAGE');
  const redEyeLegs = [input.leg1, input.leg2].filter((l) => {
    const h = new Date(l.departureAt).getUTCHours();
    return h >= 23 || h < 5;
  }).length;

  // 夜晚数：当地日历日差；清晨离境不计完整睡眠夜
  const dateDiff = Math.max(0, Math.round((new Date(`${departure.dateKey}T00:00:00Z`).getTime() - new Date(`${arrival.dateKey}T00:00:00Z`).getTime()) / 86400000));
  const nights = Math.max(0, dateDiff - (departure.hour < 6 ? 1 : 0));

  const mandatory =
    TIME_BUDGET.arrivalImmigrationAndBaggageMinutes +
    airportToCity * 2 +
    TIME_BUDGET.preDepartureBufferMinutes +
    (separateTickets ? TIME_BUDGET.separateTicketsExtraMinutes : 0) +
    (recheckBaggage ? TIME_BUDGET.recheckBaggageExtraMinutes : 0) +
    nights * TIME_BUDGET.sleepPerNightMinutes;

  const usable = Math.max(0, gross - mandatory);
  const window = experienceWindowOf(usable);

  const ease = computeStopoverEase({
    sameAirport,
    crossAirport,
    hasStructuredRail: ['AIRPORT_RAIL', 'METRO'].includes(access?.primaryMode ?? ''),
    airportToCoreMinutes: accessMedian,
    arrivalLocalHour: arrival.hour,
    departureLocalHour: departure.hour,
    usableExperienceMinutes: usable,
    separateTickets,
    recheckBaggage,
    redEyeLegs,
    eligibilityNeedsReview: input.eligibilityStatus ? !['ELIGIBLE', 'CONDITIONALLY_ELIGIBLE'].includes(input.eligibilityStatus) : true,
  });

  const matchedTags = interestTagsOf(input.interests);
  const cityEvidence = (exp?.uniqueAdvantages ?? []).map((a) => ({
    evidenceKey: a.id,
    title: a.titleZh,
    titleEn: a.titleEn,
    body: a.bodyZh,
    bodyEn: a.bodyEn,
    interestTags: a.interestTags,
  }));

  const slotOf = (windows: string[], duration: number): 'ARRIVAL_DAY' | 'FULL_DAY' | 'DEPARTURE_DAY' => {
    if (windows.includes('EVENING') || windows.includes('LATE_NIGHT')) return 'ARRIVAL_DAY';
    if ((windows.includes('EARLY_MORNING') || windows.includes('MORNING')) && duration <= 150) return 'DEPARTURE_DAY';
    return 'FULL_DAY';
  };
  const feasibleExperienceBlocks = (exp?.experienceBlocks ?? []).map((b) => ({
    evidenceKey: b.id,
    title: b.titleZh,
    titleEn: b.titleEn,
    area: b.areaZh,
    areaEn: b.areaEn,
    slot: slotOf(b.bestTimeWindows, b.durationMinutes.min),
    durationMinutes: Math.round((b.durationMinutes.min + b.durationMinutes.max) / 2),
    interestTags: b.interestTags,
  }));

  const delta = input.airfareDelta;
  const fareTradeoffBand =
    delta == null ? 'UNKNOWN' : delta < -1 ? 'SAVES' : delta <= 1 ? 'SIMILAR' : delta <= 50 ? 'SMALL_PREMIUM' : 'LARGE_PREMIUM';

  const eligibilityDisplayStatus =
    input.eligibilityStatus === 'ELIGIBLE' ? 'READY' : input.eligibilityStatus === 'CONDITIONALLY_ELIGIBLE' ? 'CONDITIONAL' : 'NEEDS_REVIEW';

  return {
    contextVersion: '2.0',
    city: { cityId: input.cityId, nameZh: input.cityNameZh, nameEn: input.cityNameEn },
    schedule: {
      arrivalLocal: input.leg1.arrivalAt,
      departureLocal: input.leg2.departureAt,
      arrivalPeriod: periodOfHour(arrival.hour),
      departurePeriod: periodOfHour(departure.hour),
      sameAirport,
      arrivalAirport: input.leg1.destination,
      departureAirport: input.leg2.origin,
      grossStopoverMinutes: gross,
      usableExperienceMinutes: usable,
      experienceWindowCode: window.code,
      experienceWindowLabelZh: window.labelZh,
      experienceWindowLabelEn: window.labelEn,
      confidence,
      budgetNoteZh: '已扣除入境、往返机场、提前候机和基础睡眠时间',
      budgetNoteEn: 'After immigration, airport transfers, pre-flight buffer and basic sleep',
    },
    ease,
    cityEvidence,
    feasibleExperienceBlocks,
    matchedInterests: matchedTags,
    riskFlags: input.riskFlags,
    fareTradeoffBand,
    eligibilityDisplayStatus,
    catalogVersion: EXPERIENCE_CATALOG_VERSION,
    promptVersion: PROMPT_VERSION,
  };
}
