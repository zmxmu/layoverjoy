import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SearchOrchestrator } from './search.orchestrator';
import { AtlasService } from '../atlas/atlas.service';
import { resolveLocation } from '../airports/catalog';
import { AppError } from '../common/errors';

export interface SearchRequestInput {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  minStopDays?: number;
  maxStopDays?: number;
  maxAirfareDelta?: number;
  preferences?: {
    interests?: string[];
    acceptRedEye?: boolean;
    airlines?: string[];
    demoFixture?: boolean; // 用户显式选择“查看演示方案”
  };
}

/** 搜索任务服务：校验输入、创建 SearchRun、异步触发编排。 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger('SearchService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: SearchOrchestrator,
    private readonly atlas: AtlasService,
  ) {}

  async create(userId: string, input: SearchRequestInput) {
    const missing: string[] = [];
    if (!input.origin) missing.push('origin');
    if (!input.destination) missing.push('destination');
    if (!input.departureDate) missing.push('departureDate');
    if (missing.length) throw AppError.validation(missing);

    const originLoc = resolveLocation(input.origin);
    const destLoc = resolveLocation(input.destination);
    if (!originLoc) throw new AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input: input.origin });
    if (!destLoc) throw new AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input: input.destination });

    const departure = new Date(`${input.departureDate}T00:00:00Z`);
    if (Number.isNaN(departure.getTime())) throw AppError.validation(['departureDate'], '出发日期格式不正确。');
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (departure < today) throw AppError.validation(['departureDate'], '出发日期不能早于今天。');

    const minStop = Math.max(1, Math.min(input.minStopDays ?? 2, 7));
    const maxStop = Math.max(minStop, Math.min(input.maxStopDays ?? minStop, 7));

    const run = await this.prisma.searchRun.create({
      data: {
        userId,
        originInput: input.origin,
        destinationInput: input.destination,
        originCode: originLoc.searchCode,
        destinationCode: destLoc.searchCode,
        departureDate: departure,
        minStopDays: minStop,
        maxStopDays: maxStop,
        maxAirfareDelta: input.maxAirfareDelta ?? null,
        preferencesJson: (input.preferences ?? {}) as any,
        providerMode: this.atlas.searchProviderLabel(),
      },
    });

    // 异步编排：不阻塞响应。失败只写入 SearchRun 状态。
    void this.orchestrator.run(run.id, input.preferences?.demoFixture === true).catch((e) => {
      this.logger.error(`orchestrator crash for ${run.id}: ${(e as Error).message}`);
    });

    return { searchRunId: run.id, status: 'PENDING' };
  }

  async getStatus(userId: string, searchRunId: string) {
    const run = await this.prisma.searchRun.findFirst({ where: { id: searchRunId, userId } });
    if (!run) throw AppError.notFound('搜索任务');
    return {
      searchRunId: run.id,
      status: run.status,
      resultStatus: run.resultStatus,
      providerMode: run.providerMode,
      funnel: run.funnelJson ?? [],
      counts: {
        candidates: run.candidateCount,
        eligibilityRejected: run.eligibilityRejectedCount,
        experienceRejected: run.experienceRejectedCount,
        keptPlans: run.keptPlanCount,
      },
      error: run.errorJson ?? null,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
    };
  }

  /** 结果页：直飞基准 + 按 JoyScore 排序的 Stopover 方案。 */
  async getPlans(userId: string, searchRunId: string) {
    const run = await this.prisma.searchRun.findFirst({ where: { id: searchRunId, userId } });
    if (!run) throw AppError.notFound('搜索任务');

    const offers = await this.prisma.flightOfferSnapshot.findMany({
      where: { searchRunId: run.id },
      orderBy: { capturedAt: 'asc' },
    });
    const plans = await this.prisma.stopoverPlan.findMany({
      where: { searchRunId: run.id, status: 'ACTIVE' },
      orderBy: { joyScore: 'desc' },
    });
    const eligibilitySnaps = await this.prisma.eligibilitySnapshot.findMany({ where: { searchRunId: run.id } });

    const offerMap = new Map<string, (typeof offers)[number]>(offers.map((o) => [o.id, o]));
    const offerDto = (id: string | null | undefined) => {
      if (!id) return null;
      const o = offerMap.get(id);
      if (!o) return null;
      return {
        snapshotId: o.id,
        legNo: o.legNo,
        role: o.role,
        origin: o.origin,
        destination: o.destination,
        departureAt: o.departureAt.toISOString(),
        arrivalAt: o.arrivalAt.toISOString(),
        carrier: o.carrier,
        flightNumber: o.flightNumber,
        currency: o.currency,
        totalPrice: o.totalPrice,
        priceStatus: o.priceStatus,
        isSimulated: o.isSimulated,
        sourceProvider: o.sourceProvider,
        providerOfferId: o.providerOfferId,
      };
    };

    const directOffer = offers.find((o) => o.role === 'DIRECT_BASELINE');
    const directPlan = {
      planType: 'DIRECT',
      offer: offerDto(directOffer?.id ?? null),
    };

    return {
      searchRunId: run.id,
      status: run.status,
      resultStatus: run.resultStatus,
      providerMode: run.providerMode,
      directBaseline: directPlan,
      plans: plans.map((p) => ({
        planId: p.id,
        planType: p.planType,
        stopoverCityId: p.stopoverCityId,
        hubAirport: p.hubAirport,
        stayDays: p.stayDays,
        legs: ((p.legOfferIdsJson as string[]) ?? []).map((id) => offerDto(id)),
        airfareTotal: p.airfareTotal,
        airfareDelta: p.airfareDelta,
        currency: p.currency,
        costBreakdown: p.costBreakdownJson,
        joyScore: p.joyScore,
        joyScoreBreakdown: p.joyScoreBreakdownJson,
        usableHours: p.usableHours,
        riskLevel: p.riskLevel,
        riskFlags: p.riskFlagsJson ?? [],
        sourceProvider: p.sourceProvider,
        isSimulated: p.isSimulated,
      })),
      funnel: run.funnelJson ?? [],
      eligibility: eligibilitySnaps.map((s) => ({
        cityId: s.cityId,
        status: s.status,
        ruleId: s.ruleId,
        ruleVersion: s.ruleVersion,
        reasonCodes: s.reasonCodesJson ?? [],
        sourceUrl: s.sourceUrl,
        verifiedAt: s.verifiedAt,
      })),
      counts: {
        candidates: run.candidateCount,
        eligibilityRejected: run.eligibilityRejectedCount,
        experienceRejected: run.experienceRejectedCount,
        keptPlans: run.keptPlanCount,
      },
    };
  }
}
