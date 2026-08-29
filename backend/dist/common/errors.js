"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCodes = exports.AppError = void 0;
class AppError extends Error {
    code;
    messageZh;
    httpStatus;
    retryable;
    details;
    constructor(code, messageZh, httpStatus = 400, retryable = false, details = {}) {
        super(code);
        this.code = code;
        this.messageZh = messageZh;
        this.httpStatus = httpStatus;
        this.retryable = retryable;
        this.details = details;
    }
    static validation(fields, message = '请检查输入内容。') {
        return new AppError('VALIDATION_ERROR', message, 400, false, { fields });
    }
    static unauthorized() {
        return new AppError('UNAUTHORIZED', '请先登录。', 401);
    }
    static forbidden() {
        return new AppError('FORBIDDEN', '没有权限访问该资源。', 403);
    }
    static notFound(what = '资源') {
        return new AppError('NOT_FOUND', `未找到${what}。`, 404);
    }
    static internal() {
        return new AppError('INTERNAL_ERROR', '服务器内部错误，请稍后重试。', 500, true);
    }
}
exports.AppError = AppError;
exports.ErrorCodes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    UNSUPPORTED_AIRPORT: 'UNSUPPORTED_AIRPORT',
    NO_SANDBOX_INVENTORY: 'NO_SANDBOX_INVENTORY',
    ATLAS_PARTIAL_RESULT: 'ATLAS_PARTIAL_RESULT',
    ATLAS_TIMEOUT: 'ATLAS_TIMEOUT',
    PRICE_CHANGED: 'PRICE_CHANGED',
    OFFER_EXPIRED: 'OFFER_EXPIRED',
    NO_FLIGHTS: 'NO_FLIGHTS',
    INVENTORY_UNAVAILABLE: 'INVENTORY_UNAVAILABLE',
    PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
    PROVIDER_OUTCOME_UNKNOWN: 'PROVIDER_OUTCOME_UNKNOWN',
    AI_EXPLANATION_UNAVAILABLE: 'AI_EXPLANATION_UNAVAILABLE',
    PARTIAL_BOOKING: 'PARTIAL_BOOKING',
    EMAIL_UNAVAILABLE: 'EMAIL_UNAVAILABLE',
    DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
};
