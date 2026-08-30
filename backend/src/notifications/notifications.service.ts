import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { PrismaService } from '../prisma.service';
import { loadEnv } from '../config/env';
import { maskEmail } from '../common/crypto';

export interface NotifyInput {
  userId: string;
  kind: 'PRICE_ALERT' | 'POLICY_CHANGE' | 'ORDER_EVENT' | 'SYSTEM';
  title: string;
  body: string;
  /** 英文文案（可选；EN 界面优先展示，缺省回退中文）。 */
  titleEn?: string;
  bodyEn?: string;
  /** P1-7：结构化事件键 + 参数；展示时按当前语言渲染，旧数据兼容回退 title/body。 */
  messageKey?: string;
  params?: Record<string, unknown>;
  deepLink?: string;
  planId?: string;
  monitorId?: string;
  isSimulated?: boolean;
  sendEmail?: boolean;
  /** false 时不写入 App 内通知箱（渠道开关必须被尊重，不能强制双发）。 */
  sendApp?: boolean;
}

/**
 * P1-7：结构化通知文案目录（zh/en）。展示时按当前语言渲染；
 * 旧数据无 messageKey 时兼容回退 titleEn/bodyEn → title/body。
 */
const NOTIFICATION_TEXT: Record<string, { zh: [string, string]; en: [string, string] }> = {
  'booking.leg1_failed': {
    zh: ['部分订单风险：第一段下单失败', '第二段已成功下单，第一段库存发生变化。后续支付已停止，可发起退款收尾处理。'],
    en: ['Partial order: leg 1 failed', 'Leg 2 was ordered but leg 1 hit an inventory change. Payment stopped; you can close out with a refund.'],
  },
  'booking.leg2_inventory': {
    zh: ['部分订单风险：第二段库存变化', '第二段库存发生变化，后续支付已停止，可发起退款收尾处理。'],
    en: ['Partial order: leg 2 inventory changed', 'Leg 2 inventory changed. Payment stopped; you can close out with a refund.'],
  },
  'booking.payment_submitted': {
    zh: ['支付已提交', '支付已提交，出票确认后将同步 PNR 与票号信息。'],
    en: ['Payment submitted', 'Payment submitted — PNR and ticket numbers will sync once ticketing is confirmed.'],
  },
  'booking.completed': {
    zh: ['预订完成', '两段订单均已支付成功，出票确认后将同步行程信息。'],
    en: ['Booking completed', 'Both legs paid — itinerary details will sync once ticketing is confirmed.'],
  },
  'booking.refund_completed': {
    zh: ['退款已完成', '退款已完成，没有发生真实资金交易。'],
    en: ['Refund completed', 'Refund completed. This is a simulated refund — no real funds moved.'],
  },
  'monitor.price_target': {
    zh: ['好价提醒：目标票价已到达', '{route} 当前两段合计约 {total} {currency}，达到你设置的目标价 {target} {currency}。价格随时可能变化，以验价结果为准。'],
    en: ['Price alert: target fare reached', '{route} now totals about {total} {currency}, hitting your target {target} {currency}. Prices can change; verification is authoritative.'],
  },
  'monitor.joyscore_target': {
    zh: ['体验分目标已达成', '方案 JoyScore {score} 达到你设置的 {target}，可查看详情并预订。'],
    en: ['JoyScore target reached', 'Plan JoyScore {score} reached your target {target}. View details and book.'],
  },
};

function fill(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

function renderNotification(lang: 'zh' | 'en', n: { title: string; body: string; titleEn: string | null; bodyEn: string | null; messageKey: string | null; paramsJson: unknown }): { title: string; body: string } {
  const params = (n.paramsJson ?? {}) as Record<string, unknown>;
  if (n.messageKey && NOTIFICATION_TEXT[n.messageKey]) {
    const [t, b] = NOTIFICATION_TEXT[n.messageKey][lang];
    return { title: fill(t, params), body: fill(b, params) };
  }
  if (lang === 'en' && (n.titleEn || n.bodyEn)) {
    return { title: n.titleEn ?? n.title, body: n.bodyEn ?? n.body };
  }
  return { title: n.title, body: n.body };
}

/**
 * 通知服务。契约（05/03 文档）：
 * - 邮件收件人恒为当前注册用户 users.email，不接受任何外部传入收件人。
 * - SMTP 465/secure；MAIL_PROVIDER=console 时只打日志（本地调试）。
 * - App 端本地通知由客户端 WorkManager 轮询 /notifications 实现。
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');
  private transporter: Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv();
    if (env.MAIL_PROVIDER === 'smtp' && env.SMTP_HOST) {
      this.transporter = createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      });
    } else {
      this.logger.warn('MAIL_PROVIDER=console or SMTP not configured; emails will be logged only.');
    }
  }

  /** 创建通知并按配置投递邮件。邮件失败不阻塞业务，只记录投递状态。 */
  async notify(input: NotifyInput) {
    const sendApp = input.sendApp !== false;
    const sendEmail = input.sendEmail !== false;
    // 两个渠道都关闭：不产生任何通知记录，避免假状态。
    if (!sendApp && !sendEmail) return { notificationId: null, skipped: true };

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        titleEn: input.titleEn,
        bodyEn: input.bodyEn,
        messageKey: input.messageKey,
        paramsJson: (input.params ?? null) as any,
        deepLink: input.deepLink,
        planId: input.planId,
        monitorId: input.monitorId,
        isSimulated: input.isSimulated ?? false,
      },
    });

    // App 本地通知渠道：客户端轮询时可见（渠道关闭时不写入）
    if (sendApp) {
      await this.prisma.notificationDelivery.create({
        data: { notificationId: notification.id, channel: 'APP', status: 'SENT', attempts: 1, sentAt: new Date() },
      });
    }

    if (sendEmail) {
      await this.deliverEmail(notification.id, input.userId, input.title, input.body);
    }
    return { notificationId: notification.id };
  }

  private async deliverEmail(notificationId: string, userId: string, subject: string, text: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const env = loadEnv();
    const masked = maskEmail(user.email);
    if (!this.transporter) {
      this.logger.log(`[mail:console] to=${masked} subject="${subject}"`);
      await this.prisma.notificationDelivery.create({
        data: { notificationId, channel: 'EMAIL', status: 'SENT', attempts: 1, maskedTo: masked, sentAt: new Date() },
      });
      return;
    }
    try {
      await this.transporter.sendMail({
        from: env.MAIL_FROM || `LayoverJoy <${env.SMTP_USER}>`,
        to: user.email,
        subject: `[LayoverJoy] ${subject}`,
        text,
      });
      await this.prisma.notificationDelivery.create({
        data: { notificationId, channel: 'EMAIL', status: 'SENT', attempts: 1, maskedTo: masked, sentAt: new Date() },
      });
    } catch (e) {
      this.logger.error(`email delivery failed for ${masked}: ${(e as Error).message}`);
      await this.prisma.notificationDelivery.create({
        data: {
          notificationId,
          channel: 'EMAIL',
          status: 'FAILED',
          attempts: 1,
          maskedTo: masked,
          lastError: (e as Error).message.slice(0, 500),
        },
      });
    }
  }

  async list(userId: string, unreadOnly: boolean, limit = 50, lang: 'zh' | 'en' = 'zh') {
    const items = await this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      notifications: items.map((n) => {
        // P1-7：结构化事件按当前语言渲染；messageKey 优先，其次 titleEn/bodyEn，最后回退 zh 存库文案。
        const rendered = renderNotification(lang, n);
        return {
          id: n.id,
          kind: n.kind,
          title: rendered.title,
          body: rendered.body,
          deepLink: n.deepLink,
          planId: n.planId,
          monitorId: n.monitorId,
          isSimulated: n.isSimulated,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        };
      }),
    };
  }

  async markRead(userId: string, notificationId: string) {
    const n = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!n) return { ok: false };
    if (!n.readAt) await this.prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
