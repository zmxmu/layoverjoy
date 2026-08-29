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
exports.PlanningJobsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const daytona_runner_1 = require("./daytona.runner");
const entry_rules_service_1 = require("../entry-rules/entry-rules.service");
const atlas_service_1 = require("../atlas/atlas.service");
const nosana_service_1 = require("../explanations/nosana.service");
const catalog_1 = require("../airports/catalog");
const errors_1 = require("../common/errors");
const MAX_PARALLEL_SANDBOXES = 3;
let PlanningJobsService = class PlanningJobsService {
    prisma;
    runner;
    rules;
    atlas;
    nosana;
    logger = new common_1.Logger('PlanningJobsService');
    constructor(prisma, runner, rules, atlas, nosana) {
        this.prisma = prisma;
        this.runner = runner;
        this.rules = rules;
        this.atlas = atlas;
        this.nosana = nosana;
    }
    async create(userId, request) {
        const missing = [];
        if (!request.origin)
            missing.push('origin');
        if (!request.destination)
            missing.push('destination');
        if (!request.departureDate)
            missing.push('departureDate');
        if (!request.passportCountry)
            missing.push('passportCountry');
        if (missing.length)
            throw errors_1.AppError.validation(missing);
        const serialized = JSON.stringify(request);
        if (/passportNumber|documentNumber|fullName|email/i.test(serialized)) {
            throw errors_1.AppError.validation(['request'], 'planning-jobs 输入只允许最小化字段，不接受证件号、姓名或邮箱。');
        }
        const job = await this.prisma.planningJob.create({
            data: {
                userId,
                requestJson: request,
                runnerMode: this.runner.mode(),
            },
        });
        void this.runPipeline(job.id).catch((e) => this.logger.error(`planning job ${job.id} crashed: ${e.message}`));
        return { jobId: job.id, status: 'QUEUED', runnerMode: job.runnerMode };
    }
    async setStatus(jobId, status) {
        await this.prisma.planningJob.update({ where: { id: jobId }, data: { status } });
    }
    async runPipeline(jobId) {
        const job = await this.prisma.planningJob.findUnique({ where: { id: jobId } });
        if (!job)
            return;
        const request = job.requestJson;
        try {
            await this.prisma.planningJob.update({ where: { id: jobId }, data: { status: 'GENERATING_CANDIDATES', startedAt: new Date() } });
            const excludeCountries = new Set();
            const cityIds = [...new Set([request.origin, request.destination])];
            const originCity = (0, catalog_1.candidateHubs)([], 20).find((c) => c.metroCode === request.origin || c.airports.some((a) => a.iata === request.origin));
            const destCity = (0, catalog_1.candidateHubs)([], 20).find((c) => c.metroCode === request.destination || c.airports.some((a) => a.iata === request.destination));
            if (originCity)
                excludeCountries.add(originCity.countryCode);
            if (destCity)
                excludeCountries.add(destCity.countryCode);
            void cityIds;
            const hubs = (0, catalog_1.candidateHubs)([...excludeCountries], MAX_PARALLEL_SANDBOXES);
            for (const hub of hubs) {
                await this.prisma.planningJobCandidate.create({
                    data: { planningJobId: jobId, candidateCity: hub.metroCode ?? hub.airports[0].iata },
                });
            }
            await this.setStatus(jobId, 'RUNNING_SANDBOXES');
            const candidates = await this.prisma.planningJobCandidate.findMany({ where: { planningJobId: jobId } });
            await Promise.all(candidates.map((candidate) => this.runCandidate(jobId, candidate.id, candidate.candidateCity, request, hubs)));
            await this.setStatus(jobId, 'AGGREGATING');
            const done = await this.prisma.planningJobCandidate.findMany({ where: { planningJobId: jobId } });
            const successes = done.filter((c) => c.status === 'DONE');
            const failures = done.filter((c) => c.status === 'FAILED');
            await this.setStatus(jobId, 'EXPLAINING');
            const explanations = [];
            for (const c of successes.slice(0, 2)) {
                const explanation = await this.nosana.explain({
                    cityNameZh: c.candidateCity,
                    stayDays: Math.max(...(request.stayDays ?? [2])),
                    usableHours: c.usableHours ?? 0,
                    airfareDelta: 0,
                    currency: c.currency ?? 'SGD',
                    joyScore: 0,
                    joyScoreBreakdown: {},
                    riskFlags: c.riskFlagsJson ?? [],
                    interests: [],
                });
                explanations.push({ candidateCity: c.candidateCity, ...explanation });
            }
            const finalStatus = failures.length === 0 ? 'COMPLETED' : successes.length > 0 ? 'PARTIAL' : 'FAILED';
            await this.prisma.planningJob.update({
                where: { id: jobId },
                data: {
                    status: finalStatus,
                    resultJson: {
                        totalCandidates: done.length,
                        succeeded: successes.length,
                        failed: failures.length,
                        failedCandidates: failures.map((f) => ({ city: f.candidateCity, error: f.error })),
                        sandboxCleanedUp: true,
                    },
                    explanationJson: explanations,
                    completedAt: new Date(),
                },
            });
        }
        catch (e) {
            this.logger.error(`planning job ${jobId} failed: ${e.message}`);
            await this.prisma.planningJob
                .update({
                where: { id: jobId },
                data: { status: 'FAILED', resultJson: { error: e.message }, completedAt: new Date() },
            })
                .catch(() => undefined);
        }
    }
    async runCandidate(jobId, candidateId, candidateCity, request, hubs) {
        await this.prisma.planningJobCandidate.update({
            where: { id: candidateId },
            data: { status: 'RUNNING', startedAt: new Date() },
        });
        const hub = hubs.find((h) => (h.metroCode ?? h.airports[0].iata) === candidateCity) ?? hubs[0];
        try {
            const { result, sandbox } = await this.runner.runIsolated(candidateCity, async () => {
                const stayDays = Math.max(...(request.stayDays ?? [2]));
                const eligibility = await this.rules.evaluate({
                    travelDate: request.departureDate,
                    purpose: 'TOURISM',
                    stayDays,
                    passport: {
                        issuingCountry: request.passportCountry,
                        type: request.passportType || 'ORDINARY',
                    },
                    visas: (request.visas ?? []).map((v) => ({ country: v.country, validUntil: v.validUntil })),
                    destinationCountry: hub.countryCode,
                    onwardTicketConfirmed: true,
                });
                if (eligibility.status !== 'ELIGIBLE') {
                    return {
                        candidateCity,
                        eligibility: eligibility.status,
                        ruleIds: eligibility.ruleId ? [eligibility.ruleId] : [],
                        flightOfferIds: [],
                        totalCost: null,
                        currency: null,
                        usableHours: null,
                        riskFlags: eligibility.reasonCodes,
                        evidenceTimestamp: new Date().toISOString(),
                    };
                }
                const hubCode = hub.metroCode ?? hub.airports[0].iata;
                const leg1 = await this.atlas.searchWithCache({
                    origin: request.origin,
                    destination: hubCode,
                    departDate: request.departureDate,
                    adults: 1,
                    currency: 'SGD',
                });
                const leg1Best = bestBookable(leg1.offers);
                const depart2 = addDays(request.departureDate, stayDays);
                const leg2 = await this.atlas.searchWithCache({
                    origin: hubCode,
                    destination: request.destination,
                    departDate: depart2,
                    adults: 1,
                    currency: 'SGD',
                });
                const leg2Best = bestBookable(leg2.offers);
                if (!leg1Best || !leg2Best) {
                    return {
                        candidateCity,
                        eligibility: 'NO_INVENTORY',
                        ruleIds: eligibility.ruleId ? [eligibility.ruleId] : [],
                        flightOfferIds: [],
                        totalCost: null,
                        currency: null,
                        usableHours: null,
                        riskFlags: ['NO_SANDBOX_INVENTORY'],
                        evidenceTimestamp: new Date().toISOString(),
                    };
                }
                const usableHours = Math.max(0, (new Date(leg2Best.departureAt).getTime() - new Date(leg1Best.arrivalAt).getTime()) / 3600_000 - 6);
                return {
                    candidateCity,
                    eligibility: 'ELIGIBLE',
                    ruleIds: eligibility.ruleId ? [eligibility.ruleId] : [],
                    flightOfferIds: [leg1Best.providerOfferId, leg2Best.providerOfferId],
                    totalCost: Math.round((leg1Best.totalPrice + leg2Best.totalPrice) * 100) / 100,
                    currency: leg1Best.currency,
                    usableHours: Math.round(usableHours * 10) / 10,
                    riskFlags: ['SEPARATE_TICKETS', 'RECHECK_BAGGAGE'],
                    evidenceTimestamp: new Date().toISOString(),
                };
            });
            await this.prisma.planningJobCandidate.update({
                where: { id: candidateId },
                data: {
                    status: result.eligibility === 'ELIGIBLE' && result.totalCost !== null ? 'DONE' : result.eligibility === 'NO_INVENTORY' ? 'FAILED' : 'DONE',
                    eligibility: result.eligibility,
                    ruleIdsJson: result.ruleIds,
                    flightOfferIdsJson: result.flightOfferIds,
                    totalCost: result.totalCost,
                    currency: result.currency,
                    usableHours: result.usableHours,
                    riskFlagsJson: result.riskFlags,
                    sandboxId: sandbox.sandboxId,
                    durationMs: sandbox.durationMs,
                    evidenceJson: { candidateResult: result, sandboxId: sandbox.sandboxId, logs: sandbox.logs, runnerMode: this.runner.mode() },
                    finishedAt: new Date(),
                },
            });
        }
        catch (e) {
            await this.prisma.planningJobCandidate.update({
                where: { id: candidateId },
                data: { status: 'FAILED', error: e.message.slice(0, 500), finishedAt: new Date() },
            });
        }
    }
    async get(userId, jobId) {
        const job = await this.prisma.planningJob.findFirst({
            where: { id: jobId, userId },
            include: { candidates: { orderBy: { startedAt: 'asc' } } },
        });
        if (!job)
            throw errors_1.AppError.notFound('规划任务');
        return {
            jobId: job.id,
            status: job.status,
            runnerMode: job.runnerMode,
            startedAt: job.startedAt?.toISOString() ?? null,
            completedAt: job.completedAt?.toISOString() ?? null,
            result: job.resultJson,
            explanation: job.explanationJson,
            candidates: job.candidates.map((c) => ({
                candidateCity: c.candidateCity,
                status: c.status,
                eligibility: c.eligibility,
                totalCost: c.totalCost,
                currency: c.currency,
                usableHours: c.usableHours,
                sandboxId: c.sandboxId,
                durationMs: c.durationMs,
                error: c.error,
            })),
        };
    }
    async evidence(userId, jobId) {
        const job = await this.prisma.planningJob.findFirst({ where: { id: jobId, userId } });
        if (!job)
            throw errors_1.AppError.notFound('规划任务');
        const candidates = await this.prisma.planningJobCandidate.findMany({ where: { planningJobId: jobId } });
        return {
            jobId: job.id,
            runnerMode: job.runnerMode,
            sandboxCleanedUp: true,
            candidates: candidates.map((c) => ({
                candidateCity: c.candidateCity,
                status: c.status,
                sandboxId: c.sandboxId,
                durationMs: c.durationMs,
                evidence: c.evidenceJson,
            })),
        };
    }
    async remove(userId, jobId) {
        const job = await this.prisma.planningJob.findFirst({ where: { id: jobId, userId } });
        if (!job)
            throw errors_1.AppError.notFound('规划任务');
        await this.prisma.planningJob.delete({ where: { id: job.id } });
        return { ok: true };
    }
};
exports.PlanningJobsService = PlanningJobsService;
exports.PlanningJobsService = PlanningJobsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        daytona_runner_1.DaytonaRunner,
        entry_rules_service_1.EntryRulesService,
        atlas_service_1.AtlasService,
        nosana_service_1.NosanaService])
], PlanningJobsService);
function bestBookable(offers) {
    const list = offers.filter((o) => o.priceStatus === 'current' && o.bookable);
    if (!list.length)
        return null;
    return [...list].sort((a, b) => a.totalPrice - b.totalPrice)[0];
}
function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return new Date(d.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}
