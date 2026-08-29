import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { AppError } from '../common/errors';
import { maskEmail } from '../common/crypto';

const REFRESH_TTL_DAYS = 7;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(input: { email: string; password: string; displayName: string; timezone?: string; residenceCountry?: string }) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw AppError.validation(['email'], '邮箱格式不正确。');
    }
    if (input.password.length < 8) {
      throw AppError.validation(['password'], '密码至少 8 位。');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('DUPLICATE_EMAIL', '该邮箱已注册，请直接登录。', 409);
    }
    const passwordHash = await argon2.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: input.displayName || email.split('@')[0],
        timezone: input.timezone || 'Asia/Shanghai',
        residenceCountry: input.residenceCountry,
      },
    });
    return this.issueTokens(user.id, user.email);
  }

  async login(input: { email: string; password: string }): Promise<TokenPair & { userId: string }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user ? await argon2.verify(user.passwordHash, input.password) : false;
    if (!user || !ok || user.status !== 'ACTIVE') {
      throw new AppError('INVALID_CREDENTIALS', '邮箱或密码不正确。', 401);
    }
    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, userId: user.id };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw AppError.unauthorized();
    }
    // Refresh Token 旋转：旧的作废
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) throw AppError.unauthorized();
    return this.issueTokens(user.id, user.email);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, email: string): Promise<TokenPair> {
    const accessToken = this.jwt.sign({ sub: userId, email });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
