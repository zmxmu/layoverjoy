import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { NosanaService } from '../explanations/nosana.service';
import { buildExperienceContext, EXPERIENCE_CATALOG_VERSION, PROMPT_VERSION } from '../explanations/experience-context.builder';
import { CITY_PACKS, HUB_CATALOG } from '../airports/catalog';
import { AppError } from '../common/errors';

/** 语言参数归一化：仅接受 en，其余一律 zh。 */
export function normLang(lang?: string): 'zh' | 'en' {
  return lang === 'en' ? 'en' : 'zh';
}

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
    return c ? { cityId: c.cityId, cityNameZh: c.cityNameZh, cityNameEn: c.cityNameEn, countryCode: c.countryCode, timezone: c.timezone } : null;
  }

  async getPlan(userId: string, planId: string, lang: 'zh' | 'en' = 'zh') {
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
            requiredDocuments: ((eligibility.requiredDocsJson as any[]) ?? []).map((r: any) =>
              typeof r === 'string' ? r : (r?.descriptionZh ?? r?.code ?? JSON.stringify(r)),
            ),
            sourceUrl: eligibility.sourceUrl,
            verifiedAt: eligibility.verifiedAt,
            assessment: eligibility.assessmentJson ?? null,
          }
        : null,
      // 净体验窗口与转机便利度：确定性计算，详情页唯一展示位置（14 号方案 §4）。
      experienceContext: this.buildExperiencePreview(plan, offers, eligibility?.status ?? null),
      cityPack: pack
        ? {
            attractions: lang === 'en' ? pack.attractionsEn : pack.attractions,
            areas: lang === 'en' ? pack.areasEn : pack.areas,
            tips: lang === 'en' ? pack.tipsEn : pack.tips,
            airportToCity: lang === 'en' ? pack.airportToCityEn : pack.airportToCityZh,
            suggestedDays: pack.suggestedDays,
          }
        : null,
      explanation: explanation
        ? { provider: explanation.provider, modelId: explanation.modelId, payload: explanation.payloadJson }
        : null,
    };
  }

  /** 生成并保存解释。Nosana 失败时自动降级为模板解释；缓存按语言失效。 */
  /** 详情页顶部一次性体验窗口 + 便利度（无模型参与）。 */
  private buildExperiencePreview(plan: any, offers: any[], eligibilityStatus: string | null) {
    if (!plan?.stopoverCityId || offers.length < 2) return null;
    const city = this.cityOf(plan.stopoverCityId);
    const leg = (o: any) => ({ origin: o.origin, destination: o.destination, departureAt: new Date(o.departureAt).toISOString(), arrivalAt: new Date(o.arrivalAt).toISOString() });
    try {
      const ctx = buildExperienceContext({
        cityId: plan.stopoverCityId,
        cityNameZh: city?.cityNameZh ?? plan.stopoverCityId,
        cityNameEn: city?.cityNameEn ?? plan.stopoverCityId,
        timeZone: city?.timezone ?? 'UTC',
        leg1: leg(offers[0]),
        leg2: leg(offers[1]),
        riskFlags: (plan.riskFlagsJson as string[]) ?? [],
        interests: [],
        airfareDelta: plan.airfareDelta,
        currency: plan.currency,
        eligibilityStatus,
      });
      return {
        windowLabelZh: ctx.schedule.experienceWindowLabelZh,
        windowLabelEn: ctx.schedule.experienceWindowLabelEn,
        budgetNoteZh: ctx.schedule.budgetNoteZh,
        budgetNoteEn: ctx.schedule.budgetNoteEn,
        confidence: ctx.schedule.confidence,
        sameAirport: ctx.schedule.sameAirport,
        easeScore: ctx.ease.score,
        easeLevel: ctx.ease.level,
      };
    } catch {
      return null;
    }
  }

  /** v2 丰富解读（14 号方案）：缓存键 = plan+lang+行程+兴趣+pace+资料版本+prompt版本。 */
  async explain(userId: string, planId: string, lang: 'zh' | 'en' = 'zh') {
    const plan = await this.prisma.stopoverPlan.findFirst({
      where: { id: planId, searchRun: { userId } },
    });
    if (!plan) throw AppError.notFound('方案');

    const city = this.cityOf(plan.stopoverCityId);
    const run = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
    const prefs: any = run?.preferencesJson ?? {};
    const interests: string[] = prefs.interests ?? [];
    const pace: string = prefs.pace ?? 'BALANCED';
    const offers = await this.prisma.flightOfferSnapshot.findMany({
      where: { id: { in: (plan.legOfferIdsJson as string[]) ?? [] } },
      orderBy: { legNo: 'asc' },
    });
    if (offers.length < 2) throw AppError.notFound('航段');
    const eligibility = plan.eligibilitySnapshotId
      ? await this.prisma.eligibilitySnapshot.findUnique({ where: { id: plan.eligibilitySnapshotId } })
      : null;
    const leg = (o: any) => ({ origin: o.origin, destination: o.destination, departureAt: new Date(o.departureAt).toISOString(), arrivalAt: new Date(o.arrivalAt).toISOString() });

    const ctx = buildExperienceContext({
      cityId: plan.stopoverCityId!,
      cityNameZh: city?.cityNameZh ?? plan.stopoverCityId!,
      cityNameEn: city?.cityNameEn ?? plan.stopoverCityId!,
      timeZone: city?.timezone ?? 'UTC',
      leg1: leg(offers[0]),
      leg2: leg(offers[1]),
      riskFlags: (plan.riskFlagsJson as string[]) ?? [],
      interests,
      airfareDelta: plan.airfareDelta,
      currency: plan.currency,
      eligibilityStatus: eligibility?.status ?? null,
    });

    const itineraryPart = offers.map((o) => `${o.origin}${o.destination}${o.departureAt}${o.arrivalAt}`).join('~');
    const cacheKey = createHash('sha256')
      .update([planId, lang, itineraryPart, [...interests].sort().join(','), pace, EXPERIENCE_CATALOG_VERSION, PROMPT_VERSION].join('|'))
      .digest('hex')
      .slice(0, 24);

    const existing = await this.prisma.planExplanation.findUnique({ where: { planId: plan.id } });
    if (existing && (existing.payloadJson as any)?.cacheKey === cacheKey) {
      return { provider: existing.provider, modelId: 'internal-debug-only', payload: existing.payloadJson };
    }

    const rich = await this.nosana.explainRich(cacheKey, ctx, lang);
    const payload = {
      ...rich.narrative,
      context: {
        city: ctx.city,
        schedule: ctx.schedule,
        ease: ctx.ease,
        matchedInterests: ctx.matchedInterests,
        fareTradeoffBand: ctx.fareTradeoffBand,
        eligibilityDisplayStatus: ctx.eligibilityDisplayStatus,
      },
      debugMeta: rich.debugMeta,
      cacheKey,
      // v1 兼容字段（旧客户端一个版本）
      summary: rich.narrative.summary,
      highlights: rich.narrative.cityAdvantages.map((a) => a.title),
      tips: [rich.narrative.practicalTip],
      provider: rich.provider,
    } as any;

    await this.prisma.planExplanation.upsert({
      where: { planId: plan.id },
      create: { planId: plan.id, provider: rich.provider, modelId: 'internal-debug-only', payloadJson: payload },
      update: { provider: rich.provider, modelId: 'internal-debug-only', payloadJson: payload },
    });
    return { provider: rich.provider, modelId: 'internal-debug-only', payload };
  }
}
