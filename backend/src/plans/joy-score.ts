/**
 * JoyScore 纯函数评分引擎。
 * 权重契约来源：10-Qoder代码生成契约补全.md §7；
 * Fixture 验收：fixtures/scoring/kul-stopover-breakdown.json 总分严格等于 92。
 * 签证资格是硬门槛，不进入分数。
 */

export interface JoyComponent {
  key:
    | 'COST_VALUE'
    | 'USABLE_EXPERIENCE_TIME'
    | 'SCHEDULE_COMFORT'
    | 'INDEPENDENT_TICKET_RISK'
    | 'PREFERENCE_MATCH'
    | 'DATA_CONFIDENCE';
  weight: number;
  normalized: number; // 0..1
  points: number;
  explanation: string;
}

export const JOY_WEIGHTS: Record<JoyComponent['key'], number> = {
  COST_VALUE: 30,
  USABLE_EXPERIENCE_TIME: 25,
  SCHEDULE_COMFORT: 20,
  INDEPENDENT_TICKET_RISK: 10,
  PREFERENCE_MATCH: 10,
  DATA_CONFIDENCE: 5,
};

export function pointsOf(key: JoyComponent['key'], normalized: number): number {
  return Math.round(JOY_WEIGHTS[key] * Math.min(1, Math.max(0, normalized)));
}

export function scoreJoyScore(components: Array<Pick<JoyComponent, 'key' | 'normalized' | 'explanation'>>): {
  total: number;
  components: JoyComponent[];
} {
  const full: JoyComponent[] = components.map((c) => ({
    key: c.key,
    weight: JOY_WEIGHTS[c.key],
    normalized: Math.min(1, Math.max(0, c.normalized)),
    points: pointsOf(c.key, c.normalized),
    explanation: c.explanation,
  }));
  const total = Math.round(full.reduce((s, c) => s + c.points, 0));
  return { total, components: full };
}

export interface PlanScoringInput {
  directBaselinePrice: number | null;
  airfareTotal: number;
  maxAirfareDelta: number | null;
  usableHours: number;
  stayDays: number;
  redEyeSegments: number;
  airportChanges: number;
  departureHourLocal: number;
  arrivalHourLocal: number;
  interestsMatched: number; // 0..1
  isSimulated: boolean;
}

/** 真实方案的归一化启发式（与 Fixture 语义一致）。 */
export function buildJoyScore(input: PlanScoringInput) {
  const delta =
    input.directBaselinePrice !== null ? input.airfareTotal - input.directBaselinePrice : 0;
  const budget = input.maxAirfareDelta ?? 150;
  const costNorm =
    delta <= 0
      ? 1
      : delta <= budget
        ? 0.9
        : delta <= budget * 1.5
          ? 0.6
          : 0.3;

  const usableDays = input.usableHours / 24;
  const timeNorm = Math.min(1, Math.max(0, usableDays / Math.max(1, input.stayDays)) * 0.96);

  let comfort = 1;
  comfort -= input.redEyeSegments * 0.25;
  comfort -= input.airportChanges * 0.15;
  if (input.departureHourLocal < 6 || input.departureHourLocal >= 22) comfort -= 0.15;
  if (input.arrivalHourLocal >= 23) comfort -= 0.1;
  const comfortNorm = Math.min(1, Math.max(0, comfort));

  // 独立机票风险：停留越充足、衔接风险越低
  const riskNorm = input.stayDays >= 3 ? 0.8 : input.stayDays === 2 ? 0.65 : 0.5;

  const confidenceNorm = input.isSimulated ? 0.95 : 1;

  return scoreJoyScore([
    { key: 'COST_VALUE', normalized: costNorm, explanation: costNorm >= 0.9 ? '增量成本在用户预算内。' : '增量成本接近或超出预算。' },
    { key: 'USABLE_EXPERIENCE_TIME', normalized: timeNorm, explanation: `约 ${usableDays.toFixed(1)} 天有效游玩时间。` },
    { key: 'SCHEDULE_COMFORT', normalized: comfortNorm, explanation: comfortNorm >= 0.85 ? '起降时间舒适，无红眼。' : '存在红眼或换机场带来的疲劳。' },
    { key: 'INDEPENDENT_TICKET_RISK', normalized: riskNorm, explanation: '两张独立订单，停留时间影响衔接余量。' },
    { key: 'PREFERENCE_MATCH', normalized: Math.min(1, Math.max(0, input.interestsMatched)), explanation: '与用户兴趣标签匹配。' },
    { key: 'DATA_CONFIDENCE', normalized: confidenceNorm, explanation: input.isSimulated ? 'Atlas Sandbox 模拟数据，带测试标签。' : '数据字段完整。' },
  ]);
}
