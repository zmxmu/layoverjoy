/**
 * 统一错误模型。code 是稳定枚举，Android 按 code 分支，不依赖 message。
 * 契约来源：qoder-input/fixtures/contracts/error-response-samples.json
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageZh: string,
    public readonly httpStatus: number = 400,
    public readonly retryable: boolean = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }

  static validation(fields: string[], message = '请检查输入内容。') {
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

/** 稳定的业务错误码枚举（供后端与 Android 对齐）。 */
export const ErrorCodes = {
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
} as const;
