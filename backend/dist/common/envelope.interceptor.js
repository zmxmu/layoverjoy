"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseEnvelopeInterceptor = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const operators_1 = require("rxjs/operators");
let ResponseEnvelopeInterceptor = class ResponseEnvelopeInterceptor {
    intercept(context, next) {
        const http = context.switchToHttp();
        const req = http.getRequest();
        const requestId = req.headers['x-request-id'] || `req_${(0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 16)}`;
        req.requestId = requestId;
        const res = http.getResponse();
        if (typeof res.header === 'function')
            res.header('x-request-id', requestId);
        return next.handle().pipe((0, operators_1.map)((data) => {
            if (data === undefined || data === null) {
                return { ok: true, requestId, serverTime: new Date().toISOString() };
            }
            if (typeof data === 'object' && !Array.isArray(data)) {
                return { ...data, requestId, serverTime: new Date().toISOString() };
            }
            return { data, requestId, serverTime: new Date().toISOString() };
        }));
    }
};
exports.ResponseEnvelopeInterceptor = ResponseEnvelopeInterceptor;
exports.ResponseEnvelopeInterceptor = ResponseEnvelopeInterceptor = __decorate([
    (0, common_1.Injectable)()
], ResponseEnvelopeInterceptor);
