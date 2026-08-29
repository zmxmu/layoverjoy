"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const errors_1 = require("./errors");
let GlobalExceptionFilter = class GlobalExceptionFilter {
    logger = new common_1.Logger('ExceptionFilter');
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse();
        const req = ctx.getRequest();
        const traceId = req?.requestId || `req_${(0, crypto_1.randomUUID)().replace(/-/g, '').slice(0, 16)}`;
        let status = 500;
        let code = 'INTERNAL_ERROR';
        let message = '服务器内部错误，请稍后重试。';
        let retryable = true;
        let details = {};
        if (exception instanceof errors_1.AppError) {
            status = exception.httpStatus;
            code = exception.code;
            message = exception.messageZh;
            retryable = exception.retryable;
            details = exception.details;
        }
        else if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const resp = exception.getResponse();
            code = resp?.code || (status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR');
            message = typeof resp?.message === 'string' ? resp.message : message;
            retryable = false;
            details = resp?.details || {};
        }
        else {
            this.logger.error(`unhandled error traceId=${traceId}`, exception?.stack);
        }
        if (typeof res.status === 'function') {
            res.status(status).send({ error: { code, message, retryable, traceId, details } });
        }
    }
};
exports.GlobalExceptionFilter = GlobalExceptionFilter;
exports.GlobalExceptionFilter = GlobalExceptionFilter = __decorate([
    (0, common_1.Catch)(),
    (0, common_1.Injectable)()
], GlobalExceptionFilter);
