import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { AtlasService } from '../atlas/atlas.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntryRulesService } from '../entry-rules/entry-rules.service';
import { UsersService } from '../users/users.service';
import { AppError } from '../common/errors';
import { FIELD_CRYPTO } from '../core.module';
import { FieldCrypto, maskLast4 } from '../common/crypto';
import { PaymentResult } from '../atlas/atlas.types';
import { loadEnv } from '../config/env';

export interface CompositeOrderInput {
  planId: string;
  riskAckVersion: number;
  passengers?: Array<{ givenName?: string; familyName?: string }>;
  /** 演示注入：停留段（第二段）成功下单后，第一段下单失败（INVENTORY_CHANGED） */
  legBFailure?: boolean;
}

const SCHEMA_VERSION = 1;

/**
 * 双订单预订 Saga（07 文档 §6/§7）。
 * 状态机：DRAFT -> BOTH_VERIFIED -> LEG_B_ORDERING -> LEG_B_ORDERED ->
 *         LEG_A_ORDERING -> BOTH_ORDERED -> PAYMENT_PENDING -> COMPLETED
 * 异常：PARTIAL_ORDER / SIMULATED_REFUND_PENDING / SIMULATED_REFUNDED / MANUAL_REVIEW / EXPIRED
 *
 * 执行原则：
 * - 同时 Verify 两段，任一失败不创建订单；
 * - 两段均 Verify 后才做预订期资格硬判定（BOOKING 模式，续程票已确认），不通过不下单；
 * - 状态迁移由实际成功下单的腿集合（orderedLegs）驱动，绝不根据假设推进；
 * - Order/Pay 保存独立 idempotency key，但绝不自动重放；
 * - 任一段成功、另一段失败 → 立即停止支付，进入 PARTIAL_ORDER；
 * - 补偿退款必须标注“没有发生真实资金交易”。
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger('BookingsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly atlas: AtlasService,
    private readonly notifications: NotificationsService,
    private readonly rules: EntryRulesService,
    private readonly users: UsersService,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  /** 创建复合订单：Verify 两段 → 依次下单 → PAYMENT_PENDING。 */
  async createComposite(userId: string, input: CompositeOrderInput) {
    if (!input.planId) throw AppError.validation(['planId']);
    if (!input.riskAckVersion || input.riskAckVersion < 1) {
      throw AppError.validation(['riskAckVersion'], '请先确认独立机票风险后再预订。');
    }
    const plan = await this.prisma.stopoverPlan.findFirst({ where: { id: input.planId, searchRun: { userId } } });
    if (!plan) throw AppError.notFound('方案');

    const legs = await this.prisma.flightOfferSnapshot.findMany({
      where: { id: { in: (plan.legOfferIdsJson as string[]) ?? [] } },
      orderBy: { legNo: 'asc' },
    });
    if (legs.length === 0) throw AppError.notFound('航段报价');

    const intentKey = randomUUID();
    const intent = await this.prisma.bookingIntent.create({
      data: {
        userId,
        planId: plan.id,
        schemaVersion: SCHEMA_VERSION,
        planSnapshotJson: {
          planId: plan.id,
          planType: plan.planType,
          stopoverCityId: plan.stopoverCityId,
          stayDays: plan.stayDays,
          airfareTotal: plan.airfareTotal,
          currency: plan.currency,
          costBreakdown: plan.costBreakdownJson,
          joyScore: plan.joyScore,
          legs: legs.map((l) => ({
            legNo: l.legNo,
            providerOfferId: l.providerOfferId,
            origin: l.origin,
            destination: l.destination,
            departureAt: l.departureAt.toISOString(),
            totalPrice: l.totalPrice,
            sourceProvider: l.sourceProvider,
          })),
        } as any,
        sourceEnvironment: plan.sourceProvider,
        isSimulated: true,
        status: 'DRAFT',
        // 乘机人姓名属个人敏感信息：落库前逐字段加密，不存明文。
        passengerJson: (input.passengers ?? []).map((p) => ({
          givenNameEnc: p.givenName ? this.crypto.encrypt(p.givenName) : null,
          familyNameEnc: p.familyName ? this.crypto.encrypt(p.familyName) : null,
        })) as any,
        acceptedTotal: plan.airfareTotal,
        currency: plan.currency,
        riskAckVersion: input.riskAckVersion,
        idempotencyKey: intentKey,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // Atlas 未付款库存约 30 分钟自动释放
      },
    });

    const transition = (status: string, extra: Record<string, unknown> = {}) =>
      this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status, ...extra } });

    // 1) 同时 Verify 两段（任一失败不创建订单）
    const verifyResults = await Promise.allSettled(
      legs.map(async (leg) => {
        const verified = await this.atlas.verify.verify(leg.providerOfferId);
        return { leg, verified };
      }),
    );
    const failed = verifyResults.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      const cause = (failed[0] as PromiseRejectedResult).reason as AppError;
      await transition('EXPIRED', { verifyResultJson: { ok: false, error: cause.code || 'VERIFY_FAILED' } as any });
      if (cause.code === 'PRICE_CHANGED') {
        throw new AppError('PRICE_CHANGED', '价格已变化，请返回结果页刷新后重试。', 409, false, {
          intentId: intent.id,
        });
      }
      throw new AppError(cause.code || 'INVENTORY_UNAVAILABLE', cause.messageZh || '验价失败，请稍后重试。', 409, true, {
        intentId: intent.id,
      });
    }

    const verifiedLegs = verifyResults.map((r) => (r as PromiseFulfilledResult<any>).value);
    const priceChanged = verifiedLegs.find((v: any) => v.verified.priceChanged);
    const verifySummary = verifiedLegs.map((v: any) => ({
      legNo: v.leg.legNo,
      providerOfferId: v.leg.providerOfferId,
      sessionId: v.verified.sessionId ?? null,
      totalPrice: v.verified.totalPrice,
      priceChanged: v.verified.priceChanged,
      bookable: v.verified.bookable,
    }));
    if (priceChanged) {
      await transition('EXPIRED', { verifyResultJson: { ok: false, verify: verifySummary } as any });
      throw new AppError('PRICE_CHANGED', '价格已变化，请返回结果页刷新后重试。', 409, false, { intentId: intent.id });
    }
    await transition('BOTH_VERIFIED', {
      verifyResultJson: { ok: true, verify: verifySummary } as any,
      priceConfirmedAt: new Date(),
    });

    // 2) 预订期资格硬判定（BOOKING 模式）：两段均 Verify 后续程票才算确认；
    //    搜索期的初筛结果不能直接用于下单。
    if (plan.hubCountry) {
      const run = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
      const profile = await this.users.profileForRules(userId);
      const bookingEligibility = await this.rules.evaluate({
        travelDate: run ? new Date(run.departureDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        purpose: 'TOURISM',
        stayDays: plan.stayDays,
        passport: profile.passport,
        visas: profile.visas,
        destinationCountry: plan.hubCountry,
        onwardTicketConfirmed: true,
        mode: 'BOOKING',
      });
      if (bookingEligibility.status !== 'ELIGIBLE') {
        await transition('EXPIRED', {
          verifyResultJson: { ok: false, bookingEligibility: bookingEligibility.status, reasonCodes: bookingEligibility.reasonCodes } as any,
        });
        throw new AppError(
          'BOOKING_ELIGIBILITY_FAILED',
          '预订期入境资格复核未通过，已停止下单。请更新证件信息后重新搜索。',
          409,
          false,
          { intentId: intent.id, reasonCodes: bookingEligibility.reasonCodes },
        );
      }
    }

    // 3) 依次下单。先下停留段（第二段库存风险更高）。状态由实际成功的腿集合驱动。
    //    演示注入：legBFailure 在第二段成功下单后让第一段返回 INVENTORY_CHANGED。
    const orderSequence = [...verifiedLegs].sort((a: any, b: any) => b.leg.legNo - a.leg.legNo);
    const orderedLegs: number[] = [];

    for (const item of orderSequence) {
      const legNo = item.leg.legNo;
      await transition(legNo === 1 ? 'LEG_A_ORDERING' : 'LEG_B_ORDERING');

      if (input.legBFailure && legNo === 1 && orderedLegs.length > 0) {
        await this.recordOrderFailure(intent.id, legNo, 'INVENTORY_CHANGED');
        await transition('PARTIAL_ORDER');
        await this.notifications.notify({
          userId,
          kind: 'ORDER_EVENT',
          title: '部分订单风险：第一段下单失败',
          body: '第二段已成功下单，第一段库存变化（INVENTORY_CHANGED）。后续支付已停止，可发起补偿退款。补偿退款不会发生真实资金交易。',
          deepLink: `layoverjoy://bookings/${intent.id}`,
          planId: plan.id,
          isSimulated: true,
        });
        throw new AppError('PARTIAL_BOOKING', '第二段已下单，第一段库存变化导致下单失败。已停止支付，可执行补偿。', 409, false, {
          intentId: intent.id,
          failedLeg: legNo,
          providerCode: 'INVENTORY_CHANGED',
        });
      }

      try {
        const idemKey = `${intentKey}:leg${legNo}`;
        const result = await this.atlas.order.createOrder({
          bookingReference: item.verified.sessionId || item.leg.providerOfferId,
          passengers: input.passengers ?? [],
          idempotencyKey: idemKey,
        });
        await this.prisma.flightOrder.create({
          data: {
            bookingIntentId: intent.id,
            legNo,
            provider: this.atlas.providerLabel(this.atlas.order),
            orderNoEnc: this.crypto.encrypt(result.orderNo),
            verifySessionIdEnc: item.verified.sessionId ? this.crypto.encrypt(item.verified.sessionId) : null,
            status: 'CREATED',
            amount: result.amount ?? item.verified.totalPrice,
            currency: result.currency ?? item.verified.currency,
            idempotencyKey: idemKey,
          },
        });
        this.logger.log(`intent ${intent.id} leg ${legNo} ordered: ${maskLast4(result.orderNo)}`);
        orderedLegs.push(legNo);
        // 状态只反映真实进度：两段都成功才进入 BOTH_ORDERED。
        await transition(
          orderedLegs.length === verifiedLegs.length
            ? 'BOTH_ORDERED'
            : legNo === 2
              ? 'LEG_B_ORDERED'
              : 'LEG_A_ORDERED',
        );
      } catch (e) {
        const code = (e as AppError).code || 'ORDER_FAILED';
        await this.recordOrderFailure(intent.id, legNo, code);
        if (orderedLegs.length > 0) {
          // 已有真实订单、另一段失败：立即停止后续支付，进入补偿流程。
          await transition('PARTIAL_ORDER');
          throw new AppError('PARTIAL_BOOKING', `第${orderedLegs[0]}段已下单，第${legNo}段下单失败。已停止支付，可执行补偿。`, 409, false, {
            intentId: intent.id,
            failedLeg: legNo,
            orderedLegs,
            providerCode: code,
          });
        }
        // 尚无任何订单：无需补偿，转人工复核。
        await transition('MANUAL_REVIEW');
        throw new AppError(code, (e as Error).message || '下单失败，请稍后重试。', 409, false, {
          intentId: intent.id,
          failedLeg: legNo,
          orderedLegs,
        });
      }
    }

    await transition('PAYMENT_PENDING');
    return this.get(intent.id, userId);
  }

  private async recordOrderFailure(intentId: string, legNo: number, code: string) {
    await this.prisma.auditEvent.create({
      data: { action: 'ORDER_FAILED', entity: 'BookingIntent', entityId: intentId, detailJson: { legNo, code } as any },
    });
  }

  /** 模拟支付：按订单顺序支付所有 CREATED 订单。Mock 通过订单号控制结果。 */
  async mockPay(userId: string, intentId: string, demoPayResult?: string) {
    const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
    if (!intent) throw AppError.notFound('订单');
    if (intent.status !== 'PAYMENT_PENDING' && intent.status !== 'BOTH_ORDERED') {
      throw new AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 不可支付。`, 409);
    }
    const orders = await this.prisma.flightOrder.findMany({
      where: { bookingIntentId: intent.id, status: 'CREATED' },
      orderBy: { legNo: 'asc' },
    });
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
      const idemKey = `${order.idempotencyKey}:pay`;
      // 演示注入（客户端开发页开关，经 X-Demo-Pay-Result 头传入）：第一段支付必然失败。
      // 仅在 Mock 支付提供方下生效，避免影响真实链路；失败走既有补偿分支，状态诚实流转。
      let result: PaymentResult;
      if (demoPayResult === 'FAIL' && i === 0 && this.atlas.providerLabel(this.atlas.payment) !== 'ATLAS_SANDBOX') {
        await this.prisma.auditEvent.create({
          data: { action: 'DEMO_PAY_FAILURE_INJECTED', entity: 'BookingIntent', entityId: intent.id, detailJson: { legNo: order.legNo } as any },
        });
        result = { status: 'FAILED', providerCode: 'PAY_DECLINED' };
      } else {
        result = await this.atlas.payment.pay({ orderNo, idempotencyKey: idemKey });
      }
      if (result.status === 'PAID') {
        await this.prisma.flightOrder.update({
          where: { id: order.id },
          data: { status: 'PAID', lastProviderCode: result.providerCode ?? 'PAID' },
        });
      } else if (result.status === 'UNKNOWN') {
        await this.prisma.flightOrder.update({ where: { id: order.id }, data: { lastProviderCode: 'UNKNOWN' } });
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'MANUAL_REVIEW' } });
        throw new AppError('PROVIDER_OUTCOME_UNKNOWN', '支付结果未知，已转入人工复核。请勿重复支付。', 409, false, {
          intentId: intent.id,
          legNo: order.legNo,
        });
      } else {
        await this.prisma.flightOrder.update({
          where: { id: order.id },
          data: { status: 'FAILED', lastProviderCode: result.providerCode ?? 'PAY_FAILED' },
        });
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'PARTIAL_ORDER' } });
        throw new AppError('PARTIAL_BOOKING', '支付失败，订单进入部分完成状态，可执行补偿。', 409, false, {
          intentId: intent.id,
          legNo: order.legNo,
        });
      }
    }
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'COMPLETED' } });
    await this.notifications.notify({
      userId,
      kind: 'ORDER_EVENT',
      title: '预订完成',
      body: '两段订单均已支付成功，出票确认后将同步行程信息。',
      deepLink: `layoverjoy://bookings/${intent.id}`,
      planId: intent.planId,
      isSimulated: true,
    });
    return this.get(intentId, userId);
  }

  /** 演示注入：下单后第二段发生库存变化（在已存在订单时可用）。 */
  async simulateLegBFailure(userId: string, intentId: string) {
    const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
    if (!intent) throw AppError.notFound('订单');
    if (intent.status === 'PARTIAL_ORDER') return this.get(intentId, userId);
    if (intent.status !== 'BOTH_ORDERED' && intent.status !== 'PAYMENT_PENDING') {
      throw new AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 无法注入第二段库存变化。`, 409);
    }
    // 已下单场景：把第二段订单标记为库存变化并转为 PARTIAL_ORDER
    await this.prisma.flightOrder.updateMany({
      where: { bookingIntentId: intent.id, legNo: 2 },
      data: { status: 'FAILED', lastProviderCode: 'INVENTORY_CHANGED' },
    });
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'PARTIAL_ORDER' } });
    await this.notifications.notify({
      userId,
      kind: 'ORDER_EVENT',
      title: '部分订单风险：第二段库存变化',
      body: '第二段发生库存变化（INVENTORY_CHANGED），后续支付已停止，可发起补偿退款。补偿退款不会发生真实资金交易。',
      deepLink: `layoverjoy://bookings/${intent.id}`,
      planId: intent.planId,
      isSimulated: true,
    });
    return this.get(intentId, userId);
  }

  /** 补偿退款：仅调用 MockRefundProvider，展示状态流转。 */
  async mockRefund(userId: string, intentId: string) {
    const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
    if (!intent) throw AppError.notFound('订单');
    if (!['PARTIAL_ORDER', 'COMPLETED', 'MANUAL_REVIEW', 'PAYMENT_PENDING', 'BOTH_ORDERED'].includes(intent.status)) {
      throw new AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 不可执行补偿。`, 409);
    }
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'SIMULATED_REFUND_PENDING' } });

    const orders = await this.prisma.flightOrder.findMany({
      where: { bookingIntentId: intent.id, status: { in: ['CREATED', 'PAID', 'FAILED'] } },
    });
    for (const order of orders) {
      const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
      const result = await this.atlas.refund.refund({ orderNo, reason: 'SIMULATED_COMPENSATION' });
      await this.prisma.flightOrder.update({
        where: { id: order.id },
        data: { status: 'REFUNDED_SIMULATED', lastProviderCode: result.providerCode ?? result.status },
      });
    }
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'SIMULATED_REFUNDED' } });
    await this.prisma.auditEvent.create({
      data: {
        userId,
        action: 'SIMULATED_REFUND_COMPLETED',
        entity: 'BookingIntent',
        entityId: intent.id,
        detailJson: { orders: orders.length } as any,
      },
    });
    await this.notifications.notify({
      userId,
      kind: 'ORDER_EVENT',
      title: '补偿已完成',
      body: '退款已完成，没有发生真实资金交易。已生成审计记录。',
      deepLink: `layoverjoy://bookings/${intent.id}`,
      planId: intent.planId,
      isSimulated: true,
    });
    return this.get(intentId, userId);
  }

  async list(userId: string) {
    const intents = await this.prisma.bookingIntent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { orders: { orderBy: { legNo: 'asc' } } },
    });
    return { bookings: intents.map((i) => this.toDto(i)) };
  }

  async get(intentId: string, userId: string) {
    const intent = await this.prisma.bookingIntent.findFirst({
      where: { id: intentId, userId },
      include: { orders: { orderBy: { legNo: 'asc' } } },
    });
    if (!intent) throw AppError.notFound('订单');
    return { booking: this.toDto(intent) };
  }

  private toDto(intent: any) {
    return {
      bookingId: intent.id,
      planId: intent.planId,
      status: intent.status,
      sourceEnvironment: intent.sourceEnvironment,
      isSimulated: intent.isSimulated,
      acceptedTotal: intent.acceptedTotal,
      currency: intent.currency,
      riskAckVersion: intent.riskAckVersion,
      expiresAt: intent.expiresAt?.toISOString() ?? null,
      createdAt: intent.createdAt.toISOString(),
      orders: (intent.orders ?? []).map((o: any) => ({
        legNo: o.legNo,
        provider: o.provider,
        status: o.status,
        orderNoLast4: o.orderNoEnc ? maskLast4(this.safeDecrypt(o.orderNoEnc)) : null,
        amount: o.amount,
        currency: o.currency,
        lastProviderCode: o.lastProviderCode,
      })),
    };
  }

  private safeDecrypt(payload: string): string | null {
    try {
      return this.crypto.decrypt(payload);
    } catch {
      return null;
    }
  }
}
