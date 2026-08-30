import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { NosanaService } from '../explanations/nosana.service';
import { buildExperienceContext, EXPERIENCE_CATALOG_VERSION, PROMPT_VERSION } from '../explanations/experience-context.builder';
import { CITY_PACKS, HUB_CATALOG } from '../airports/catalog';
import { AppError } from '../common/errors';
import { REQUIREMENT_EN } from '../entry-rules/v2/requirement-text';

export interface RequiredDocumentOut {
  code: string;
  mandatory: boolean;
  descriptionZh: string | null;
  descriptionEn: string | null;
  factPaths: string[];
}

/** 已知证件/材料代码的双语名称（旧引擎字符串与 v2 对象共用）。 */
export const REQUIRED_DOC_I18N: Record<string, { zh: string; en: string }> = {
  PASSPORT_VALID_6_MONTHS: { zh: '护照剩余有效期至少六个月', en: 'Passport valid for at least six months' },
  MDAC: { zh: '按要求提交马来西亚数字入境卡（MDAC）', en: 'Submit the Malaysia Digital Arrival Card (MDAC) as required' },
  ONWARD_TICKET: { zh: '持返程或续程机票', en: 'Hold a return or onward ticket' },
  CONFIRMED_ONWARD_TICKET: { zh: '持已确认的续程机票', en: 'Hold a confirmed onward ticket' },
  ACCOMMODATION_OR_ADDRESS: { zh: '准备住宿证明或地址申报', en: 'Provide accommodation or address declaration' },
  ACCOMMODATION_OR_INVITATION: { zh: '准备住宿、邀请或访问目的证明', en: 'Provide accommodation, invitation or purpose proof' },
  SUFFICIENT_FUNDS_DECLARATION: { zh: '足够资金申报', en: 'Sufficient funds declaration' },
  SUFFICIENT_FUNDS: { zh: '按入境要求准备足够旅行资金', en: 'Prepare sufficient travel funds' },
  PH_TRANSIT_VISA: { zh: '以菲律宾第三国过境须预先取得过境签证', en: 'Philippines transit visa required for third-country transit' },
};

const docLogger = new Logger('RequiredDocuments');

/**
 * 统一 requiredDocuments 输出契约：对象数组。
 * 兼容旧快照（字符串数组）与 v2 快照（对象数组）；单条异常跳过并记录脱敏 warning，
 * 不得导致整个方案详情接口失败。
 */
export function normalizeRequiredDocuments(raw: any): RequiredDocumentOut[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    docLogger.warn(`requiredDocuments: unexpected type ${typeof raw}; normalized to []`);
    return [];
  }
  const out: RequiredDocumentOut[] = [];
  raw.forEach((item: any, idx: number) => {
    try {
      if (typeof item === 'string' && item.trim()) {
        const code = item.trim();
        out.push({
          code,
          mandatory: true,
          descriptionZh: REQUIRED_DOC_I18N[code]?.zh ?? null,
          descriptionEn: REQUIRED_DOC_I18N[code]?.en ?? REQUIREMENT_EN[code] ?? null,
          factPaths: [],
        });
        return;
      }
      if (item && typeof item === 'object' && typeof item.code === 'string' && item.code.trim()) {
        const code = item.code.trim();
        const factPaths = Array.isArray(item.factPaths) ? item.factPaths.filter((p: any) => typeof p === 'string') : [];
        out.push({
          code,
          mandatory: item.mandatory === false ? false : true,
          descriptionZh: typeof item.descriptionZh === 'string' ? item.descriptionZh : (REQUIRED_DOC_I18N[code]?.zh ?? null),
          descriptionEn: typeof item.descriptionEn === 'string' ? item.descriptionEn : (REQUIRED_DOC_I18N[code]?.en ?? REQUIREMENT_EN[code] ?? null),
          factPaths,
        });
        return;
      }
      docLogger.warn(`requiredDocuments[${idx}]: invalid item type ${item === null ? 'null' : typeof item}; skipped`);
    } catch (e) {
      docLogger.warn(`requiredDocuments[${idx}]: normalize failed (${(e as Error).name}); skipped`);
    }
  });
  return out;
}

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
            requiredDocuments: normalizeRequiredDocuments(eligibility.requiredDocsJson),
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

  /**
   * 方案 → 确定性体验上下文（非流式解释与流式 AI 推荐共用）。
   * 资格结论在这里取自 eligibilitySnapshot（本地确定性规则引擎的落库结果），
   * AI 只能解释这个结论，不参与裁决。
   */
  async planExperienceContext(userId: string, planId: string) {
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
    return { plan, ctx, interests, pace, itineraryPart };
  }

  /** v2 丰富解读（14 号方案）：缓存键 = plan+lang+行程+兴趣+pace+资料版本+prompt版本。 */
  async explain(userId: string, planId: string, lang: 'zh' | 'en' = 'zh') {
    const { plan, ctx, interests, pace, itineraryPart } = await this.planExperienceContext(userId, planId);

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
