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
exports.MeController = exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_service_1 = require("./auth.service");
const auth_1 = require("../common/auth");
const prisma_service_1 = require("../prisma.service");
const errors_1 = require("../common/errors");
const users_service_1 = require("../users/users.service");
let AuthController = class AuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    register(body) {
        if (!body?.email || !body?.password)
            throw errors_1.AppError.validation(['email', 'password']);
        return this.auth.register({
            email: body.email,
            password: body.password,
            displayName: body.displayName || '',
            timezone: body.timezone,
            residenceCountry: body.residenceCountry,
        });
    }
    async login(body) {
        if (!body?.email || !body?.password)
            throw errors_1.AppError.validation(['email', 'password']);
        const result = await this.auth.login(body);
        return { user: { id: result.userId }, ...result };
    }
    refresh(body) {
        if (!body?.refreshToken)
            throw errors_1.AppError.validation(['refreshToken']);
        return this.auth.refresh(body.refreshToken);
    }
    async logout(body) {
        if (body?.refreshToken)
            await this.auth.logout(body.refreshToken);
        return { ok: true };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('refresh'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.UseGuards)(auth_1.JwtAuthGuard),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
exports.AuthController = AuthController = __decorate([
    (0, swagger_1.ApiTags)('auth'),
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
let MeController = class MeController {
    prisma;
    users;
    constructor(prisma, users) {
        this.prisma = prisma;
        this.users = users;
    }
    async me(user) {
        const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
        if (!u)
            throw errors_1.AppError.unauthorized();
        const wallet = await this.users.walletSummary(u.id);
        return {
            user: {
                id: u.id,
                email: u.email,
                displayName: u.displayName,
                residenceCountry: u.residenceCountry,
                timezone: u.timezone,
                preferences: u.preferencesJson ?? null,
            },
            wallet,
        };
    }
    async updateMe(user, body) {
        const u = await this.prisma.user.update({
            where: { id: user.userId },
            data: {
                displayName: body.displayName,
                timezone: body.timezone,
                residenceCountry: body.residenceCountry,
                preferencesJson: body.preferences ? body.preferences : undefined,
            },
        });
        return {
            user: {
                id: u.id,
                email: u.email,
                displayName: u.displayName,
                residenceCountry: u.residenceCountry,
                timezone: u.timezone,
                preferences: u.preferencesJson ?? null,
            },
        };
    }
};
exports.MeController = MeController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MeController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MeController.prototype, "updateMe", null);
exports.MeController = MeController = __decorate([
    (0, swagger_1.ApiTags)('me'),
    (0, common_1.Controller)('me'),
    (0, common_1.UseGuards)(auth_1.JwtAuthGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        users_service_1.UsersService])
], MeController);
