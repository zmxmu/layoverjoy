import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AtlasService } from '../atlas/atlas.service';
import { EntryRulesService } from '../entry-rules/entry-rules.service';
import { UsersService } from '../users/users.service';
import { candidateHubs, CITY_PACKS, CityEntry, resolveLocation } from '../airports/catalog';
import { buildJoyScore } from '../plans/joy-score';
import { AppError } from '../common/errors';
import { FlightOffer } from '../atlas/atlas.types';
import { loadEnv } from '../config/env';
import { FIELD_CRYPTO } from '../core.module';
import { FieldCrypto } from '../common/crypto';

/**
 * 搜索编排器。预算契约（10 契约 §6）：
 * 候选 Hub ≤3、每 Hub 停留天数 ≤2、Atlas Search ≤10、并发 3、
 * 单请求超时 8s（Provider 内）、软超时 20s、硬超时 30s、缓存 15min。
 */
export const SEARCH_BUDGET = {
  maxHubs: 3,
  maxStayVariantsPerHub: 2,
  maxSearchCalls: 10,
  concurrency: 3,
  softTimeoutMs: 20_000,
  hardTimeoutMs: 30_000,
};

interface CandidateOutcome {
  city: CityEntry;
  status: 'ELIGIBLE' | 'NEEDS_INFO' | 'INELIGIBLE' | 'NO_INVENTORY' | 'FAILED' | 'EXPERIENCE_REJECTED' | 'COMPLETED';
  reasonCodes: string[];
  ruleId?: string;
  eligibilitySnapshotId?: string;
  error?: string;
}

@Injectable()
export class SearchOrchestrator {
  private readonly logger = new Logger('SearchOrchestrator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly atlas: AtlasService,
    private readonly rules: EntryRulesService,
    private readonly users: UsersService,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  /** 异步执行搜索编排（失败不抛出，写入 SearchRun 状态）。 */
  async run(searchRunId: string, useDemoFixtureFallback: boolean): Promise<void> {
    const started = Date.now();
    const run = await this.prisma.searchRun.findUnique({ where: { id: searchRunId } });
    if (!run) return;
    try {
      await this.prisma.searchRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
      run.startedAt = new Date(); // 本地同步，供候选评估中的软超时检查使用

      const prefs: any = run.preferencesJson ?? {};
      const profile = await this.users.profileForRules(run.userId);
      const stayVariants = this.stayDayVariants(run.minStopDays, run.maxStopDays);
      const exclude = [resolveLocation(run.originInput)?.countryCode, resolveLocation(run.destinationInput)?.countryCode]
        .filter(Boolean) as string[];
      const hubs = candidateHubs(exclude, 8).slice(0, SEARCH_BUDGET.maxHubs);

      const outcomes: CandidateOutcome[] = [];
      let searchCalls = 0;
      let softTimedOut = false;

      // 1) 直飞基准（预算内第 1 次搜索）
      searchCalls += 1;
      const directOffers = await this.safeSearch({
        origin: run.originCode,
        destination: run.destinationCode,
        departDate: this.isoDate(run.departureDate),
        currency: 'SGD',
      }, useDemoFixtureFallback);
      const directBest = this.bestBookable(directOffers.offers);
      let directSnapshotId: string | null = null;
      if (directBest) {
        directSnapshotId = await this.saveOffer(run.id, 1, 'DIRECT_BASELINE', null, directBest, directOffers.label);
      }

      // 2) 候选城市：先资格硬过滤，再并行搜索（并发 3）
      const queue = [...hubs];
      const running: Promise<void>[] = [];
      const worker = async () => {
        while (queue.length > 0) {
          if (Date.now() - started > SEARCH_BUDGET.softTimeoutMs) {
            softTimedOut = true;
            return; // 软超时后不再启动新候选
          }
          const city = queue.shift();
          if (!city) return;
          if (searchCalls >= SEARCH_BUDGET.maxSearchCalls) {
            outcomes.push({ city, status: 'FAILED', reasonCodes: ['BUDGET_EXHAUSTED'] });
            continue;
          }
          await this.evaluateHub(run, city, stayVariants, profile, outcomes, () => (searchCalls += 1));
        }
      };
      for (let i = 0; i < SEARCH_BUDGET.concurrency; i++) running.push(worker());

      // 硬超时保护
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, SEARCH_BUDGET.hardTimeoutMs));
      await Promise.race([Promise.all(running), timeout]);

      // 3) 汇总状态
      const completed = outcomes.filter((o) => o.status === 'COMPLETED').length;
      const eligibilityRejected = outcomes.filter((o) => o.status === 'INELIGIBLE' || o.status === 'NEEDS_INFO').length;
      const experienceRejected = outcomes.filter((o) => o.status === 'EXPERIENCE_REJECTED').length;
      const failed = outcomes.filter((o) => o.status === 'NO_INVENTORY' || o.status === 'FAILED').length;

      const plans = await this.prisma.stopoverPlan.count({ where: { searchRunId: run.id } });
      const resultStatus = completed > 0 || plans > 0 ? (failed > 0 || softTimedOut ? 'PARTIAL' : 'COMPLETED') : failed > 0 ? 'FAILED' : 'COMPLETED';

      await this.prisma.searchRun.update({
        where: { id: run.id },
        data: {
          status: resultStatus === 'FAILED' ? 'FAILED' : 'COMPLETED',
          resultStatus,
          candidateCount: hubs.length + 1, // 含直飞基准
          eligibilityRejectedCount: eligibilityRejected,
          experienceRejectedCount: experienceRejected,
          keptPlanCount: plans,
          funnelJson: outcomes.map((o) => ({
            cityId: o.city.cityId,
            cityNameZh: o.city.cityNameZh,
            status: o.status,
            reasonCodes: o.reasonCodes,
            ruleId: o.ruleId,
          })) as any,
          completedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.error(`search ${searchRunId} failed: ${(e as Error).message}`);
      await this.prisma.searchRun.update({
        where: { id: searchRunId },
        data: {
          status: 'FAILED',
          resultStatus: 'FAILED',
          errorJson: { code: (e as AppError).code || 'INTERNAL_ERROR', message: (e as Error).message } as any,
          completedAt: new Date(),
        },
      });
    }
  }

  private stayDayVariants(min: number, max: number): number[] {
    const variants = new Set<number>();
    variants.add(Math.max(2, min));
    variants.add(Math.max(min, Math.min(max, 4)));
    return [...variants].slice(0, SEARCH_BUDGET.maxStayVariantsPerHub);
  }

  private isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private addDays(d: Date, days: number): Date {
    return new Date(d.getTime() + days * 24 * 3600 * 1000);
  }

  /** 搜索包装：区分 Sandbox 无库存与其他错误；演示 Fixture 回退仅在用户显式触发时允许。 */
  private async safeSearch(
    input: { origin: string; destination: string; departDate: string; currency?: string },
    allowDemoFallback: boolean,
  ): Promise<{ offers: FlightOffer[]; label: 'ATLAS_SANDBOX' | 'MOCK'; fallbackUsed?: boolean }> {
    try {
      const { offers } = await this.atlas.searchWithCache(input);
      return { offers, label: this.atlas.searchProviderLabel() };
    } catch (e) {
      const code = (e as AppError).code;
      if (code === 'NO_SANDBOX_INVENTORY' && allowDemoFallback && loadEnv().DEMO_FIXTURE_ENABLED) {
        // 用户明确点击“查看演示方案”后的本地 fixture 回退，结果明确标记 MOCK
        const offers = await this.atlas.searchMock(input);
        return { offers, label: 'MOCK', fallbackUsed: true };
      }
      throw e;
    }
  }

  private bestBookable(offers: FlightOffer[]): FlightOffer | null {
    const bookable = offers.filter((o) => o.priceStatus === 'current' && o.bookable);
    if (!bookable.length) return null;
    return [...bookable].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  }

  private async saveOffer(
    searchRunId: string,
    legNo: number,
    role: string,
    hubCityId: string | null,
    offer: FlightOffer,
    providerLabel: 'ATLAS_SANDBOX' | 'MOCK',
  ): Promise<string> {
    const env = loadEnv();
    const snap = await this.prisma.flightOfferSnapshot.create({
      data: {
        searchRunId,
        legNo,
        role,
        hubCityId,
        sourceProvider: providerLabel,
        providerOfferId: offer.providerOfferId,
        routingIdentifierEnc: offer.routingIdentifier
          ? this.encryptSafe(offer.routingIdentifier)
          : null,
        origin: offer.origin,
        destination: offer.destination,
        departureAt: new Date(offer.departureAt),
        arrivalAt: new Date(offer.arrivalAt),
        carrier: offer.carrier,
        flightNumber: offer.flightNumber,
        currency: offer.currency,
        totalPrice: offer.totalPrice,
        priceStatus: offer.priceStatus,
        // 契约：Sandbox/Mock 快照必须 isSimulated=true，生产接入前不存在其他来源
        isSimulated: true,
        baggageJson: (offer.baggageJson ?? null) as any,
        rawHash: this.atlas.rawHash(offer),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    return snap.id;
  }

  private encryptSafe(value: string): string | null {
    try {
      return this.crypto.encrypt(value);
    } catch {
      return null;
    }
  }

  /** 评估一个候选城市：资格 → 两段搜索 → 组合 → 评分。 */
  private async evaluateHub(
    run: any,
    city: CityEntry,
    stayVariants: number[],
    profile: Awaited<ReturnType<UsersService['profileForRules']>>,
    outcomes: CandidateOutcome[],
    consumeSearch: () => number,
  ): Promise<void> {
    const prefs: any = run.preferencesJson ?? {};
    const outcome: CandidateOutcome = { city, status: 'FAILED', reasonCodes: [] };
    outcomes.push(outcome);

    // 1) 资格硬过滤（在调用 Atlas 之前）。搜索期只做初筛：此时第二段尚未 Verify，
    // 不得谎报 onwardTicketConfirmed；硬判定在预订期（BOOKING 模式）复核。
    const eligibility = await this.rules.evaluate({
      travelDate: this.isoDate(run.departureDate),
      purpose: 'TOURISM',
      stayDays: Math.max(...stayVariants),
      passport: profile.passport,
      visas: profile.visas,
      destinationCountry: city.countryCode,
      mode: 'SEARCH_SCREEN',
    });
    outcome.ruleId = eligibility.ruleId;
    if (eligibility.status !== 'ELIGIBLE') {
      outcome.status = eligibility.status as any;
      outcome.reasonCodes = eligibility.reasonCodes;
      outcome.eligibilitySnapshotId = await this.rules.snapshot(run.id, city.cityId, city.countryCode, eligibility);
      return;
    }
    outcome.eligibilitySnapshotId = await this.rules.snapshot(run.id, city.cityId, city.countryCode, eligibility);

    const hubCode = city.metroCode ?? city.airports[0].iata;
    const useDemo = prefs.demoFixture === true;

    for (const stayDays of stayVariants) {
      if (Date.now() - (run.startedAt ? new Date(run.startedAt).getTime() : 0) > SEARCH_BUDGET.softTimeoutMs) return;
      try {
        // 2) 第一段：A → H（出发日）
        consumeSearch();
        const leg1 = await this.safeSearch(
          { origin: run.originCode, destination: hubCode, departDate: this.isoDate(run.departureDate), currency: 'SGD' },
          useDemo,
        );
        const leg1Best = this.bestBookable(leg1.offers);
        if (!leg1Best) {
          outcome.status = 'NO_INVENTORY';
          outcome.reasonCodes = ['NO_SANDBOX_INVENTORY_LEG_1'];
          continue;
        }

        // 3) 第二段：H → B（出发日 + 停留天数）
        consumeSearch();
        const leg2Date = this.isoDate(this.addDays(run.departureDate, stayDays));
        const leg2 = await this.safeSearch(
          { origin: hubCode, destination: run.destinationCode, departDate: leg2Date, currency: 'SGD' },
          useDemo,
        );
        const leg2Best = this.bestBookable(leg2.offers);
        if (!leg2Best) {
          outcome.status = 'NO_INVENTORY';
          outcome.reasonCodes = ['NO_SANDBOX_INVENTORY_LEG_2'];
          continue;
        }

        // 4) 组合剪枝：第二段到达不得早于第一段到达（停留天数为正天然满足，仍显式校验）
        if (new Date(leg2Best.departureAt) <= new Date(leg1Best.arrivalAt)) {
          outcome.status = 'EXPERIENCE_REJECTED';
          outcome.reasonCodes = ['CONNECTION_TIME_INVALID'];
          continue;
        }

        // 5) 全成本与评分
        const directSnap = await this.prisma.flightOfferSnapshot.findFirst({
          where: { searchRunId: run.id, role: 'DIRECT_BASELINE' },
        });
        const airfareTotal = round2(leg1Best.totalPrice + leg2Best.totalPrice);
        const directTotal = directSnap?.totalPrice ?? null;
        const delta = directTotal !== null ? round2(airfareTotal - directTotal) : 0;

        // 体验淘汰：航空增量超过用户预算过多
        if (run.maxAirfareDelta !== null && delta > run.maxAirfareDelta * 1.5) {
          outcome.status = 'EXPERIENCE_REJECTED';
          outcome.reasonCodes = ['AIRFARE_DELTA_EXCEEDS_BUDGET'];
          continue;
        }
        // 红眼偏好淘汰
        if (prefs.acceptRedEye === false && (isRedEye(leg1Best.departureAt) || isRedEye(leg2Best.departureAt))) {
          outcome.status = 'EXPERIENCE_REJECTED';
          outcome.reasonCodes = ['RED_EYE_REJECTED'];
          continue;
        }

        const usableHours = Math.max(0, (new Date(leg2Best.departureAt).getTime() - new Date(leg1Best.arrivalAt).getTime()) / 3600_000 - 6); // 扣除往返机场缓冲
        const pack = CITY_PACKS[city.cityId];
        const interests: string[] = prefs.interests || [];
        const interestMatch = interests.length ? Math.min(1, 0.6 + 0.2 * interests.length) : 0.7;

        const costBreakdown = buildCostBreakdown({
          leg1Price: leg1Best.totalPrice,
          leg2Price: leg2Best.totalPrice,
          currency: leg1Best.currency,
          stayDays,
          cityId: city.cityId,
          providerLabel: leg1.label,
        });

        const joy = buildJoyScore({
          directBaselinePrice: directTotal,
          airfareTotal,
          maxAirfareDelta: run.maxAirfareDelta,
          usableHours,
          stayDays,
          redEyeSegments: (isRedEye(leg1Best.departureAt) ? 1 : 0) + (isRedEye(leg2Best.departureAt) ? 1 : 0),
          airportChanges: leg1Best.destination !== leg2Best.origin ? 1 : 0,
          departureHourLocal: new Date(leg1Best.departureAt).getUTCHours(),
          arrivalHourLocal: new Date(leg2Best.arrivalAt).getUTCHours(),
          interestsMatched: interestMatch,
          isSimulated: leg1.label !== 'ATLAS_SANDBOX' || true,
        });

        const leg1SnapId = await this.saveOffer(run.id, 1, 'LEG_1', city.cityId, leg1Best, leg1.label);
        const leg2SnapId = await this.saveOffer(run.id, 2, 'LEG_2', city.cityId, leg2Best, leg2.label);
        // 两段来源可能不同（如一段真实一段回退）：按腿聚合，不一致时诚实标记 MIXED。
        const aggregatedProvider = leg1.label === leg2.label ? leg1.label : 'MIXED';

        await this.prisma.stopoverPlan.create({
          data: {
            searchRunId: run.id,
            planType: 'STOPOVER',
            stopoverCityId: city.cityId,
            hubAirport: hubCode,
            hubCountry: city.countryCode,
            stayDays,
            legOfferIdsJson: [leg1SnapId, leg2SnapId] as any,
            baselineDirectOfferSnapshotId: directSnap?.id ?? null,
            airfareTotal,
            airfareDelta: delta,
            currency: leg1Best.currency,
            costBreakdownJson: costBreakdown as any,
            joyScore: joy.total,
            joyScoreBreakdownJson: joy.components as any,
            usableHours: round2(usableHours),
            riskLevel: stayDays >= 3 ? 'LOW' : 'MEDIUM',
            riskFlagsJson: ['SEPARATE_TICKETS', 'RECHECK_BAGGAGE'] as any,
            eligibilitySnapshotId: outcome.eligibilitySnapshotId,
            sourceProvider: aggregatedProvider,
            isSimulated: true,
          },
        });

        outcome.status = 'COMPLETED';
        outcome.reasonCodes = ['ELIGIBLE', 'PLAN_GENERATED'];
        return; // 该城市已成功产出方案
      } catch (e) {
        const code = (e as AppError).code;
        outcome.status = code === 'NO_SANDBOX_INVENTORY' ? 'NO_INVENTORY' : 'FAILED';
        outcome.reasonCodes = [code || 'SEARCH_FAILED'];
        outcome.error = (e as Error).message;
        return;
      }
    }
  }
}

export function isRedEye(iso: string): boolean {
  const h = new Date(iso).getUTCHours();
  return h >= 23 || h < 5;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 全成本拆分：区分 CONFIRMED、SANDBOX、ESTIMATE、RULE_BASED、USER_BUDGET、UNKNOWN。 */
export function buildCostBreakdown(input: {
  leg1Price: number;
  leg2Price: number;
  currency: string;
  stayDays: number;
  cityId: string;
  providerLabel: string;
}) {
  const fareType = input.providerLabel === 'ATLAS_SANDBOX' ? 'SANDBOX' : input.providerLabel === 'ATLAS_PRODUCTION' ? 'CONFIRMED' : 'SANDBOX';
  const hotelPerNight = 60;
  const items = [
    { key: 'LEG_1_AIRFARE', amount: input.leg1Price, confidence: fareType, note: 'Atlas 航段 1' },
    { key: 'LEG_2_AIRFARE', amount: input.leg2Price, confidence: fareType, note: 'Atlas 航段 2' },
    { key: 'BAGGAGE_FEES', amount: 0, confidence: 'UNKNOWN', note: '行李费用以验价后为准' },
    { key: 'HOTEL', amount: hotelPerNight * Math.max(1, input.stayDays - 1), confidence: 'ESTIMATE', note: `约 ${hotelPerNight} ${input.currency}/晚，建议信息` },
    { key: 'AIRPORT_TRANSFER', amount: 20, confidence: 'ESTIMATE', note: '机场往返市区' },
    { key: 'VISA_FEE', amount: 0, confidence: 'RULE_BASED', note: '以入境规则为准' },
    { key: 'ACTIVITIES_FOOD', amount: 40 * input.stayDays, confidence: 'USER_BUDGET', note: '活动与餐饮预算' },
  ];
  const total = round2(items.reduce((s, i) => s + i.amount, 0));
  return { currency: input.currency, items, total };
}
