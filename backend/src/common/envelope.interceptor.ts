import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 统一响应包装：所有成功响应包含 requestId 与 serverTime。
 * 契约来源：03 技术方案 §8「所有响应包含 requestId 和 serverTime」。
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const requestId: string =
      req.headers['x-request-id'] || `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    req.requestId = requestId;
    const res = http.getResponse();
    if (typeof res.header === 'function') res.header('x-request-id', requestId);

    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) {
          return { ok: true, requestId, serverTime: new Date().toISOString() };
        }
        if (typeof data === 'object' && !Array.isArray(data)) {
          return { ...data, requestId, serverTime: new Date().toISOString() };
        }
        return { data, requestId, serverTime: new Date().toISOString() };
      }),
    );
  }
}
