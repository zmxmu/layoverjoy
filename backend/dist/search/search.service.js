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
exports.SearchService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const search_orchestrator_1 = require("./search.orchestrator");
const atlas_service_1 = require("../atlas/atlas.service");
const catalog_1 = require("../airports/catalog");
const errors_1 = require("../common/errors");
let SearchService = class SearchService {
    prisma;
    orchestrator;
    atlas;
    logger = new common_1.Logger('SearchService');
    constructor(prisma, orchestrator, atlas) {
        this.prisma = prisma;
        this.orchestrator = orchestrator;
        this.atlas = atlas;
    }
    async create(userId, input) {
        const missing = [];
        if (!input.origin)
            missing.push('origin');
        if (!input.destination)
            missing.push('destination');
        if (!input.departureDate)
            missing.push('departureDate');
        if (missing.length)
            throw errors_1.AppError.validation(missing);
        const originLoc = (0, catalog_1.resolveLocation)(input.origin);
        const destLoc = (0, catalog_1.resolveLocation)(input.destination);
        if (!originLoc)
            throw new errors_1.AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input: input.origin });
        if (!destLoc)
            throw new errors_1.AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input: input.destination });
        const departure = new Date(`${input.departureDate}T00:00:00Z`);
        if (Number.isNaN(departure.getTime()))
            throw errors_1.AppError.validation(['departureDate'], '出发日期格式不正确。');
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (departure < today)
            throw errors_1.AppError.validation(['departureDate'], '出发日期不能早于今天。');
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
                preferencesJson: (input.preferences ?? {}),
                providerMode: this.atlas.searchProviderLabel(),
            },
        });
        void this.orchestrator.run(run.id, input.preferences?.demoFixture === true).catch((e) => {
            this.logger.error(`orchestrator crash for ${run.id}: ${e.message}`);
        });
        return { searchRunId: run.id, status: 'PENDING' };
    }
    async getStatus(userId, searchRunId) {
        const run = await this.prisma.searchRun.findFirst({ where: { id: searchRunId, userId } });
        if (!run)
            throw errors_1.AppError.notFound('搜索任务');
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
    async getPlans(userId, searchRunId) {
        const run = await this.prisma.searchRun.findFirst({ where: { id: searchRunId, userId } });
        if (!run)
            throw errors_1.AppError.notFound('搜索任务');
        const offers = await this.prisma.flightOfferSnapshot.findMany({
            where: { searchRunId: run.id },
            orderBy: { capturedAt: 'asc' },
        });
        const plans = await this.prisma.stopoverPlan.findMany({
            where: { searchRunId: run.id, status: 'ACTIVE' },
            orderBy: { joyScore: 'desc' },
        });
        const eligibilitySnaps = await this.prisma.eligibilitySnapshot.findMany({ where: { searchRunId: run.id } });
        const offerMap = new Map(offers.map((o) => [o.id, o]));
        const offerDto = (id) => {
            if (!id)
                return null;
            const o = offerMap.get(id);
            if (!o)
                return null;
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
                legs: (p.legOfferIdsJson ?? []).map((id) => offerDto(id)),
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
};
exports.SearchService = SearchService;
exports.SearchService = SearchService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        search_orchestrator_1.SearchOrchestrator,
        atlas_service_1.AtlasService])
], SearchService);
