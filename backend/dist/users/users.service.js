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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const errors_1 = require("../common/errors");
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    toUtcDate(s) {
        if (!s)
            return null;
        const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
        if (Number.isNaN(d.getTime()))
            return null;
        return d;
    }
    async listDocuments(userId) {
        const docs = await this.prisma.travelDocument.findMany({
            where: { userId, deletedAt: null },
            orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
        });
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        return docs.map((d) => {
            let docStatus = d.status;
            if (d.expiresOn && d.expiresOn < today)
                docStatus = 'EXPIRED';
            return {
                id: d.id,
                kind: d.kind,
                countryCode: d.countryCode,
                passportType: d.passportType,
                visaType: d.visaType,
                entryType: d.entryType,
                remainingEntries: d.remainingEntries,
                validFrom: d.validFrom?.toISOString().slice(0, 10) ?? null,
                expiresOn: d.expiresOn?.toISOString().slice(0, 10) ?? null,
                isPrimary: d.isPrimary,
                status: docStatus,
                needsInfo: d.kind !== 'PASSPORT' && !d.expiresOn ? true : undefined,
            };
        });
    }
    async walletSummary(userId) {
        const docs = await this.listDocuments(userId);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const passport = docs.find((d) => d.kind === 'PASSPORT' && d.status !== 'EXPIRED') || null;
        const visas = docs.filter((d) => d.kind === 'VISA');
        const validVisas = visas.filter((d) => {
            if (!d.expiresOn)
                return false;
            const exp = new Date(`${d.expiresOn}T00:00:00Z`);
            if (exp < today)
                return false;
            if (d.validFrom) {
                const from = new Date(`${d.validFrom}T00:00:00Z`);
                if (from > today)
                    return false;
            }
            return true;
        });
        const expiredVisas = visas.filter((d) => d.status === 'EXPIRED');
        const needsInfoVisas = visas.filter((d) => !d.expiresOn);
        return {
            passport: passport
                ? { countryCode: passport.countryCode, passportType: passport.passportType, expiresOn: passport.expiresOn, status: passport.status }
                : null,
            validVisaCount: validVisas.length,
            validVisas: validVisas.map((v) => ({ countryCode: v.countryCode, visaType: v.visaType, expiresOn: v.expiresOn })),
            expiredVisaCount: expiredVisas.length,
            needsInfoCount: needsInfoVisas.length,
        };
    }
    async createDocument(userId, input) {
        if (!input.kind || !['PASSPORT', 'VISA', 'RESIDENCE'].includes(input.kind)) {
            throw errors_1.AppError.validation(['kind'], '证件类型不正确。');
        }
        if (!/^[A-Z]{2}$/.test(input.countryCode || '')) {
            throw errors_1.AppError.validation(['countryCode'], '国家代码必须为 ISO 3166-1 alpha-2。');
        }
        if (input.kind === 'PASSPORT') {
            const existing = await this.prisma.travelDocument.findFirst({
                where: { userId, kind: 'PASSPORT', deletedAt: null, status: 'ACTIVE' },
            });
            if (existing) {
                throw new errors_1.AppError('DUPLICATE_PASSPORT', '每位用户只能保留一本有效主护照，请先删除旧护照。', 409);
            }
            input.isPrimary = true;
        }
        const doc = await this.prisma.travelDocument.create({
            data: {
                userId,
                kind: input.kind,
                countryCode: input.countryCode,
                passportType: input.passportType,
                visaType: input.visaType,
                entryType: input.entryType,
                remainingEntries: input.remainingEntries,
                validFrom: this.toUtcDate(input.validFrom) ?? undefined,
                expiresOn: this.toUtcDate(input.expiresOn) ?? undefined,
                isPrimary: Boolean(input.isPrimary),
            },
        });
        return { id: doc.id };
    }
    async updateDocument(userId, id, input) {
        const doc = await this.prisma.travelDocument.findFirst({ where: { id, userId, deletedAt: null } });
        if (!doc)
            throw errors_1.AppError.notFound('证件');
        const updated = await this.prisma.travelDocument.update({
            where: { id },
            data: {
                countryCode: input.countryCode,
                passportType: input.passportType,
                visaType: input.visaType,
                entryType: input.entryType,
                remainingEntries: input.remainingEntries,
                validFrom: input.validFrom !== undefined ? this.toUtcDate(input.validFrom) ?? undefined : undefined,
                expiresOn: input.expiresOn !== undefined ? this.toUtcDate(input.expiresOn) ?? undefined : undefined,
            },
        });
        return { id: updated.id };
    }
    async deleteDocument(userId, id) {
        const doc = await this.prisma.travelDocument.findFirst({ where: { id, userId, deletedAt: null } });
        if (!doc)
            throw errors_1.AppError.notFound('证件');
        await this.prisma.travelDocument.update({ where: { id }, data: { deletedAt: new Date(), status: 'REVOKED' } });
        return { ok: true };
    }
    async profileForRules(userId) {
        const docs = await this.listDocuments(userId);
        const passport = docs.find((d) => d.kind === 'PASSPORT' && d.status !== 'EXPIRED');
        const visas = docs.filter((d) => d.kind === 'VISA' && d.status !== 'EXPIRED');
        return {
            passport: passport
                ? { issuingCountry: passport.countryCode, type: passport.passportType || 'ORDINARY', validUntil: passport.expiresOn || undefined }
                : undefined,
            visas: visas.map((v) => ({ country: v.countryCode, type: v.visaType || undefined, validUntil: v.expiresOn || undefined, entryType: v.entryType || undefined })),
            residenceCountry: null,
        };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
