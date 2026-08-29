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
exports.MonitorsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const atlas_service_1 = require("../atlas/atlas.service");
const notifications_service_1 = require("../notifications/notifications.service");
const catalog_1 = require("../airports/catalog");
const errors_1 = require("../common/errors");
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
let MonitorsService = class MonitorsService {
    prisma;
    atlas;
    notifications;
    logger = new common_1.Logger('MonitorsService');
    constructor(prisma, atlas, notifications) {
        this.prisma = prisma;
        this.atlas = atlas;
        this.notifications = notifications;
    }
    async create(userId, input) {
        if (!input.planId)
            throw errors_1.AppError.validation(['planId']);
        const plan = await this.prisma.stopoverPlan.findFirst({ where: { id: input.planId, searchRun: { userId } } });
        if (!plan)
            throw errors_1.AppError.notFound('方案');
        if (input.targetAirfare === undefined && input.minJoyScore === undefined) {
            throw errors_1.AppError.validation(['targetAirfare', 'minJoyScore'], '请至少设置目标票价或最低 JoyScore。');
        }
        const run = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
        const city = catalog_1.HUB_CATALOG.find((c) => c.cityId === plan.stopoverCityId);
        const routeLabel = `${run?.originCode ?? ''} → ${city?.cityNameZh ?? plan.stopoverCityId ?? ''} → ${run?.destinationCode ?? ''}`;
        const rule = await this.prisma.monitorRule.create({
            data: {
                userId,
                planId: plan.id,
                searchRunId: plan.searchRunId,
                routeLabel,
                targetAirfare: input.targetAirfare ?? null,
                minJoyScore: input.minJoyScore ?? null,
                notifyEmail: input.notifyEmail ?? true,
                notifyApp: input.notifyApp ?? true,
                nextCheckAt: new Date(Date.now() + 60 * 1000),
            },
        });
        return { monitorId: rule.id, status: rule.status };
    }
    async list(userId) {
        const rules = await this.prisma.monitorRule.findMany({
            where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } },
            orderBy: { createdAt: 'desc' },
        });
        return {
            monitors: rules.map((r) => ({
                monitorId: r.id,
                planId: r.planId,
                routeLabel: r.routeLabel,
                targetAirfare: r.targetAirfare,
                minJoyScore: r.minJoyScore,
                notifyEmail: r.notifyEmail,
                notifyApp: r.notifyApp,
                status: r.status,
                lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
                lastTriggeredAt: r.lastTriggeredAt?.toISOString() ?? null,
                lastTriggerReason: r.lastTriggerReason,
            })),
        };
    }
    async setStatus(userId, monitorId, status) {
        const rule = await this.prisma.monitorRule.findFirst({ where: { id: monitorId, userId } });
        if (!rule)
            throw errors_1.AppError.notFound('监控规则');
        await this.prisma.monitorRule.update({
            where: { id: rule.id },
            data: { status, nextCheckAt: status === 'ACTIVE' ? new Date() : null },
        });
        return { monitorId: rule.id, status };
    }
    async evaluateDue(now = new Date()) {
        const due = await this.prisma.monitorRule.findMany({
            where: { status: 'ACTIVE', nextCheckAt: { lte: now } },
            take: 20,
        });
        let triggered = 0;
        for (const rule of due) {
            try {
                const hit = await this.checkRule(rule);
                await this.prisma.monitorRule.update({
                    where: { id: rule.id },
                    data: {
                        lastCheckedAt: now,
                        nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS),
                        ...(hit
                            ? { lastTriggeredAt: now, lastTriggerReason: hit.reason }
                            : {}),
                    },
                });
                if (hit)
                    triggered += 1;
            }
            catch (e) {
                this.logger.warn(`monitor ${rule.id} check failed: ${e.message}`);
                await this.prisma.monitorRule
                    .update({ where: { id: rule.id }, data: { lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS) } })
                    .catch(() => undefined);
            }
        }
        return triggered;
    }
    async checkRule(rule) {
        const plan = await this.prisma.stopoverPlan.findUnique({ where: { id: rule.planId } });
        const run = await this.prisma.searchRun.findUnique({ where: { id: rule.searchRunId } });
        if (!plan || !run)
            return null;
        const legs = await this.prisma.flightOfferSnapshot.findMany({
            where: { id: { in: plan.legOfferIdsJson ?? [] } },
            orderBy: { legNo: 'asc' },
        });
        if (legs.length === 0)
            return null;
        let currentTotal = 0;
        for (const leg of legs) {
            const departDate = leg.departureAt.toISOString().slice(0, 10);
            const { offers } = await this.atlas.searchWithCache({
                origin: leg.origin,
                destination: leg.destination,
                departDate,
                adults: 1,
                currency: plan.currency,
            });
            const bookable = offers.filter((o) => o.priceStatus === 'current' && o.bookable);
            if (!bookable.length)
                return null;
            const best = Math.min(...bookable.map((o) => o.totalPrice));
            currentTotal += best;
        }
        const priceHit = rule.targetAirfare !== null && currentTotal <= rule.targetAirfare;
        if (priceHit) {
            const city = catalog_1.HUB_CATALOG.find((c) => c.cityId === plan.stopoverCityId);
            const reason = `PRICE_TARGET_REACHED:${currentTotal}`;
            await this.notifications.notify({
                userId: rule.userId,
                kind: 'PRICE_ALERT',
                title: '好价提醒：目标票价已到达',
                body: `${rule.routeLabel} 当前两段合计约 ${currentTotal} ${plan.currency}（Atlas Sandbox 模拟报价），达到你设置的目标价 ${rule.targetAirfare} ${plan.currency}。价格随时可能变化，不会产生真实出票或扣款。`,
                deepLink: `layoverjoy://plans/${plan.id}`,
                planId: plan.id,
                monitorId: rule.id,
                isSimulated: true,
                sendEmail: rule.notifyEmail,
            });
            this.logger.log(`monitor ${rule.id} triggered for ${city?.cityNameZh ?? plan.stopoverCityId}: ${currentTotal}`);
            return { reason };
        }
        return null;
    }
};
exports.MonitorsService = MonitorsService;
exports.MonitorsService = MonitorsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        atlas_service_1.AtlasService,
        notifications_service_1.NotificationsService])
], MonitorsService);
