import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { loadEnv } from './config/env';
import { AtlasService } from './atlas/atlas.service';
import { PrismaService } from './prisma.service';

/** 健康检查与集成状态（不含任何 Secret）。 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly atlas: AtlasService,
  ) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'layoverjoy-backend' };
  }

  /** 集成面板：Demo 现场可验证每个赞助商/外部系统的接入状态。 */
  @Get('integrations')
  async integrations() {
    const env = loadEnv();
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    return {
      runtime: {
        target: env.RUNTIME_TARGET,
        atlasMode: env.ATLAS_MODE,
        webhookMode: env.WEBHOOK_MODE,
        daytonaMode: env.DAYTONA_MODE,
        mailProvider: env.MAIL_PROVIDER,
      },
      atlas: {
        searchProvider: this.atlas.searchProviderLabel(),
        verifyProvider: this.atlas.providerLabel(this.atlas.verify),
        orderProvider: this.atlas.providerLabel(this.atlas.order),
        paymentProvider: this.atlas.providerLabel(this.atlas.payment),
        refundProvider: this.atlas.providerLabel(this.atlas.refund),
        sandboxConfigured: Boolean(env.ATLAS_CLIENT_ID && env.ATLAS_CLIENT_SECRET),
      },
      nosana: {
        provider: env.INFERENCE_PROVIDER,
        configured: Boolean(env.NOSANA_API_KEY && env.NOSANA_OPENAI_BASE_URL),
        model: env.NOSANA_MODEL,
      },
      daytona: {
        mode: env.DAYTONA_MODE,
        snapshot: env.DAYTONA_SNAPSHOT,
        region: env.DAYTONA_TARGET_REGION,
        apiKeyConfigured: Boolean(env.DAYTONA_API_KEY),
      },
      mail: {
        provider: env.MAIL_PROVIDER,
        recipientSource: 'current_user', // 契约：收件人恒为当前注册用户
      },
      database: db,
    };
  }
}
