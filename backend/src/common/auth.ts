import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from './errors';

export interface AuthUser {
  userId: string;
  email: string;
}

/** JWT Bearer 守卫：校验 Access Token 并附加用户信息。 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw AppError.unauthorized();
    try {
      const payload = this.jwt.verify(token, { audience: 'layoverjoy-access' });
      req.user = { userId: payload.sub, email: payload.email } as AuthUser;
      return true;
    } catch {
      throw AppError.unauthorized();
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
