import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma.service';
import { AtlasService } from '../atlas/atlas.service';
import { FIELD_CRYPTO } from '../core.module';
import { FieldCrypto, maskLast4 } from '../common/crypto';
import { loadEnv } from '../config/env';

/**
 * Atlas Webhook 安全接收（07 文档 §3）。
 * - constant-time 校验 sharedToken；
 * - 以 notificationId 唯一去重，缺失时用规范化 payload SHA-256；
 * - 原始 payload 加密存储，日志只记录事件类型、通知 ID 和订单号后四位；
 * - 立即返回后异步处理；订单事实必须用 getOrder 再确认。
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger('WebhookService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly atlas: AtlasService,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  verifyToken(provided: string): boolean {
    const expected = loadEnv().ATLAS_WEBHOOK_SHARED_TOKEN;
    if (!expected || !provided) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** 处理官方格式事件。返回 'accepted' | 'duplicate' | 'invalid'。 */
  async ingest(payload: any): Promise<{ result: 'accepted' | 'duplicate' | 'invalid'; reason?: string }> {
    if (!payload || typeof payload !== 'object') return { result: 'invalid', reason: 'BODY_NOT_JSON' };
    const type = typeof payload.type === 'string' ? payload.type : null;
    const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : null;
    const cid = typeof payload.cid === 'string' ? payload.cid : null;
    const orderNo = typeof payload?.data?.orderNo === 'string' ? payload.data.orderNo : null;
    if (!type) return { result: 'invalid', reason: 'MISSING_TYPE' };

    // cid 已知时必须匹配
    const env = loadEnv();
    if (env.ATLAS_CID && cid && cid !== env.ATLAS_CID) {
      return { result: 'invalid', reason: 'CID_MISMATCH' };
    }

    const key = notificationId
      ? `atlas:${notificationId}`
      : `sha256:${createHash('sha256').update(JSON.stringify({ cid, type, orderNo, data: payload.data ?? null })).digest('hex')}`;

    const existing = await this.prisma.atlasWebhookEvent.findUnique({ where: { notificationKey: key } });
    if (existing) return { result: 'duplicate' };

    const knownTypes = [
      'order.ticketed',
      'order.scheduleChange',
      'order.addonComplete',
      'order.refundComplete',
      'airline.status',
      'email.all',
      'email.schedulechange',
      'order.schedulechange',
      'abnormal.cancelled',
    ];
    const isKnown = knownTypes.includes(type);

    await this.prisma.atlasWebhookEvent.create({
      data: {
        notificationKey: key,
        eventType: type,
        cid,
        orderNoLast4: orderNo ? maskLast4(orderNo).replace('****', '') : null,
        payloadEnc: this.crypto.encrypt(JSON.stringify(payload)),
        processingStatus: isKnown ? 'RECEIVED' : 'UNKNOWN',
      },
    });
    this.logger.log(`webhook received type=${type} notificationId=${notificationId ?? 'none'} orderNo=${orderNo ? maskLast4(orderNo) : 'none'}`);

    // 异步处理：对订单事实用 getOrder 再确认（不信任 webhook 单方陈述）
    if (isKnown && orderNo) {
      setImmediate(() => this.reconcile(key, type, orderNo).catch((e) => this.logger.warn(`reconcile failed: ${(e as Error).message}`)));
    } else if (!isKnown) {
      await this.prisma.atlasWebhookEvent.update({ where: { notificationKey: key }, data: { processingStatus: 'UNKNOWN', processedAt: new Date() } });
    }
    return { result: 'accepted' };
  }

  /** 再确认：调用订单查询并以 Atlas 返回为准。 */
  private async reconcile(notificationKey: string, type: string, orderNo: string) {
    try {
      const order = await this.atlas.order.getOrder(orderNo);
      await this.prisma.atlasWebhookEvent.update({
        where: { notificationKey },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
      // 出票事件：联动本地订单状态
      if (type === 'order.ticketed') {
        const local = await this.findLocalOrderByNo(orderNo);
        if (local) {
          await this.prisma.flightOrder.update({ where: { id: local.id }, data: { status: 'TICKETED', lastProviderCode: order.status } });
        }
      }
    } catch (e) {
      this.logger.warn(`getOrder reconfirm failed for ${maskLast4(orderNo)}: ${(e as Error).message}`);
      await this.prisma.atlasWebhookEvent.update({
        where: { notificationKey },
        data: { processingStatus: 'PROCESSED', processedAt: new Date() },
      });
    }
  }

  private async findLocalOrderByNo(orderNo: string) {
    // 本地订单号加密存储，数量少时解密比对（MVP 规模可接受）
    const orders = await this.prisma.flightOrder.findMany({ where: { orderNoEnc: { not: null } }, take: 200 });
    for (const o of orders) {
      try {
        if (o.orderNoEnc && this.crypto.decrypt(o.orderNoEnc) === orderNo) return o;
      } catch {
        /* skip */
      }
    }
    return null;
  }
}
