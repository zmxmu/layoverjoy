import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NosanaService } from '../explanations/nosana.service';
import { CITY_PACKS, HUB_CATALOG } from '../airports/catalog';
import { AppError } from '../common/errors';

/** 方案详情与解释服务。解释结果落库为不可变快照。 */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nosana: NosanaService,
  ) {}

  private cityOf(cityId: string | null) {
    if (!cityId) return null;
    const c = HUB_CATALOG.find((x) => x.cityId === cityId);
    return c ? { cityId: c.cityId, cityNameZh: c.cityNameZh, cityNameEn: c.cityNameEn, countryCode: c.countryCode } : null;
  }

  async getPlan(userId: string, planId: string) {
    const plan = await this.prisma.stopoverPlan.findFirst({
      where: { id: planId, searchRun: { userId } },
    });
    if (!plan) throw AppError.notFound('方案');

    const legIds = (plan.legOfferIdsJson as string[]) ?? [];
    const offers = await this.prisma.flightOfferSnapshot.findMany({ where: { id: { in: legIds } } });
    const offerMap = new Map<string, (typeof offers)[number]>(offers.map((o) => [o.id, o]));
    const eligibility = plan.eligibilitySnapshotId
      ? await this.prisma.eligibilitySnapshot.findUnique({ where: { id: plan.eligibilitySnapshotId } })
      : null;
    const explanation = await this.prisma.planExplanation.findUnique({ where: { planId: plan.id } });
    const city = this.cityOf(plan.stopoverCityId);
    const pack = plan.stopoverCityId ? CITY_PACKS[plan.stopoverCityId] : undefined;

    return {
      planId: plan.id,
      searchRunId: plan.searchRunId,
      planType: plan.planType,
      stopoverCity: city,
      hubAirport: plan.hubAirport,
      stayDays: plan.stayDays,
      legs: legIds
        .map((id) => offerMap.get(id))
        .filter(Boolean)
        .map((o) => ({
          snapshotId: o!.id,
          legNo: o!.legNo,
          origin: o!.origin,
          destination: o!.destination,
          departureAt: o!.departureAt.toISOString(),
          arrivalAt: o!.arrivalAt.toISOString(),
          carrier: o!.carrier,
          flightNumber: o!.flightNumber,
          currency: o!.currency,
          totalPrice: o!.totalPrice,
          isSimulated: o!.isSimulated,
          sourceProvider: o!.sourceProvider,
          providerOfferId: o!.providerOfferId,
        })),
      airfareTotal: plan.airfareTotal,
      airfareDelta: plan.airfareDelta,
      currency: plan.currency,
      costBreakdown: plan.costBreakdownJson,
      joyScore: plan.joyScore,
      joyScoreBreakdown: plan.joyScoreBreakdownJson,
      usableHours: plan.usableHours,
      riskLevel: plan.riskLevel,
      riskFlags: plan.riskFlagsJson ?? [],
      isSimulated: plan.isSimulated,
      eligibility: eligibility
        ? {
            status: eligibility.status,
            ruleId: eligibility.ruleId,
            ruleVersion: eligibility.ruleVersion,
            reasonCodes: eligibility.reasonCodesJson ?? [],
            requiredDocuments: eligibility.requiredDocsJson ?? [],
            sourceUrl: eligibility.sourceUrl,
            verifiedAt: eligibility.verifiedAt,
          }
        : null,
      cityPack: pack
        ? { attractions: pack.attractions, areas: pack.areas, tips: pack.tips, airportToCityZh: pack.airportToCityZh, suggestedDays: pack.suggestedDays }
        : null,
      explanation: explanation
        ? { provider: explanation.provider, modelId: explanation.modelId, payload: explanation.payloadJson }
        : null,
    };
  }

  /** 生成并保存解释。Nosana 失败时自动降级为模板解释。 */
  async explain(userId: string, planId: string) {
    const plan = await this.prisma.stopoverPlan.findFirst({
      where: { id: planId, searchRun: { userId } },
    });
    if (!plan) throw AppError.notFound('方案');

    const existing = await this.prisma.planExplanation.findUnique({ where: { planId: plan.id } });
    if (existing && existing.provider === 'NOSANA') {
      return { provider: existing.provider, modelId: existing.modelId, payload: existing.payloadJson };
    }

    const city = this.cityOf(plan.stopoverCityId);
    const run = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
    const prefs: any = run?.preferencesJson ?? {};
    const result = await this.nosana.explain({
      cityNameZh: city?.cityNameZh ?? plan.stopoverCityId ?? '中转城市',
      stayDays: plan.stayDays,
      usableHours: plan.usableHours,
      airfareDelta: plan.airfareDelta,
      currency: plan.currency,
      joyScore: plan.joyScore,
      joyScoreBreakdown: plan.joyScoreBreakdownJson,
      riskFlags: (plan.riskFlagsJson as string[]) ?? [],
      interests: prefs.interests ?? [],
    });

    const saved = await this.prisma.planExplanation.upsert({
      where: { planId: plan.id },
      create: { planId: plan.id, provider: result.provider, modelId: result.modelId, payloadJson: result as any },
      update: { provider: result.provider, modelId: result.modelId, payloadJson: result as any },
    });
    return { provider: saved.provider, modelId: saved.modelId, payload: saved.payloadJson };
  }
}
