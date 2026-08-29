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
exports.WebhookDebugController = exports.WebhookController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const webhook_service_1 = require("./webhook.service");
const env_1 = require("../config/env");
let WebhookController = class WebhookController {
    webhooks;
    constructor(webhooks) {
        this.webhooks = webhooks;
    }
    async receive(sharedToken, body, res) {
        if (!this.webhooks.verifyToken(sharedToken)) {
            return res.status(common_1.HttpStatus.OK).send({ received: true });
        }
        await this.webhooks.ingest(body);
        return res.status(common_1.HttpStatus.OK).send({ received: true });
    }
};
exports.WebhookController = WebhookController;
__decorate([
    (0, common_1.Post)(':sharedToken'),
    __param(0, (0, common_1.Param)('sharedToken')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], WebhookController.prototype, "receive", null);
exports.WebhookController = WebhookController = __decorate([
    (0, swagger_1.ApiTags)('webhooks'),
    (0, common_1.Controller)('api/webhooks/atlas'),
    __metadata("design:paramtypes", [webhook_service_1.WebhookService])
], WebhookController);
let WebhookDebugController = class WebhookDebugController {
    webhooks;
    constructor(webhooks) {
        this.webhooks = webhooks;
    }
    async simulate(adminToken, body, res) {
        const env = (0, env_1.loadEnv)();
        if (env.NODE_ENV === 'production' || env.WEBHOOK_MODE !== 'simulate' || !env.ADMIN_DEBUG_TOKEN || adminToken !== env.ADMIN_DEBUG_TOKEN) {
            return res.status(common_1.HttpStatus.FORBIDDEN).send({ error: { code: 'FORBIDDEN', message: '该接口未开放。', retryable: false } });
        }
        const result = await this.webhooks.ingest(body);
        return res.status(common_1.HttpStatus.OK).send(result);
    }
};
exports.WebhookDebugController = WebhookDebugController;
__decorate([
    (0, common_1.Post)('simulate'),
    __param(0, (0, common_1.Headers)('x-admin-token')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], WebhookDebugController.prototype, "simulate", null);
exports.WebhookDebugController = WebhookDebugController = __decorate([
    (0, swagger_1.ApiTags)('debug'),
    (0, common_1.Controller)('api/debug/webhooks/atlas'),
    __metadata("design:paramtypes", [webhook_service_1.WebhookService])
], WebhookDebugController);
