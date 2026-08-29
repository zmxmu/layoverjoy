import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppError } from './errors';

/**
 * 全局异常过滤器：输出统一错误结构
 * { error: { code, message, retryable, traceId, details } }
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const traceId = req?.requestId || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '服务器内部错误，请稍后重试。';
    let retryable = true;
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.messageZh;
      retryable = exception.retryable;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse() as any;
      code = resp?.code || (status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR');
      message = typeof resp?.message === 'string' ? resp.message : message;
      retryable = false;
      details = resp?.details || {};
    } else {
      this.logger.error(`unhandled error traceId=${traceId}`, (exception as Error)?.stack);
    }

    if (typeof res.status === 'function') {
      res.status(status).send({ error: { code, message, retryable, traceId, details } });
    }
  }
}
