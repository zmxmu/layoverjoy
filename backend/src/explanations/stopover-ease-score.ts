/**
 * StopoverEaseScore（14 号方案 §7）：完全确定性的转机便利度评分。
 * 模型只能解释该分数与 reason codes，不得修改。
 */

export interface EaseInput {
  sameAirport: boolean;
  crossAirport: boolean;
  hasStructuredRail: boolean;
  /** 机场→核心区典型单程分钟（区间中位数）；缺失为 undefined。 */
  airportToCoreMinutes?: number;
  arrivalLocalHour: number; // 0-23
  departureLocalHour: number; // 0-23
  usableExperienceMinutes: number;
  separateTickets: boolean;
  recheckBaggage: boolean;
  redEyeLegs: number;
  eligibilityNeedsReview: boolean;
}

export interface EaseResult {
  score: number;
  level: 'EASY' | 'SMOOTH' | 'PLAN_CAREFULLY' | 'DEMANDING';
  positiveReasonCodes: string[];
  cautionReasonCodes: string[];
}

export function computeStopoverEase(i: EaseInput): EaseResult {
  let score = 50;
  const positive: string[] = [];
  const caution: string[] = [];

  if (i.sameAirport) {
    score += 12;
    positive.push('SAME_AIRPORT');
  }
  if (i.crossAirport) {
    score -= 25;
    caution.push('CROSS_AIRPORT_TRANSFER');
  }
  if (i.hasStructuredRail) {
    score += 10;
    positive.push('STRUCTURED_AIRPORT_RAIL');
  }
  if (i.airportToCoreMinutes !== undefined) {
    if (i.airportToCoreMinutes <= 45) {
      score += 10;
      positive.push('FAST_AIRPORT_TO_CORE');
    } else if (i.airportToCoreMinutes > 75) {
      score -= 10;
      caution.push('SLOW_AIRPORT_TO_CORE');
    }
  }
  if (i.arrivalLocalHour >= 6 && i.arrivalLocalHour < 20) {
    score += 6;
    positive.push('DAYTIME_ARRIVAL');
  } else if (i.arrivalLocalHour >= 23 || i.arrivalLocalHour < 5) {
    score -= 6;
    caution.push('RED_EYE_ARRIVAL');
  }
  if (i.departureLocalHour >= 10 && i.departureLocalHour < 23) {
    score += 6;
    positive.push('COMFORTABLE_DEPARTURE');
  } else if (i.departureLocalHour >= 0 && i.departureLocalHour < 8) {
    score -= 6;
    caution.push('EARLY_DEPARTURE');
  }
  if (i.usableExperienceMinutes >= 30 * 60) {
    score += 8;
    positive.push('SUBSTANTIAL_EXPERIENCE_WINDOW');
  } else if (i.usableExperienceMinutes < 10 * 60) {
    score -= 8;
    caution.push('THIN_EXPERIENCE_WINDOW');
  }
  if (i.separateTickets) {
    score -= 8;
    caution.push('SEPARATE_TICKETS');
  }
  if (i.recheckBaggage) {
    score -= 6;
    caution.push('BAGGAGE_RECHECK');
  }
  const redEyePenalty = Math.min(10, 5 * Math.max(0, i.redEyeLegs));
  if (redEyePenalty > 0) {
    score -= redEyePenalty;
    caution.push('RED_EYE_SEGMENTS');
  }
  if (i.eligibilityNeedsReview) {
    score -= 8;
    caution.push('ELIGIBILITY_NEEDS_REVIEW');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const level: EaseResult['level'] =
    clamped >= 80 ? 'EASY' : clamped >= 60 ? 'SMOOTH' : clamped >= 40 ? 'PLAN_CAREFULLY' : 'DEMANDING';
  return { score: clamped, level, positiveReasonCodes: positive, cautionReasonCodes: caution };
}
