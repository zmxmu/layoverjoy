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
exports.WebhookService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma.service");
const atlas_service_1 = require("../atlas/atlas.service");
const core_module_1 = require("../core.module");
const crypto_2 = require("../common/crypto");
const env_1 = require("../config/env");
let WebhookService = class WebhookService {
    prisma;
    atlas;
    crypto;
    logger = new common_1.Logger('WebhookService');
    constructor(prisma, atlas, crypto) {
        this.prisma = prisma;
        this.atlas = atlas;
        this.crypto = crypto;
    }
    verifyToken(provided) {
        const expected = (0, env_1.loadEnv)().ATLAS_WEBHOOK_SHARED_TOKEN;
        if (!expected || !provided)
            return false;
        const a = Buffer.from(expected);
        const b = Buffer.from(provided);
        if (a.length !== b.length)
            return false;
        return (0, crypto_1.timingSafeEqual)(a, b);
    }
    async ingest(payload) {
        if (!payload || typeof payload !== 'object')
            return { result: 'invalid', reason: 'BODY_NOT_JSON' };
        const type = typeof payload.type === 'string' ? payload.type : null;
        const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : null;
        const cid = typeof payload.cid === 'string' ? payload.cid : null;
        const orderNo = typeof payload?.data?.orderNo === 'string' ? payload.data.orderNo : null;
        if (!type)
            return { result: 'invalid', reason: 'MISSING_TYPE' };
        const env = (0, env_1.loadEnv)();
        if (env.ATLAS_CID && cid && cid !== env.ATLAS_CID) {
            return { result: 'invalid', reason: 'CID_MISMATCH' };
        }
        const key = notificationId
            ? `atlas:${notificationId}`
            : `sha256:${(0, crypto_1.createHash)('sha256').update(JSON.stringify({ cid, type, orderNo, data: payload.data ?? null })).digest('hex')}`;
        const existing = await this.prisma.atlasWebhookEvent.findUnique({ where: { notificationKey: key } });
        if (existing)
            return { result: 'duplicate' };
        const knownTypes = [
            'order.ticketed',
            'order.scheduleChange',
            'order.addonComplete',
            'order.refundComplete',
            'airline.status',
            'email.all',
            'email.schedulechange',
            'order.schedulechange',
            'abnormal.cancelled',
        ];
        const isKnown = knownTypes.includes(type);
        await this.prisma.atlasWebhookEvent.create({
            data: {
                notificationKey: key,
                eventType: type,
                cid,
                orderNoLast4: orderNo ? (0, crypto_2.maskLast4)(orderNo).replace('****', '') : null,
                payloadEnc: this.crypto.encrypt(JSON.stringify(payload)),
                processingStatus: isKnown ? 'RECEIVED' : 'UNKNOWN',
            },
        });
        this.logger.log(`webhook received type=${type} notificationId=${notificationId ?? 'none'} orderNo=${orderNo ? (0, crypto_2.maskLast4)(orderNo) : 'none'}`);
        if (isKnown && orderNo) {
            setImmediate(() => this.reconcile(key, type, orderNo).catch((e) => this.logger.warn(`reconcile failed: ${e.message}`)));
        }
        else if (!isKnown) {
            await this.prisma.atlasWebhookEvent.update({ where: { notificationKey: key }, data: { processingStatus: 'UNKNOWN', processedAt: new Date() } });
        }
        return { result: 'accepted' };
    }
    async reconcile(notificationKey, type, orderNo) {
        try {
            const order = await this.atlas.order.getOrder(orderNo);
            await this.prisma.atlasWebhookEvent.update({
                where: { notificationKey },
                data: { processingStatus: 'PROCESSED', processedAt: new Date() },
            });
            if (type === 'order.ticketed') {
                const local = await this.findLocalOrderByNo(orderNo);
                if (local) {
                    await this.prisma.flightOrder.update({ where: { id: local.id }, data: { status: 'TICKETED', lastProviderCode: order.status } });
                }
            }
        }
        catch (e) {
            this.logger.warn(`getOrder reconfirm failed for ${(0, crypto_2.maskLast4)(orderNo)}: ${e.message}`);
            await this.prisma.atlasWebhookEvent.update({
                where: { notificationKey },
                data: { processingStatus: 'PROCESSED', processedAt: new Date() },
            });
        }
    }
    async findLocalOrderByNo(orderNo) {
        const orders = await this.prisma.flightOrder.findMany({ where: { orderNoEnc: { not: null } }, take: 200 });
        for (const o of orders) {
            try {
                if (o.orderNoEnc && this.crypto.decrypt(o.orderNoEnc) === orderNo)
                    return o;
            }
            catch {
            }
        }
        return null;
    }
};
exports.WebhookService = WebhookService;
exports.WebhookService = WebhookService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(core_module_1.FIELD_CRYPTO)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        atlas_service_1.AtlasService,
        crypto_2.FieldCrypto])
], WebhookService);
