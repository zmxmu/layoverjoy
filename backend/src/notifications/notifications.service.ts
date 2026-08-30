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
  deepLink?: string;
  planId?: string;
  monitorId?: string;
  isSimulated?: boolean;
  sendEmail?: boolean;
  /** false 时不写入 App 内通知箱（渠道开关必须被尊重，不能强制双发）。 */
  sendApp?: boolean;
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
      notifications: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: lang === 'en' ? (n.titleEn ?? n.title) : n.title,
        body: lang === 'en' ? (n.bodyEn ?? n.body) : n.body,
        deepLink: n.deepLink,
        planId: n.planId,
        monitorId: n.monitorId,
        isSimulated: n.isSimulated,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  async markRead(userId: string, notificationId: string) {
    const n = await this.prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!n) return { ok: false };
    if (!n.readAt) await this.prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
