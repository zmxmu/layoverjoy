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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./config/env");
let RedisService = class RedisService {
    client = null;
    memory = new Map();
    connected = false;
    constructor() {
        const env = (0, env_1.loadEnv)();
        try {
            this.client = new ioredis_1.default(env.REDIS_URL, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                enableOfflineQueue: false,
                connectTimeout: 3000,
            });
            this.client
                .connect()
                .then(() => (this.connected = true))
                .catch(() => (this.connected = false));
            this.client.on('error', () => (this.connected = false));
        }
        catch {
            this.client = null;
        }
    }
    isReady() {
        return this.connected;
    }
    async get(key) {
        if (this.connected && this.client) {
            try {
                return await this.client.get(key);
            }
            catch {
            }
        }
        const item = this.memory.get(key);
        if (!item)
            return null;
        if (item.exp < Date.now()) {
            this.memory.delete(key);
            return null;
        }
        return item.v;
    }
    async set(key, value, ttlSeconds) {
        if (this.connected && this.client) {
            try {
                await this.client.set(key, value, 'EX', ttlSeconds);
                return;
            }
            catch {
            }
        }
        this.memory.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
    }
    async rateLimit(key, max, windowSeconds) {
        if (this.connected && this.client) {
            try {
                const n = await this.client.incr(key);
                if (n === 1)
                    await this.client.expire(key, windowSeconds);
                return n <= max;
            }
            catch {
            }
        }
        const item = this.memory.get(key);
        const now = Date.now();
        if (!item || item.exp < now) {
            this.memory.set(key, { v: '1', exp: now + windowSeconds * 1000 });
            return true;
        }
        const n = Number(item.v) + 1;
        this.memory.set(key, { v: String(n), exp: item.exp });
        return n <= max;
    }
    async onModuleDestroy() {
        try {
            await this.client?.quit();
        }
        catch {
        }
    }
};
exports.RedisService = RedisService;
exports.RedisService = RedisService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], RedisService);
