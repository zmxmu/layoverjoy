import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AtlasService } from '../atlas/atlas.service';
import { EntryRulesService } from '../entry-rules/entry-rules.service';
import { UsersService } from '../users/users.service';
import { CITY_PACKS, CityEntry, rankHubsForRoute, resolveLocation, resolveSelection } from '../airports/catalog';
import { EligibilityAssessService } from '../entry-rules/v2/assess.service';
import { buildJoyScore } from '../plans/joy-score';
import { AppError } from '../common/errors';
import { FlightOffer } from '../atlas/atlas.types';
import { loadEnv } from '../config/env';
import { FIELD_CRYPTO } from '../core.module';
import { FieldCrypto } from '../common/crypto';

/**
 * 搜索编排器。预算契约：
 * 候选 Hub 面向全目录按航线绕飞度动态排序，评估上限 8；每 Hub 停留天数 ≤2；
 * Atlas Search ≤30、并发 3、单请求超时 8s（Provider 内）、软超时 40s、硬超时 60s、缓存 15min。
 * （已从黑客松期的固定三城/10 次调用预算升级为生产级全球候选评估。）
 */
export const SEARCH_BUDGET = {
  maxHubs: 8,
  maxStayVariantsPerHub: 2,
  maxSearchCalls: 30,
  concurrency: 3,
  softTimeoutMs: 40_000,
  hardTimeoutMs: 60_000,
};

interface CandidateOutcome {
  city: CityEntry;
  status: 'ELIGIBLE' | 'NEEDS_INFO' | 'NEEDS_REVIEW' | 'INELIGIBLE' | 'NO_INVENTORY' | 'FAILED' | 'EXPERIENCE_REJECTED' | 'COMPLETED';
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
    private readonly assessV2: EligibilityAssessService,
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
      // 全球候选：按本次航线绕飞度动态排序（不再固化亚洲热门三城）；坐标缺失时退回热门榜单。
      const originCityId = prefs.originLocation?.cityId ?? resolveLocation(run.originInput)?.cityId ?? null;
      const destCityId = prefs.destinationLocation?.cityId ?? resolveLocation(run.destinationInput)?.cityId ?? null;
      const hubs = rankHubsForRoute(originCityId, destCityId, exclude, SEARCH_BUDGET.maxHubs);

      const outcomes: CandidateOutcome[] = [];
      let searchCalls = 0;
      let softTimedOut = false;

      // 1) 直飞基准（预算内受控组合搜索，多机场端点空库存时展开）
      const originCodes = this.endpointCodes(run, 'origin');
      const destCodes = this.endpointCodes(run, 'destination');
      const direct = await this.searchFirstBookable(
        originCodes,
        destCodes,
        this.isoDate(run.departureDate),
        useDemoFixtureFallback,
        () => (searchCalls += 1),
        3,
      );
      const directBest = direct.best;
      let directSnapshotId: string | null = null;
      if (directBest) {
        directSnapshotId = await this.saveOffer(run.id, 1, 'DIRECT_BASELINE', null, directBest, direct.label);
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
    // 过期报价不得继续 Verify/Order/Pay（AGENTS.md §8）：选择前先过滤有效期。
    const bookable = offers.filter(
      (o) => o.priceStatus === 'current' && o.bookable && (!o.expiresAt || new Date(o.expiresAt).getTime() > Date.now()),
    );
    if (!bookable.length) return null;
    return [...bookable].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  }

  /** 端点搜索码：AIRPORT→指定机场；ALL_AIRPORTS→[城市码/默认机场, …受控展开≤3]。 */
  private endpointCodes(run: any, side: 'origin' | 'destination'): string[] {
    const prefs: any = run.preferencesJson ?? {};
    const sel = side === 'origin' ? prefs.originLocation : prefs.destinationLocation;
    if (sel?.cityId) {
      const r = resolveSelection(sel);
      if (r.ok) {
        return r.value.mode === 'AIRPORT' ? [r.value.primaryCode] : [r.value.primaryCode, ...r.value.expansionCodes.filter((c) => c !== r.value.primaryCode)];
      }
    }
    return [side === 'origin' ? run.originCode : run.destinationCode];
  }

  /**
   * 端点×端点受控组合搜索（12 号方案 §10.4）：先主码，空库存时按目录展开机场（单端≤3），
   * 组合数受 maxPairs 与搜索预算双重限制；多机场展开属后端编排。
   */
  private async searchFirstBookable(
    aCodes: string[],
    bCodes: string[],
    departDate: string,
    useDemo: boolean,
    consume: () => number,
    maxPairs: number,
  ): Promise<{ best: FlightOffer | null; label: 'ATLAS_SANDBOX' | 'MOCK' }> {
    let label: 'ATLAS_SANDBOX' | 'MOCK' = this.atlas.searchProviderLabel();
    let pairs = 0;
    for (const a of aCodes) {
      for (const b of bCodes) {
        if (pairs >= maxPairs) return { best: null, label };
        if (consume() > SEARCH_BUDGET.maxSearchCalls) return { best: null, label };
        pairs += 1;
        const r = await this.safeSearch({ origin: a, destination: b, departDate, currency: 'SGD' }, useDemo);
        label = r.label;
        const best = this.bestBookable(r.offers);
        if (best) return { best, label };
      }
    }
    return { best: null, label };
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
        // 上游 expireTime 优先；无有效期的（Mock）保留 30 分钟兼容窗口。
        expiresAt: offer.expiresAt ? new Date(offer.expiresAt) : new Date(Date.now() + 30 * 60 * 1000),
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

  /** v2 评估快照：状态/规则/材料/来源/完整评估体一并落库，供结果页资格卡渲染。 */
  private async saveV2Snapshot(runId: string, city: CityEntry, a: any): Promise<string> {
    const snap = await this.prisma.eligibilitySnapshot.create({
      data: {
        searchRunId: runId,
        cityId: city.cityId,
        countryCode: city.countryCode,
        status: a.searchDecision,
        ruleId: a.matchedRuleIds[0] ?? null,
        ruleVersion: a.ruleSet?.schemaVersion ?? null,
        reasonCodesJson: a.missingFacts as any,
        requiredDocsJson: a.requirements as any,
        sourceUrl: a.sources?.[0]?.url ?? null,
        verifiedAt: a.sources?.[0]?.lastCheckedAt ?? null,
        assessmentJson: a as any,
      },
    });
    return snap.id;
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

    // 1) 资格预筛（v2 规则引擎，ER-10）：INELIGIBLE 不调用 Atlas；NEEDS_REVIEW 仅作探索候选不冒充可预订。
    const hubCode = city.metroCode ?? city.airports[0].iata;
    const jurisdiction = city.countryCode === 'HK' || city.countryCode === 'MO' ? city.countryCode : null;
    const stayDaysMax = Math.max(...stayVariants);
    const depISO = this.isoDate(run.departureDate);
    const backISO = this.isoDate(this.addDays(run.departureDate, stayDaysMax));
    const a = this.assessV2.assess(
      {
        userId: run.userId,
        mode: 'SEARCH',
        itinerary: {
          purpose: 'TOURISM',
          segments: [
            { from: run.originCode, to: hubCode, departureAt: `${depISO}T02:00:00Z`, arrivalAt: `${depISO}T10:00:00Z` },
            { from: hubCode, to: run.destinationCode, departureAt: `${backISO}T06:00:00Z`, arrivalAt: `${backISO}T17:00:00Z` },
          ],
          stopover: { country: city.countryCode, jurisdiction, airport: hubCode, stayHours: stayDaysMax * 24 },
          stayDays: stayDaysMax,
          arrivalDate: depISO,
        },
        traveler: { passport: profile.passport, documents: (profile as any).qualifyingDocuments ?? [], history: {} },
        documents: {},
      },
      { persist: false },
    );
    outcome.ruleId = a.matchedRuleIds[0];
    outcome.eligibilitySnapshotId = await this.saveV2Snapshot(run.id, city, a);
    if (a.searchDecision === 'INELIGIBLE' || a.searchDecision === 'NEEDS_INFO' || a.searchDecision === 'NEEDS_REVIEW') {
      outcome.status = a.searchDecision === 'INELIGIBLE' ? 'INELIGIBLE' : a.searchDecision === 'NEEDS_INFO' ? 'NEEDS_INFO' : 'NEEDS_REVIEW';
      outcome.reasonCodes = [...a.matchedRuleIds, ...a.missingFacts];
      return;
    }
    const useDemo = prefs.demoFixture === true;

    // 2) 第一段：A → H（出发日；多机场出发地受控展开）。
    //    第一段不依赖停留天数，每城只搜一次，各停留变体复用，把搜索预算留给更多候选城市。
    let leg1Best: FlightOffer | null = null;
    let leg1Label: 'ATLAS_SANDBOX' | 'MOCK' = this.atlas.searchProviderLabel();
    try {
      const leg1 = await this.searchFirstBookable(
        this.endpointCodes(run, 'origin'),
        [hubCode],
        this.isoDate(run.departureDate),
        useDemo,
        consumeSearch,
        3,
      );
      leg1Best = leg1.best;
      leg1Label = leg1.label;
    } catch (e) {
      const code = (e as AppError).code;
      outcome.status = code === 'NO_SANDBOX_INVENTORY' ? 'NO_INVENTORY' : 'FAILED';
      outcome.reasonCodes = [code || 'SEARCH_FAILED'];
      outcome.error = (e as Error).message;
      return;
    }
    if (!leg1Best) {
      outcome.status = 'NO_INVENTORY';
      outcome.reasonCodes = ['NO_SANDBOX_INVENTORY_LEG_1'];
      return;
    }

    for (const stayDays of stayVariants) {
      if (Date.now() - (run.startedAt ? new Date(run.startedAt).getTime() : 0) > SEARCH_BUDGET.softTimeoutMs) return;
      try {
        // 3) 第二段：H → B（出发日 + 停留天数；多机场目的地受控展开）
        const leg2Date = this.isoDate(this.addDays(run.departureDate, stayDays));
        const leg2 = await this.searchFirstBookable(
          [hubCode],
          this.endpointCodes(run, 'destination'),
          leg2Date,
          useDemo,
          consumeSearch,
          3,
        );
        const leg2Best = leg2.best;
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
          providerLabel: leg1Label,
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
          isSimulated: leg1Label !== 'ATLAS_SANDBOX' || true,
        });

        const leg1SnapId = await this.saveOffer(run.id, 1, 'LEG_1', city.cityId, leg1Best, leg1Label);
        const leg2SnapId = await this.saveOffer(run.id, 2, 'LEG_2', city.cityId, leg2Best, leg2.label);
        // 两段来源可能不同（如一段真实一段回退）：按腿聚合，不一致时诚实标记 MIXED。
        const aggregatedProvider = leg1Label === leg2.label ? leg1Label : 'MIXED';

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
