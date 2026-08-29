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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const env_1 = require("./config/env");
const atlas_service_1 = require("./atlas/atlas.service");
const prisma_service_1 = require("./prisma.service");
let HealthController = class HealthController {
    prisma;
    atlas;
    constructor(prisma, atlas) {
        this.prisma = prisma;
        this.atlas = atlas;
    }
    health() {
        return { status: 'ok', service: 'layoverjoy-backend' };
    }
    async integrations() {
        const env = (0, env_1.loadEnv)();
        let db = 'ok';
        try {
            await this.prisma.$queryRaw `SELECT 1`;
        }
        catch {
            db = 'error';
        }
        return {
            runtime: {
                target: env.RUNTIME_TARGET,
                atlasMode: env.ATLAS_MODE,
                webhookMode: env.WEBHOOK_MODE,
                daytonaMode: env.DAYTONA_MODE,
                mailProvider: env.MAIL_PROVIDER,
            },
            atlas: {
                searchProvider: this.atlas.searchProviderLabel(),
                verifyProvider: this.atlas.providerLabel(this.atlas.verify),
                orderProvider: this.atlas.providerLabel(this.atlas.order),
                paymentProvider: this.atlas.providerLabel(this.atlas.payment),
                refundProvider: this.atlas.providerLabel(this.atlas.refund),
                sandboxConfigured: Boolean(env.ATLAS_CLIENT_ID && env.ATLAS_CLIENT_SECRET),
            },
            nosana: {
                provider: env.INFERENCE_PROVIDER,
                configured: Boolean(env.NOSANA_API_KEY && env.NOSANA_OPENAI_BASE_URL),
                model: env.NOSANA_MODEL,
            },
            daytona: {
                mode: env.DAYTONA_MODE,
                snapshot: env.DAYTONA_SNAPSHOT,
                region: env.DAYTONA_TARGET_REGION,
                apiKeyConfigured: Boolean(env.DAYTONA_API_KEY),
            },
            mail: {
                provider: env.MAIL_PROVIDER,
                recipientSource: 'current_user',
            },
            database: db,
        };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "health", null);
__decorate([
    (0, common_1.Get)('integrations'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], HealthController.prototype, "integrations", null);
exports.HealthController = HealthController = __decorate([
    (0, swagger_1.ApiTags)('health'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        atlas_service_1.AtlasService])
], HealthController);
