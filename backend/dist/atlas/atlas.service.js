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
exports.AtlasService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const env_1 = require("../config/env");
const redis_service_1 = require("../redis.service");
const mock_provider_1 = require("./mock.provider");
const sandbox_provider_1 = require("./sandbox.provider");
const SEARCH_CACHE_TTL_SECONDS = 15 * 60;
let AtlasService = class AtlasService {
    redis;
    logger = new common_1.Logger('AtlasService');
    searchProvider;
    verifyProvider;
    orderProvider;
    paymentProvider;
    refundProvider;
    sandboxInstance = null;
    constructor(redis) {
        this.redis = redis;
        const env = (0, env_1.loadEnv)();
        const mock = new mock_provider_1.MockAtlasProvider();
        const sandboxReady = Boolean(env.ATLAS_CLIENT_ID && env.ATLAS_CLIENT_SECRET);
        if (!sandboxReady) {
            this.logger.warn('Atlas Sandbox credentials missing; falling back to MOCK providers.');
        }
        const sandbox = sandboxReady
            ? new sandbox_provider_1.SandboxAtlasProvider(env.ATLAS_BASE_URL, env.ATLAS_CLIENT_ID, env.ATLAS_CLIENT_SECRET, env.ATLAS_SEARCH_TIMEOUT_MS, env.ATLAS_CID)
            : null;
        this.sandboxInstance = sandbox;
        const pick = (setting) => {
            if (setting === 'sandbox' && sandbox)
                return sandbox;
            return mock;
        };
        this.searchProvider = pick(env.ATLAS_SEARCH_PROVIDER);
        this.verifyProvider = pick(env.ATLAS_VERIFY_PROVIDER);
        this.orderProvider = pick(env.ATLAS_ORDER_PROVIDER);
        this.paymentProvider = pick(env.ATLAS_PAYMENT_PROVIDER);
        this.refundProvider = pick(env.ATLAS_REFUND_PROVIDER);
    }
    providerLabel(provider) {
        return provider.name === 'ATLAS_SANDBOX' ? 'ATLAS_SANDBOX' : 'MOCK';
    }
    searchProviderLabel() {
        return this.providerLabel(this.searchProvider);
    }
    get search() {
        return this.searchProvider;
    }
    get verify() {
        return this.verifyProvider;
    }
    get order() {
        return this.orderProvider;
    }
    get payment() {
        return this.paymentProvider;
    }
    get refund() {
        return this.refundProvider;
    }
    async searchWithCache(input) {
        const key = [
            'atlas:search',
            input.origin,
            input.destination,
            input.departDate,
            input.adults ?? 1,
            input.currency ?? 'SGD',
            this.searchProvider.name,
        ].join(':');
        const cached = await this.redis.get(key);
        if (cached) {
            try {
                return { offers: JSON.parse(cached), fromCache: true };
            }
            catch {
            }
        }
        const offers = await this.searchProvider.search(input);
        const redacted = offers.map(({ raw, ...rest }) => rest);
        await this.redis.set(key, JSON.stringify(redacted), SEARCH_CACHE_TTL_SECONDS);
        return { offers: redacted, fromCache: false };
    }
    rawHash(payload) {
        return (0, crypto_1.createHash)('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
    }
};
exports.AtlasService = AtlasService;
exports.AtlasService = AtlasService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService])
], AtlasService);
