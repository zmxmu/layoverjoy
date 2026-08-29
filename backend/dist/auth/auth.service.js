"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const argon2 = __importStar(require("argon2"));
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma.service");
const errors_1 = require("../common/errors");
const REFRESH_TTL_DAYS = 7;
let AuthService = class AuthService {
    prisma;
    jwt;
    constructor(prisma, jwt) {
        this.prisma = prisma;
        this.jwt = jwt;
    }
    async register(input) {
        const email = input.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw errors_1.AppError.validation(['email'], '邮箱格式不正确。');
        }
        if (input.password.length < 8) {
            throw errors_1.AppError.validation(['password'], '密码至少 8 位。');
        }
        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new errors_1.AppError('DUPLICATE_EMAIL', '该邮箱已注册，请直接登录。', 409);
        }
        const passwordHash = await argon2.hash(input.password);
        const user = await this.prisma.user.create({
            data: {
                email,
                passwordHash,
                displayName: input.displayName || email.split('@')[0],
                timezone: input.timezone || 'Asia/Shanghai',
                residenceCountry: input.residenceCountry,
            },
        });
        return this.issueTokens(user.id, user.email);
    }
    async login(input) {
        const email = input.email.trim().toLowerCase();
        const user = await this.prisma.user.findUnique({ where: { email } });
        const ok = user ? await argon2.verify(user.passwordHash, input.password) : false;
        if (!user || !ok || user.status !== 'ACTIVE') {
            throw new errors_1.AppError('INVALID_CREDENTIALS', '邮箱或密码不正确。', 401);
        }
        const tokens = await this.issueTokens(user.id, user.email);
        return { ...tokens, userId: user.id };
    }
    async refresh(refreshToken) {
        const tokenHash = this.hashToken(refreshToken);
        const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
        if (!record || record.revokedAt || record.expiresAt < new Date()) {
            throw errors_1.AppError.unauthorized();
        }
        await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
        const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
        if (!user)
            throw errors_1.AppError.unauthorized();
        return this.issueTokens(user.id, user.email);
    }
    async logout(refreshToken) {
        const tokenHash = this.hashToken(refreshToken);
        await this.prisma.refreshToken.updateMany({
            where: { tokenHash, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
    async issueTokens(userId, email) {
        const accessToken = this.jwt.sign({ sub: userId, email });
        const refreshToken = (0, crypto_1.randomBytes)(48).toString('base64url');
        await this.prisma.refreshToken.create({
            data: {
                userId,
                tokenHash: this.hashToken(refreshToken),
                expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
            },
        });
        return { accessToken, refreshToken, expiresIn: 15 * 60 };
    }
    hashToken(token) {
        return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService])
], AuthService);
