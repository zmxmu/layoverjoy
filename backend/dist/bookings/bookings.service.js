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
exports.BookingsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma.service");
const atlas_service_1 = require("../atlas/atlas.service");
const notifications_service_1 = require("../notifications/notifications.service");
const errors_1 = require("../common/errors");
const core_module_1 = require("../core.module");
const crypto_2 = require("../common/crypto");
const SCHEMA_VERSION = 1;
let BookingsService = class BookingsService {
    prisma;
    atlas;
    notifications;
    crypto;
    logger = new common_1.Logger('BookingsService');
    constructor(prisma, atlas, notifications, crypto) {
        this.prisma = prisma;
        this.atlas = atlas;
        this.notifications = notifications;
        this.crypto = crypto;
    }
    async createComposite(userId, input) {
        if (!input.planId)
            throw errors_1.AppError.validation(['planId']);
        if (!input.riskAckVersion || input.riskAckVersion < 1) {
            throw errors_1.AppError.validation(['riskAckVersion'], '请先确认独立机票风险后再预订。');
        }
        const plan = await this.prisma.stopoverPlan.findFirst({ where: { id: input.planId, searchRun: { userId } } });
        if (!plan)
            throw errors_1.AppError.notFound('方案');
        const legs = await this.prisma.flightOfferSnapshot.findMany({
            where: { id: { in: plan.legOfferIdsJson ?? [] } },
            orderBy: { legNo: 'asc' },
        });
        if (legs.length === 0)
            throw errors_1.AppError.notFound('航段报价');
        const intentKey = (0, crypto_1.randomUUID)();
        const intent = await this.prisma.bookingIntent.create({
            data: {
                userId,
                planId: plan.id,
                schemaVersion: SCHEMA_VERSION,
                planSnapshotJson: {
                    planId: plan.id,
                    planType: plan.planType,
                    stopoverCityId: plan.stopoverCityId,
                    stayDays: plan.stayDays,
                    airfareTotal: plan.airfareTotal,
                    currency: plan.currency,
                    costBreakdown: plan.costBreakdownJson,
                    joyScore: plan.joyScore,
                    legs: legs.map((l) => ({
                        legNo: l.legNo,
                        providerOfferId: l.providerOfferId,
                        origin: l.origin,
                        destination: l.destination,
                        departureAt: l.departureAt.toISOString(),
                        totalPrice: l.totalPrice,
                        sourceProvider: l.sourceProvider,
                    })),
                },
                sourceEnvironment: plan.sourceProvider,
                isSimulated: true,
                status: 'DRAFT',
                passengerJson: (input.passengers ?? []),
                acceptedTotal: plan.airfareTotal,
                currency: plan.currency,
                riskAckVersion: input.riskAckVersion,
                idempotencyKey: intentKey,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        });
        const transition = (status, extra = {}) => this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status, ...extra } });
        const verifyResults = await Promise.allSettled(legs.map(async (leg) => {
            const verified = await this.atlas.verify.verify(leg.providerOfferId);
            return { leg, verified };
        }));
        const failed = verifyResults.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
            const cause = failed[0].reason;
            await transition('EXPIRED', { verifyResultJson: { ok: false, error: cause.code || 'VERIFY_FAILED' } });
            if (cause.code === 'PRICE_CHANGED') {
                throw new errors_1.AppError('PRICE_CHANGED', '价格已变化，请返回结果页刷新后重试。', 409, false, {
                    intentId: intent.id,
                });
            }
            throw new errors_1.AppError(cause.code || 'INVENTORY_UNAVAILABLE', cause.messageZh || '验价失败，请稍后重试。', 409, true, {
                intentId: intent.id,
            });
        }
        const verifiedLegs = verifyResults.map((r) => r.value);
        const priceChanged = verifiedLegs.find((v) => v.verified.priceChanged);
        const verifySummary = verifiedLegs.map((v) => ({
            legNo: v.leg.legNo,
            providerOfferId: v.leg.providerOfferId,
            sessionId: v.verified.sessionId ?? null,
            totalPrice: v.verified.totalPrice,
            priceChanged: v.verified.priceChanged,
            bookable: v.verified.bookable,
        }));
        if (priceChanged) {
            await transition('EXPIRED', { verifyResultJson: { ok: false, verify: verifySummary } });
            throw new errors_1.AppError('PRICE_CHANGED', '价格已变化，请返回结果页刷新后重试。', 409, false, { intentId: intent.id });
        }
        await transition('BOTH_VERIFIED', {
            verifyResultJson: { ok: true, verify: verifySummary },
            priceConfirmedAt: new Date(),
        });
        const orderSequence = [...verifiedLegs].sort((a, b) => b.leg.legNo - a.leg.legNo);
        let legAOrdered = false;
        for (const item of orderSequence) {
            const legNo = item.leg.legNo;
            const orderingStatus = legNo === 1 ? 'LEG_A_ORDERING' : 'LEG_B_ORDERING';
            const orderedStatus = legNo === 1 ? 'LEG_A_ORDERED' : 'BOTH_ORDERED';
            await transition(orderingStatus);
            if (input.legBFailure && legNo === 2) {
                await this.recordOrderFailure(intent.id, legNo, 'INVENTORY_CHANGED');
                await transition('PARTIAL_ORDER');
                await this.notifications.notify({
                    userId,
                    kind: 'ORDER_EVENT',
                    title: '部分订单风险：第二段下单失败',
                    body: `第一段已创建订单，第二段库存变化（INVENTORY_CHANGED）。后续支付已停止，可执行模拟补偿退款。模拟退款，没有发生真实资金交易。`,
                    deepLink: `layoverjoy://bookings/${intent.id}`,
                    planId: plan.id,
                    isSimulated: true,
                });
                throw new errors_1.AppError('PARTIAL_BOOKING', '第一段已下单，第二段库存变化导致下单失败。已停止支付，可执行模拟补偿。', 409, false, {
                    intentId: intent.id,
                    failedLeg: legNo,
                    providerCode: 'INVENTORY_CHANGED',
                });
            }
            try {
                const idemKey = `${intentKey}:leg${legNo}`;
                const result = await this.atlas.order.createOrder({
                    bookingReference: item.verified.sessionId || item.leg.providerOfferId,
                    passengers: input.passengers ?? [],
                    idempotencyKey: idemKey,
                });
                await this.prisma.flightOrder.create({
                    data: {
                        bookingIntentId: intent.id,
                        legNo,
                        provider: this.atlas.providerLabel(this.atlas.order),
                        orderNoEnc: this.crypto.encrypt(result.orderNo),
                        verifySessionIdEnc: item.verified.sessionId ? this.crypto.encrypt(item.verified.sessionId) : null,
                        status: 'CREATED',
                        amount: result.amount ?? item.verified.totalPrice,
                        currency: result.currency ?? item.verified.currency,
                        idempotencyKey: idemKey,
                    },
                });
                this.logger.log(`intent ${intent.id} leg ${legNo} ordered: ${(0, crypto_2.maskLast4)(result.orderNo)}`);
                legAOrdered = legAOrdered || legNo === 1;
                await transition(orderedStatus);
            }
            catch (e) {
                const code = e.code || 'ORDER_FAILED';
                await this.recordOrderFailure(intent.id, legNo, code);
                if (legAOrdered) {
                    await transition('PARTIAL_ORDER');
                    throw new errors_1.AppError('PARTIAL_BOOKING', '第一段已下单，第二段下单失败。已停止支付，可执行模拟补偿。', 409, false, {
                        intentId: intent.id,
                        failedLeg: legNo,
                        providerCode: code,
                    });
                }
                await transition('MANUAL_REVIEW');
                throw new errors_1.AppError(code, e.message || '下单失败，请稍后重试。', 409, false, {
                    intentId: intent.id,
                    failedLeg: legNo,
                });
            }
        }
        await transition('PAYMENT_PENDING');
        return this.get(intent.id, userId);
    }
    async recordOrderFailure(intentId, legNo, code) {
        await this.prisma.auditEvent.create({
            data: { action: 'ORDER_FAILED', entity: 'BookingIntent', entityId: intentId, detailJson: { legNo, code } },
        });
    }
    async mockPay(userId, intentId) {
        const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
        if (!intent)
            throw errors_1.AppError.notFound('订单');
        if (intent.status !== 'PAYMENT_PENDING' && intent.status !== 'BOTH_ORDERED') {
            throw new errors_1.AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 不可支付。`, 409);
        }
        const orders = await this.prisma.flightOrder.findMany({
            where: { bookingIntentId: intent.id, status: 'CREATED' },
            orderBy: { legNo: 'asc' },
        });
        for (const order of orders) {
            const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
            const idemKey = `${order.idempotencyKey}:pay`;
            const result = await this.atlas.payment.pay({ orderNo, idempotencyKey: idemKey });
            if (result.status === 'PAID') {
                await this.prisma.flightOrder.update({
                    where: { id: order.id },
                    data: { status: 'PAID', lastProviderCode: result.providerCode ?? 'PAID' },
                });
            }
            else if (result.status === 'UNKNOWN') {
                await this.prisma.flightOrder.update({ where: { id: order.id }, data: { lastProviderCode: 'UNKNOWN' } });
                await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'MANUAL_REVIEW' } });
                throw new errors_1.AppError('PROVIDER_OUTCOME_UNKNOWN', '支付结果未知，已转入人工复核。请勿重复支付。', 409, false, {
                    intentId: intent.id,
                    legNo: order.legNo,
                });
            }
            else {
                await this.prisma.flightOrder.update({
                    where: { id: order.id },
                    data: { status: 'FAILED', lastProviderCode: result.providerCode ?? 'PAY_FAILED' },
                });
                await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'PARTIAL_ORDER' } });
                throw new errors_1.AppError('PARTIAL_BOOKING', '支付失败，订单进入部分完成状态，可执行模拟补偿。', 409, false, {
                    intentId: intent.id,
                    legNo: order.legNo,
                });
            }
        }
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'COMPLETED' } });
        await this.notifications.notify({
            userId,
            kind: 'ORDER_EVENT',
            title: '预订模拟完成',
            body: '两段模拟订单均已支付成功。这是 Atlas Sandbox 测试航班数据，不会产生真实出票或扣款。',
            deepLink: `layoverjoy://bookings/${intent.id}`,
            planId: intent.planId,
            isSimulated: true,
        });
        return this.get(intentId, userId);
    }
    async simulateLegBFailure(userId, intentId) {
        const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
        if (!intent)
            throw errors_1.AppError.notFound('订单');
        if (intent.status === 'PARTIAL_ORDER')
            return this.get(intentId, userId);
        if (intent.status !== 'BOTH_ORDERED' && intent.status !== 'PAYMENT_PENDING') {
            throw new errors_1.AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 无法注入第二段失败。`, 409);
        }
        await this.prisma.flightOrder.updateMany({
            where: { bookingIntentId: intent.id, legNo: 2 },
            data: { status: 'FAILED', lastProviderCode: 'INVENTORY_CHANGED' },
        });
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'PARTIAL_ORDER' } });
        await this.notifications.notify({
            userId,
            kind: 'ORDER_EVENT',
            title: '部分订单风险：第二段下单失败',
            body: '第二段库存变化（INVENTORY_CHANGED），后续支付已停止，可执行模拟补偿退款。模拟退款，没有发生真实资金交易。',
            deepLink: `layoverjoy://bookings/${intent.id}`,
            planId: intent.planId,
            isSimulated: true,
        });
        return this.get(intentId, userId);
    }
    async mockRefund(userId, intentId) {
        const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
        if (!intent)
            throw errors_1.AppError.notFound('订单');
        if (!['PARTIAL_ORDER', 'COMPLETED', 'MANUAL_REVIEW', 'PAYMENT_PENDING', 'BOTH_ORDERED'].includes(intent.status)) {
            throw new errors_1.AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 不可执行模拟补偿。`, 409);
        }
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'SIMULATED_REFUND_PENDING' } });
        const orders = await this.prisma.flightOrder.findMany({
            where: { bookingIntentId: intent.id, status: { in: ['CREATED', 'PAID', 'FAILED'] } },
        });
        for (const order of orders) {
            const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
            const result = await this.atlas.refund.refund({ orderNo, reason: 'SIMULATED_COMPENSATION' });
            await this.prisma.flightOrder.update({
                where: { id: order.id },
                data: { status: 'REFUNDED_SIMULATED', lastProviderCode: result.providerCode ?? result.status },
            });
        }
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'SIMULATED_REFUNDED' } });
        await this.prisma.auditEvent.create({
            data: {
                userId,
                action: 'SIMULATED_REFUND_COMPLETED',
                entity: 'BookingIntent',
                entityId: intent.id,
                detailJson: { orders: orders.length },
            },
        });
        await this.notifications.notify({
            userId,
            kind: 'ORDER_EVENT',
            title: '模拟补偿已完成',
            body: '模拟退款已完成，没有发生真实资金交易。已生成审计记录。',
            deepLink: `layoverjoy://bookings/${intent.id}`,
            planId: intent.planId,
            isSimulated: true,
        });
        return this.get(intentId, userId);
    }
    async list(userId) {
        const intents = await this.prisma.bookingIntent.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { orders: { orderBy: { legNo: 'asc' } } },
        });
        return { bookings: intents.map((i) => this.toDto(i)) };
    }
    async get(intentId, userId) {
        const intent = await this.prisma.bookingIntent.findFirst({
            where: { id: intentId, userId },
            include: { orders: { orderBy: { legNo: 'asc' } } },
        });
        if (!intent)
            throw errors_1.AppError.notFound('订单');
        return { booking: this.toDto(intent) };
    }
    toDto(intent) {
        return {
            bookingId: intent.id,
            planId: intent.planId,
            status: intent.status,
            sourceEnvironment: intent.sourceEnvironment,
            isSimulated: intent.isSimulated,
            acceptedTotal: intent.acceptedTotal,
            currency: intent.currency,
            riskAckVersion: intent.riskAckVersion,
            expiresAt: intent.expiresAt?.toISOString() ?? null,
            createdAt: intent.createdAt.toISOString(),
            orders: (intent.orders ?? []).map((o) => ({
                legNo: o.legNo,
                provider: o.provider,
                status: o.status,
                orderNoLast4: o.orderNoEnc ? (0, crypto_2.maskLast4)(this.safeDecrypt(o.orderNoEnc)) : null,
                amount: o.amount,
                currency: o.currency,
                lastProviderCode: o.lastProviderCode,
            })),
        };
    }
    safeDecrypt(payload) {
        try {
            return this.crypto.decrypt(payload);
        }
        catch {
            return null;
        }
    }
};
exports.BookingsService = BookingsService;
exports.BookingsService = BookingsService = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)(core_module_1.FIELD_CRYPTO)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        atlas_service_1.AtlasService,
        notifications_service_1.NotificationsService,
        crypto_2.FieldCrypto])
], BookingsService);
