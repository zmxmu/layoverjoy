import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  HomeOpportunityResponse,
  OpportunityDetail,
  QuoteFreshness,
} from './home.types';

/**
 * 首页「我的最佳中转机会」只读服务（11-执行方案 §5.3）。
 * 只读取本地已落库的搜索结果：不调用 Atlas / Nosana / Daytona / SMTP，
 * 资格结论只取确定性规则引擎产生的 EligibilitySnapshot。
 */
@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async opportunity(userId: string): Promise<HomeOpportunityResponse> {
    const generatedAt = new Date().toISOString();

    // 1) 主护照：kind=PASSPORT、ACTIVE、未删除（优先 isPrimary）。
    const passport = await this.prisma.travelDocument.findFirst({
      where: { userId, kind: 'PASSPORT', status: 'ACTIVE', deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
    if (!passport) return { state: 'NEEDS_DOCUMENT', generatedAt };

    const [validVisaCount, run] = await Promise.all([
      this.prisma.travelDocument.count({
        where: {
          userId,
          kind: 'VISA',
          status: 'ACTIVE',
          deletedAt: null,
          OR: [{ expiresOn: null }, { expiresOn: { gt: new Date() } }],
        },
      }),
      this.latestRunWithPlans(userId),
    ]);

    const profile = {
      passportCountry: passport.countryCode,
      passportType: passport.passportType,
      validVisaCount,
    };
    if (!run) return { state: 'EMPTY', profile, generatedAt };

    // 4) 只保留 STOPOVER + ACTIVE + 资格 ELIGIBLE 的方案。
    const plans = await this.prisma.stopoverPlan.findMany({
      where: { searchRunId: run.id, planType: 'STOPOVER', status: 'ACTIVE' },
    });
    const snapshots = plans
      .map((p) => p.eligibilitySnapshotId)
      .filter((id): id is string => Boolean(id));
    const eligibilities = snapshots.length
      ? await this.prisma.eligibilitySnapshot.findMany({ where: { id: { in: snapshots } } })
      : [];
    const eligibleById = new Map(eligibilities.map((e) => [e.id, e]));
    const eligiblePlans = plans.filter((p) => {
      const e = p.eligibilitySnapshotId ? eligibleById.get(p.eligibilitySnapshotId) : undefined;
      return e?.status === 'ELIGIBLE';
    });
    if (!eligiblePlans.length) return { state: 'EMPTY', profile, generatedAt };

    // 5) joyScore DESC, usableHours DESC, airfareDelta ASC 取第一名（确定性排序，不经 LLM）。
    const best = [...eligiblePlans].sort(
      (a, b) => b.joyScore - a.joyScore || b.usableHours - a.usableHours || a.airfareDelta - b.airfareDelta,
    )[0];
    const eligibility = eligibleById.get(best.eligibilitySnapshotId!)!;

    // 6) 该 SearchRun 中 ELIGIBLE 的不同城市去重计数。
    const eligibleHubs = await this.prisma.eligibilitySnapshot.findMany({
      where: { searchRunId: run.id, status: 'ELIGIBLE' },
      select: { cityId: true },
      distinct: ['cityId'],
    });

    // 7) 直飞基准（缺失则差价不可用）。
    const directOffer = await this.prisma.flightOfferSnapshot.findFirst({
      where: { searchRunId: run.id, role: 'DIRECT_BASELINE' },
      orderBy: { capturedAt: 'desc' },
      select: { totalPrice: true, segmentsJson: true },
    });

    // 9) 报价过期时间：方案所含 Offer（含直飞基准）中最早的非空 expiresAt。
    const offerIds = [...((best.legOfferIdsJson as unknown as string[]) ?? [])];
    if (best.baselineDirectOfferSnapshotId) offerIds.push(best.baselineDirectOfferSnapshotId);
    const offers = offerIds.length
      ? await this.prisma.flightOfferSnapshot.findMany({
          where: { id: { in: offerIds } },
          select: { expiresAt: true },
        })
      : [];
    const expiries = offers.map((o) => o.expiresAt).filter((d): d is Date => Boolean(d));
    const quoteExpiresAt = expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : null;

    // 10) 新鲜度：过期→STALE；无过期信息→UNKNOWN（不得显示"实时"）。
    const quoteFreshness: QuoteFreshness = quoteExpiresAt
      ? quoteExpiresAt.getTime() < Date.now()
        ? 'STALE'
        : 'CURRENT'
      : 'UNKNOWN';

    // 8) 全成本估算：只读 costBreakdownJson.total，没有就是 null。
    const costTotal = (best.costBreakdownJson as Record<string, unknown> | null)?.total;

    const opportunity: OpportunityDetail = {
      planId: best.id,
      searchRunId: run.id,
      origin: run.originCode,
      hub: best.hubAirport ?? best.stopoverCityId ?? '',
      destination: run.destinationCode,
      stayDays: best.stayDays,
      usableHours: best.usableHours,
      currency: best.currency,
      airfareTotal: best.airfareTotal,
      directAirfare: directOffer ? directOffer.totalPrice : null,
      // 基准语义：1=nonstop，>1=best flight baseline，0=未知（UI 不得宣称直飞）。
      directSegmentsCount: directOffer && Array.isArray(directOffer.segmentsJson)
        ? (directOffer.segmentsJson as unknown[]).length
        : 0,
      airfareDelta: directOffer ? best.airfareDelta : null,
      estimatedTripTotal: typeof costTotal === 'number' ? costTotal : null,
      joyScore: best.joyScore,
      eligibility: {
        status: eligibility.status,
        ruleId: eligibility.ruleId,
        ruleVersion: eligibility.ruleVersion,
      },
      sourceProvider: best.sourceProvider,
      isSimulated: best.isSimulated,
      quoteFreshness,
      quoteExpiresAt: quoteExpiresAt?.toISOString() ?? null,
    };

    return {
      state: quoteFreshness === 'STALE' ? 'STALE' : 'READY',
      profile,
      eligibleHubCount: eligibleHubs.length,
      opportunity,
      generatedAt,
    };
  }

  /** 3) 最近一个 COMPLETED/PARTIAL 且至少有一个方案的 SearchRun（有界查询，避免全表扫描）。 */
  private async latestRunWithPlans(userId: string) {
    const runs = await this.prisma.searchRun.findMany({
      where: { userId, status: { in: ['COMPLETED', 'PARTIAL'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { plans: { select: { id: true }, take: 1 } },
    });
    return runs.find((r) => r.plans.length > 0) ?? null;
  }
}
