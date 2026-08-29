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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchOrchestrator = exports.SEARCH_BUDGET = void 0;
exports.isRedEye = isRedEye;
exports.buildCostBreakdown = buildCostBreakdown;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const atlas_service_1 = require("../atlas/atlas.service");
const entry_rules_service_1 = require("../entry-rules/entry-rules.service");
const users_service_1 = require("../users/users.service");
const catalog_1 = require("../airports/catalog");
const joy_score_1 = require("../plans/joy-score");
const env_1 = require("../config/env");
const core_module_1 = require("../core.module");
const crypto_1 = require("../common/crypto");
exports.SEARCH_BUDGET = {
    maxHubs: 3,
    maxStayVariantsPerHub: 2,
    maxSearchCalls: 10,
    concurrency: 3,
    softTimeoutMs: 20_000,
    hardTimeoutMs: 30_000,
};
let SearchOrchestrator = class SearchOrchestrator {
    prisma;
    atlas;
    rules;
    users;
    crypto;
    logger = new common_1.Logger('SearchOrchestrator');
    constructor(prisma, atlas, rules, users, crypto) {
        this.prisma = prisma;
        this.atlas = atlas;
        this.rules = rules;
        this.users = users;
        this.crypto = crypto;
    }
    async run(searchRunId, useDemoFixtureFallback) {
        const started = Date.now();
        const run = await this.prisma.searchRun.findUnique({ where: { id: searchRunId } });
        if (!run)
            return;
        try {
            await this.prisma.searchRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } });
            const prefs = run.preferencesJson ?? {};
            const profile = await this.users.profileForRules(run.userId);
            const stayVariants = this.stayDayVariants(run.minStopDays, run.maxStopDays);
            const exclude = [(0, catalog_1.resolveLocation)(run.originInput)?.countryCode, (0, catalog_1.resolveLocation)(run.destinationInput)?.countryCode]
                .filter(Boolean);
            const hubs = (0, catalog_1.candidateHubs)(exclude, 8).slice(0, exports.SEARCH_BUDGET.maxHubs);
            const outcomes = [];
            let searchCalls = 0;
            let softTimedOut = false;
            searchCalls += 1;
            const directOffers = await this.safeSearch({
                origin: run.originCode,
                destination: run.destinationCode,
                departDate: this.isoDate(run.departureDate),
                currency: 'SGD',
            }, useDemoFixtureFallback);
            const directBest = this.bestBookable(directOffers.offers);
            let directSnapshotId = null;
            if (directBest) {
                directSnapshotId = await this.saveOffer(run.id, 1, 'DIRECT_BASELINE', null, directBest, directOffers.label);
            }
            const queue = [...hubs];
            const running = [];
            const worker = async () => {
                while (queue.length > 0) {
                    if (Date.now() - started > exports.SEARCH_BUDGET.softTimeoutMs) {
                        softTimedOut = true;
                        return;
                    }
                    const city = queue.shift();
                    if (!city)
                        return;
                    if (searchCalls >= exports.SEARCH_BUDGET.maxSearchCalls) {
                        outcomes.push({ city, status: 'FAILED', reasonCodes: ['BUDGET_EXHAUSTED'] });
                        continue;
                    }
                    await this.evaluateHub(run, city, stayVariants, profile, outcomes, () => (searchCalls += 1));
                }
            };
            for (let i = 0; i < exports.SEARCH_BUDGET.concurrency; i++)
                running.push(worker());
            const timeout = new Promise((resolve) => setTimeout(resolve, exports.SEARCH_BUDGET.hardTimeoutMs));
            await Promise.race([Promise.all(running), timeout]);
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
                    candidateCount: hubs.length + 1,
                    eligibilityRejectedCount: eligibilityRejected,
                    experienceRejectedCount: experienceRejected,
                    keptPlanCount: plans,
                    funnelJson: outcomes.map((o) => ({
                        cityId: o.city.cityId,
                        cityNameZh: o.city.cityNameZh,
                        status: o.status,
                        reasonCodes: o.reasonCodes,
                        ruleId: o.ruleId,
                    })),
                    completedAt: new Date(),
                },
            });
        }
        catch (e) {
            this.logger.error(`search ${searchRunId} failed: ${e.message}`);
            await this.prisma.searchRun.update({
                where: { id: searchRunId },
                data: {
                    status: 'FAILED',
                    resultStatus: 'FAILED',
                    errorJson: { code: e.code || 'INTERNAL_ERROR', message: e.message },
                    completedAt: new Date(),
                },
            });
        }
    }
    stayDayVariants(min, max) {
        const variants = new Set();
        variants.add(Math.max(2, min));
        variants.add(Math.max(min, Math.min(max, 4)));
        return [...variants].slice(0, exports.SEARCH_BUDGET.maxStayVariantsPerHub);
    }
    isoDate(d) {
        return d.toISOString().slice(0, 10);
    }
    addDays(d, days) {
        return new Date(d.getTime() + days * 24 * 3600 * 1000);
    }
    async safeSearch(input, allowDemoFallback) {
        try {
            const { offers } = await this.atlas.searchWithCache(input);
            return { offers, label: this.atlas.searchProviderLabel() };
        }
        catch (e) {
            const code = e.code;
            if (code === 'NO_SANDBOX_INVENTORY' && allowDemoFallback && (0, env_1.loadEnv)().DEMO_FIXTURE_ENABLED) {
                const offers = await this.atlas.search.search({ ...input, adults: 1 });
                if (this.atlas.searchProviderLabel() === 'MOCK')
                    return { offers, label: 'MOCK', fallbackUsed: true };
            }
            throw e;
        }
    }
    bestBookable(offers) {
        const bookable = offers.filter((o) => o.priceStatus === 'current' && o.bookable);
        if (!bookable.length)
            return null;
        return [...bookable].sort((a, b) => a.totalPrice - b.totalPrice)[0];
    }
    async saveOffer(searchRunId, legNo, role, hubCityId, offer, providerLabel) {
        const env = (0, env_1.loadEnv)();
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
                isSimulated: true,
                baggageJson: (offer.baggageJson ?? null),
                rawHash: this.atlas.rawHash(offer),
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        });
        return snap.id;
    }
    encryptSafe(value) {
        try {
            return this.crypto.encrypt(value);
        }
        catch {
            return null;
        }
    }
    async evaluateHub(run, city, stayVariants, profile, outcomes, consumeSearch) {
        const prefs = run.preferencesJson ?? {};
        const outcome = { city, status: 'FAILED', reasonCodes: [] };
        outcomes.push(outcome);
        const eligibility = await this.rules.evaluate({
            travelDate: this.isoDate(run.departureDate),
            purpose: 'TOURISM',
            stayDays: Math.max(...stayVariants),
            passport: profile.passport,
            visas: profile.visas,
            destinationCountry: city.countryCode,
            onwardTicketConfirmed: true,
        });
        outcome.ruleId = eligibility.ruleId;
        if (eligibility.status !== 'ELIGIBLE') {
            outcome.status = eligibility.status;
            outcome.reasonCodes = eligibility.reasonCodes;
            outcome.eligibilitySnapshotId = await this.rules.snapshot(run.id, city.cityId, city.countryCode, eligibility);
            return;
        }
        outcome.eligibilitySnapshotId = await this.rules.snapshot(run.id, city.cityId, city.countryCode, eligibility);
        const hubCode = city.metroCode ?? city.airports[0].iata;
        const useDemo = prefs.demoFixture === true;
        for (const stayDays of stayVariants) {
            if (Date.now() - (run.startedAt ? new Date(run.startedAt).getTime() : 0) > exports.SEARCH_BUDGET.softTimeoutMs)
                return;
            try {
                consumeSearch();
                const leg1 = await this.safeSearch({ origin: run.originCode, destination: hubCode, departDate: this.isoDate(run.departureDate), currency: 'SGD' }, useDemo);
                const leg1Best = this.bestBookable(leg1.offers);
                if (!leg1Best) {
                    outcome.status = 'NO_INVENTORY';
                    outcome.reasonCodes = ['NO_SANDBOX_INVENTORY_LEG_1'];
                    continue;
                }
                consumeSearch();
                const leg2Date = this.isoDate(this.addDays(run.departureDate, stayDays));
                const leg2 = await this.safeSearch({ origin: hubCode, destination: run.destinationCode, departDate: leg2Date, currency: 'SGD' }, useDemo);
                const leg2Best = this.bestBookable(leg2.offers);
                if (!leg2Best) {
                    outcome.status = 'NO_INVENTORY';
                    outcome.reasonCodes = ['NO_SANDBOX_INVENTORY_LEG_2'];
                    continue;
                }
                if (new Date(leg2Best.departureAt) <= new Date(leg1Best.arrivalAt)) {
                    outcome.status = 'EXPERIENCE_REJECTED';
                    outcome.reasonCodes = ['CONNECTION_TIME_INVALID'];
                    continue;
                }
                const directSnap = await this.prisma.flightOfferSnapshot.findFirst({
                    where: { searchRunId: run.id, role: 'DIRECT_BASELINE' },
                });
                const airfareTotal = round2(leg1Best.totalPrice + leg2Best.totalPrice);
                const directTotal = directSnap?.totalPrice ?? null;
                const delta = directTotal !== null ? round2(airfareTotal - directTotal) : 0;
                if (run.maxAirfareDelta !== null && delta > run.maxAirfareDelta * 1.5) {
                    outcome.status = 'EXPERIENCE_REJECTED';
                    outcome.reasonCodes = ['AIRFARE_DELTA_EXCEEDS_BUDGET'];
                    continue;
                }
                if (prefs.acceptRedEye === false && (isRedEye(leg1Best.departureAt) || isRedEye(leg2Best.departureAt))) {
                    outcome.status = 'EXPERIENCE_REJECTED';
                    outcome.reasonCodes = ['RED_EYE_REJECTED'];
                    continue;
                }
                const usableHours = Math.max(0, (new Date(leg2Best.departureAt).getTime() - new Date(leg1Best.arrivalAt).getTime()) / 3600_000 - 6);
                const pack = catalog_1.CITY_PACKS[city.cityId];
                const interests = prefs.interests || [];
                const interestMatch = interests.length ? Math.min(1, 0.6 + 0.2 * interests.length) : 0.7;
                const costBreakdown = buildCostBreakdown({
                    leg1Price: leg1Best.totalPrice,
                    leg2Price: leg2Best.totalPrice,
                    currency: leg1Best.currency,
                    stayDays,
                    cityId: city.cityId,
                    providerLabel: leg1.label,
                });
                const joy = (0, joy_score_1.buildJoyScore)({
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
                await this.prisma.stopoverPlan.create({
                    data: {
                        searchRunId: run.id,
                        planType: 'STOPOVER',
                        stopoverCityId: city.cityId,
                        hubAirport: hubCode,
                        hubCountry: city.countryCode,
                        stayDays,
                        legOfferIdsJson: [leg1SnapId, leg2SnapId],
                        baselineDirectOfferSnapshotId: directSnap?.id ?? null,
                        airfareTotal,
                        airfareDelta: delta,
                        currency: leg1Best.currency,
                        costBreakdownJson: costBreakdown,
                        joyScore: joy.total,
                        joyScoreBreakdownJson: joy.components,
                        usableHours: round2(usableHours),
                        riskLevel: stayDays >= 3 ? 'LOW' : 'MEDIUM',
                        riskFlagsJson: ['SEPARATE_TICKETS', 'RECHECK_BAGGAGE'],
                        eligibilitySnapshotId: outcome.eligibilitySnapshotId,
                        sourceProvider: leg1.label,
                        isSimulated: true,
                    },
                });
                outcome.status = 'COMPLETED';
                outcome.reasonCodes = ['ELIGIBLE', 'PLAN_GENERATED'];
                return;
            }
            catch (e) {
                const code = e.code;
                outcome.status = code === 'NO_SANDBOX_INVENTORY' ? 'NO_INVENTORY' : 'FAILED';
                outcome.reasonCodes = [code || 'SEARCH_FAILED'];
                outcome.error = e.message;
                return;
            }
        }
    }
};
exports.SearchOrchestrator = SearchOrchestrator;
exports.SearchOrchestrator = SearchOrchestrator = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Inject)(core_module_1.FIELD_CRYPTO)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        atlas_service_1.AtlasService,
        entry_rules_service_1.EntryRulesService,
        users_service_1.UsersService,
        crypto_1.FieldCrypto])
], SearchOrchestrator);
function isRedEye(iso) {
    const h = new Date(iso).getUTCHours();
    return h >= 23 || h < 5;
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
function buildCostBreakdown(input) {
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
