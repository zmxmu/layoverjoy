import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { PrismaService } from '../prisma.service';
import { AppError } from '../common/errors';
import { UsersService } from '../users/users.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: { email: string; password: string; displayName?: string; timezone?: string; residenceCountry?: string }) {
    if (!body?.email || !body?.password) throw AppError.validation(['email', 'password']);
    return this.auth.register({
      email: body.email,
      password: body.password,
      displayName: body.displayName || '',
      timezone: body.timezone,
      residenceCountry: body.residenceCountry,
    });
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    if (!body?.email || !body?.password) throw AppError.validation(['email', 'password']);
    const result = await this.auth.login(body);
    return { user: { id: result.userId }, ...result };
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    if (!body?.refreshToken) throw AppError.validation(['refreshToken']);
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Body() body: { refreshToken?: string }) {
    if (body?.refreshToken) await this.auth.logout(body.refreshToken);
    return { ok: true };
  }
}

@ApiTags('me')
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** P1-4：onboarding 完成时原子写入护照 + 选中签证（事务；签证为空允许跳过）。 */
  @Post('onboarding')
  async onboarding(
    @CurrentUser() user: AuthUser,
    @Body() body: { passport: { countryCode: string; passportType?: string; expiresOn?: string }; visas?: string[] },
  ) {
    if (!body?.passport?.countryCode || !/^[A-Z]{2}$/.test(body.passport.countryCode)) {
      throw AppError.validation(['passport.countryCode']);
    }
    return this.users.completeOnboarding(user.userId, {
      passport: body.passport,
      visas: body.visas ?? [],
    });
  }

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!u) throw AppError.unauthorized();
    const wallet = await this.users.walletSummary(u.id);
    return {
      user: {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        residenceCountry: u.residenceCountry,
        timezone: u.timezone,
        preferences: u.preferencesJson ?? null,
      },
      wallet,
    };
  }

  @Patch()
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: { displayName?: string; timezone?: string; residenceCountry?: string; preferences?: Record<string, unknown> }) {
    const u = await this.prisma.user.update({
      where: { id: user.userId },
      data: {
        displayName: body.displayName,
        timezone: body.timezone,
        residenceCountry: body.residenceCountry,
        preferencesJson: body.preferences ? (body.preferences as any) : undefined,
      },
    });
    return {
      user: {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        residenceCountry: u.residenceCountry,
        timezone: u.timezone,
        preferences: u.preferencesJson ?? null,
      },
    };
  }
}
