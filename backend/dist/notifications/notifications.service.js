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
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const nodemailer_1 = require("nodemailer");
const prisma_service_1 = require("../prisma.service");
const env_1 = require("../config/env");
const crypto_1 = require("../common/crypto");
let NotificationsService = class NotificationsService {
    prisma;
    logger = new common_1.Logger('NotificationsService');
    transporter = null;
    constructor(prisma) {
        this.prisma = prisma;
        const env = (0, env_1.loadEnv)();
        if (env.MAIL_PROVIDER === 'smtp' && env.SMTP_HOST) {
            this.transporter = (0, nodemailer_1.createTransport)({
                host: env.SMTP_HOST,
                port: env.SMTP_PORT,
                secure: env.SMTP_SECURE,
                auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
            });
        }
        else {
            this.logger.warn('MAIL_PROVIDER=console or SMTP not configured; emails will be logged only.');
        }
    }
    async notify(input) {
        const notification = await this.prisma.notification.create({
            data: {
                userId: input.userId,
                kind: input.kind,
                title: input.title,
                body: input.body,
                deepLink: input.deepLink,
                planId: input.planId,
                monitorId: input.monitorId,
                isSimulated: input.isSimulated ?? false,
            },
        });
        await this.prisma.notificationDelivery.create({
            data: { notificationId: notification.id, channel: 'APP', status: 'SENT', attempts: 1, sentAt: new Date() },
        });
        if (input.sendEmail !== false) {
            await this.deliverEmail(notification.id, input.userId, input.title, input.body);
        }
        return { notificationId: notification.id };
    }
    async deliverEmail(notificationId, userId, subject, text) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            return;
        const env = (0, env_1.loadEnv)();
        const masked = (0, crypto_1.maskEmail)(user.email);
        if (!this.transporter) {
            this.logger.log(`[mail:console] to=${masked} subject="${subject}"`);
            await this.prisma.notificationDelivery.create({
                data: { notificationId, channel: 'EMAIL', status: 'SENT', attempts: 1, maskedTo: masked, sentAt: new Date() },
            });
            return;
        }
        try {
            await this.transporter.sendMail({
                from: env.MAIL_FROM || `LayoverJoy <${env.SMTP_USER}>`,
                to: user.email,
                subject: `[LayoverJoy] ${subject}`,
                text,
            });
            await this.prisma.notificationDelivery.create({
                data: { notificationId, channel: 'EMAIL', status: 'SENT', attempts: 1, maskedTo: masked, sentAt: new Date() },
            });
        }
        catch (e) {
            this.logger.error(`email delivery failed for ${masked}: ${e.message}`);
            await this.prisma.notificationDelivery.create({
                data: {
                    notificationId,
                    channel: 'EMAIL',
                    status: 'FAILED',
                    attempts: 1,
                    maskedTo: masked,
                    lastError: e.message.slice(0, 500),
                },
            });
        }
    }
    async list(userId, unreadOnly, limit = 50) {
        const items = await this.prisma.notification.findMany({
            where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
        return {
            notifications: items.map((n) => ({
                id: n.id,
                kind: n.kind,
                title: n.title,
                body: n.body,
                deepLink: n.deepLink,
                planId: n.planId,
                monitorId: n.monitorId,
                isSimulated: n.isSimulated,
                readAt: n.readAt?.toISOString() ?? null,
                createdAt: n.createdAt.toISOString(),
            })),
        };
    }
    async markRead(userId, notificationId) {
        const n = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
        if (!n)
            return { ok: false };
        if (!n.readAt)
            await this.prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
        return { ok: true };
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationsService);
