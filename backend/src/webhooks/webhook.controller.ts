import { Body, Controller, Headers, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { WebhookService } from './webhook.service';
import { loadEnv } from '../config/env';

/**
 * Atlas Webhook 接收端点（07 文档 §3/§5）。
 * 一律返回 200 避免 Atlas 重试风暴；无效事件静默丢弃并记录。
 */
@ApiTags('webhooks')
@Controller('api/webhooks/atlas')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post(':sharedToken')
  async receive(
    @Param('sharedToken') sharedToken: string,
    @Body() body: unknown,
    @Res() res: FastifyReply,
  ) {
    if (!this.webhooks.verifyToken(sharedToken)) {
      // 不暴露失败原因细节，避免探测
      return res.status(HttpStatus.OK).send({ received: true });
    }
    await this.webhooks.ingest(body);
    return res.status(HttpStatus.OK).send({ received: true });
  }
}

/** Debug simulate（07 文档 §5）：仅 WEBHOOK_MODE=simulate 且持有管理员 token 时开放。 */
@ApiTags('debug')
@Controller('api/debug/webhooks/atlas')
export class WebhookDebugController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post('simulate')
  async simulate(@Headers('x-admin-token') adminToken: string, @Body() body: any, @Res() res: FastifyReply) {
    const env = loadEnv();
    if (env.NODE_ENV === 'production' || env.WEBHOOK_MODE !== 'simulate' || !env.ADMIN_DEBUG_TOKEN || adminToken !== env.ADMIN_DEBUG_TOKEN) {
      return res.status(HttpStatus.FORBIDDEN).send({ error: { code: 'FORBIDDEN', message: '该接口未开放。', retryable: false } });
    }
    const result = await this.webhooks.ingest(body);
    return res.status(HttpStatus.OK).send(result);
  }
}
