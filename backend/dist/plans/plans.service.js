"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlansService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const nosana_service_1 = require("../explanations/nosana.service");
const catalog_1 = require("../airports/catalog");
const errors_1 = require("../common/errors");
let PlansService = class PlansService {
    prisma;
    nosana;
    constructor(prisma, nosana) {
        this.prisma = prisma;
        this.nosana = nosana;
    }
    cityOf(cityId) {
        if (!cityId)
            return null;
        const c = catalog_1.HUB_CATALOG.find((x) => x.cityId === cityId);
        return c ? { cityId: c.cityId, cityNameZh: c.cityNameZh, cityNameEn: c.cityNameEn, countryCode: c.countryCode } : null;
    }
    async getPlan(userId, planId) {
        const plan = await this.prisma.stopoverPlan.findFirst({
            where: { id: planId, searchRun: { userId } },
        });
        if (!plan)
            throw errors_1.AppError.notFound('方案');
        const legIds = plan.legOfferIdsJson ?? [];
        const offers = await this.prisma.flightOfferSnapshot.findMany({ where: { id: { in: legIds } } });
        const offerMap = new Map(offers.map((o) => [o.id, o]));
        const eligibility = plan.eligibilitySnapshotId
            ? await this.prisma.eligibilitySnapshot.findUnique({ where: { id: plan.eligibilitySnapshotId } })
            : null;
        const explanation = await this.prisma.planExplanation.findUnique({ where: { planId: plan.id } });
        const city = this.cityOf(plan.stopoverCityId);
        const pack = plan.stopoverCityId ? catalog_1.CITY_PACKS[plan.stopoverCityId] : undefined;
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
                snapshotId: o.id,
                legNo: o.legNo,
                origin: o.origin,
                destination: o.destination,
                departureAt: o.departureAt.toISOString(),
                arrivalAt: o.arrivalAt.toISOString(),
                carrier: o.carrier,
                flightNumber: o.flightNumber,
                currency: o.currency,
                totalPrice: o.totalPrice,
                isSimulated: o.isSimulated,
                sourceProvider: o.sourceProvider,
                providerOfferId: o.providerOfferId,
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
    async explain(userId, planId) {
        const plan = await this.prisma.stopoverPlan.findFirst({
            where: { id: planId, searchRun: { userId } },
        });
        if (!plan)
            throw errors_1.AppError.notFound('方案');
        const existing = await this.prisma.planExplanation.findUnique({ where: { planId: plan.id } });
        if (existing && existing.provider === 'NOSANA') {
            return { provider: existing.provider, modelId: existing.modelId, payload: existing.payloadJson };
        }
        const city = this.cityOf(plan.stopoverCityId);
        const run = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
        const prefs = run?.preferencesJson ?? {};
        const result = await this.nosana.explain({
            cityNameZh: city?.cityNameZh ?? plan.stopoverCityId ?? '中转城市',
            stayDays: plan.stayDays,
            usableHours: plan.usableHours,
            airfareDelta: plan.airfareDelta,
            currency: plan.currency,
            joyScore: plan.joyScore,
            joyScoreBreakdown: plan.joyScoreBreakdownJson,
            riskFlags: plan.riskFlagsJson ?? [],
            interests: prefs.interests ?? [],
        });
        const saved = await this.prisma.planExplanation.upsert({
            where: { planId: plan.id },
            create: { planId: plan.id, provider: result.provider, modelId: result.modelId, payloadJson: result },
            update: { provider: result.provider, modelId: result.modelId, payloadJson: result },
        });
        return { provider: saved.provider, modelId: saved.modelId, payload: saved.payloadJson };
    }
};
exports.PlansService = PlansService;
exports.PlansService = PlansService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        nosana_service_1.NosanaService])
], PlansService);
