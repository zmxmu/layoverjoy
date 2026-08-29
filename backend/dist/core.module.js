"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreModule = exports.FIELD_CRYPTO = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const env_1 = require("./config/env");
const crypto_1 = require("./common/crypto");
exports.FIELD_CRYPTO = 'FIELD_CRYPTO';
let CoreModule = class CoreModule {
};
exports.CoreModule = CoreModule;
exports.CoreModule = CoreModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            jwt_1.JwtModule.registerAsync({
                useFactory: () => {
                    const env = (0, env_1.loadEnv)();
                    return {
                        secret: env.JWT_SECRET,
                        signOptions: { expiresIn: '15m', audience: 'layoverjoy-access' },
                    };
                },
            }),
        ],
        providers: [
            prisma_service_1.PrismaService,
            redis_service_1.RedisService,
            {
                provide: exports.FIELD_CRYPTO,
                useFactory: () => new crypto_1.FieldCrypto((0, env_1.loadEnv)().DATA_ENCRYPTION_KEY),
            },
        ],
        exports: [prisma_service_1.PrismaService, redis_service_1.RedisService, jwt_1.JwtModule, exports.FIELD_CRYPTO],
    })
], CoreModule);
