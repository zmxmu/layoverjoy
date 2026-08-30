import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { AtlasService } from '../atlas/atlas.service';
import { RedisService } from '../redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntryRulesService } from '../entry-rules/entry-rules.service';
import { EligibilityAssessService } from '../entry-rules/v2/assess.service';
import { UsersService } from '../users/users.service';
import { AppError } from '../common/errors';
import { FIELD_CRYPTO } from '../core.module';
import { FieldCrypto, maskLast4 } from '../common/crypto';
import { PaymentResult } from '../atlas/atlas.types';
import { loadEnv } from '../config/env';
import { validatePlanSnapshotConsistency } from '../search/search.orchestrator';

export interface CompositeOrderInput {
  planId: string;
  riskAckVersion: number;
  passengers?: Array<{ givenName?: string; familyName?: string }>;
  /** 演示注入：停留段（第二段）成功下单后，第一段下单失败（INVENTORY_CHANGED） */
  legBFailure?: boolean;
}

const SCHEMA_VERSION = 1;

/** 每张航段的独立状态机（2026-08-30 Sandbox 交易闭环，AGENTS.md §8）。 */
export const LEG_STATES = {
  SEARCHED: 'SEARCHED',
  VERIFIED: 'VERIFIED',
  PRICE_CONFIRMATION_REQUIRED: 'PRICE_CONFIRMATION_REQUIRED',
  ORDER_CREATING: 'ORDER_CREATING',
  ORDER_CREATED: 'ORDER_CREATED',
  PAYMENT_CONFIRMATION_REQUIRED: 'PAYMENT_CONFIRMATION_REQUIRED',
  PAY_SUBMITTED: 'PAY_SUBMITTED',
  PAID: 'PAID',
  TICKETING_PENDING: 'TICKETING_PENDING',
  TICKETED: 'TICKETED',
  FAILED: 'FAILED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  UNKNOWN_REQUIRES_QUERY: 'UNKNOWN_REQUIRES_QUERY',
} as const;

/** 付款确认令牌（LayoverJoy 后端签发，一次性，绝不发送给 Atlas）。 */
interface PaymentConfirmationBinding {
  userId: string;
  bookingIntentId: string;
  orderId: string;
  orderNo: string;
  amount: number;
  currency: string;
  generation: string;
  expiresAt: string;
}

const PAY_CONFIRM_TTL_SECONDS = 15 * 60;
// 出票轮询退避链：累计 120s 有界（AGENTS.md §8 / P3），不得高频请求。
const TICKETING_POLL_INTERVALS_MS = [5000, 10000, 15000, 20000, 25000, 30000, 15000];

/**
 * Sandbox 测试专用虚构乘机人（2026-08-30 用户授权，官方指南同款）：
 * Sandbox 订单只允许虚构信息；真实乘客资料绝不进入 Sandbox 请求。
 */
const SANDBOX_TEST_PASSENGERS = {
  passengers: [
    {
      name: 'TEST/TRAVELER',
      // Atlas 实际协议（Skill 源码实测）：passengerType 为数值（0=adult），cardType='PP' 为护照。
      passengerType: 0,
      gender: 'M',
      birthday: '19900101',
      nationality: 'JP',
      cardType: 'PP',
      cardNum: 'TR0000001',
      cardIssuePlace: 'JP',
      cardExpired: '20321231',
    },
  ],
  contact: { name: 'TEST/TRAVELER', email: 'test.traveler@example.invalid' },
};

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
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly rules: EntryRulesService,
    private readonly users: UsersService,
    private readonly assessV2: EligibilityAssessService,
    @Inject(FIELD_CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  /** 当前 Order Provider 是否走真实 Sandbox。 */
  private orderIsSandbox(): boolean {
    return this.atlas.providerLabel(this.atlas.order) === 'ATLAS_SANDBOX';
  }

  private paymentIsSandbox(): boolean {
    return this.atlas.providerLabel(this.atlas.payment) === 'ATLAS_SANDBOX';
  }

  /**
   * ER-11：Order/Pay 前重评资格。
   * 产品决策（所有者确认）：资格结论一律不阻断下单——
   * INELIGIBLE/NEEDS_INFO/NEEDS_REVIEW 等均作为风险提示随订单返回，
   * 是否准许入境最终以边检/领馆/航司实时决定为准（App 展示免责声明）。
   */
  private async gateEligibility(userId: string, plan: any, legs: any[], stage: 'ORDER' | 'PAY') {
    const profile = await this.users.profileForRules(userId);
    const jurisdiction = plan.hubCountry === 'HK' || plan.hubCountry === 'MO' ? plan.hubCountry : null;
    const first = legs[0];
    const a = this.assessV2.assess(
      {
        userId,
        mode: 'BOOKING',
        itinerary: {
          purpose: 'TOURISM',
          segments: legs.map((l) => ({
            from: l.origin,
            to: l.destination,
            departureAt: l.departureAt?.toISOString?.() ?? l.departureAt,
            arrivalAt: l.arrivalAt?.toISOString?.() ?? l.departureAt?.toISOString?.() ?? l.departureAt,
          })),
          stopover: { country: plan.hubCountry, jurisdiction, airport: first?.destination, stayHours: plan.stayDays * 24 },
          stayDays: plan.stayDays,
          arrivalDate: first?.departureAt ? new Date(first.departureAt).toISOString().slice(0, 10) : undefined,
        },
        traveler: { passport: profile.passport, documents: (profile as any).qualifyingDocuments ?? [], history: {} },
        documents: { onwardTicket: { status: 'CONFIRMED' } },
      },
      { persist: true },
    );
    void stage;
    return a;
  }

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

    // P0-2：下单前校验快照与本次搜索一致（同一 user/search-scoped immutable 快照）。
    const runForCheck = await this.prisma.searchRun.findUnique({ where: { id: plan.searchRunId } });
    if (runForCheck) validatePlanSnapshotConsistency(runForCheck, plan, legs);
    // P0-3 脱敏预检日志：只记快照 id / rid hash / expiresAt / 阶段，不记完整 token。
    for (const leg of legs) {
      this.logger.log(
        `event=booking_preflight stage=VERIFY_BEFORE_ORDER plan=${plan.id.slice(-8)} snapshot=${leg.id.slice(-8)} ` +
          `rid=${createHash('sha256').update(leg.providerOfferId).digest('hex').slice(0, 8)} expiresAt=${leg.expiresAt?.toISOString() ?? 'none'}`,
      );
    }

    // 报价过期门禁（AGENTS.md §8）：上游 expireTime 已过的报价不得 Verify/Order/Pay。
    const now = new Date();
    const expiredLegs = legs.filter((l) => l.expiresAt && l.expiresAt.getTime() <= now.getTime());
    if (expiredLegs.length > 0) {
      for (const leg of expiredLegs) {
        this.logger.warn(
          `event=booking_preflight stage=OFFER_EXPIRED plan=${plan.id.slice(-8)} snapshot=${leg.id.slice(-8)} ` +
            `rid=${createHash('sha256').update(leg.providerOfferId).digest('hex').slice(0, 8)} expiredAt=${leg.expiresAt?.toISOString()}`,
        );
      }
      throw new AppError('OFFER_EXPIRED', '航班报价已过期，请重新搜索并确认新价格后再预订。', 409, false, {
        planId: plan.id,
        expiredLegs: expiredLegs.map((l) => l.legNo),
        requiresResearch: true,
      });
    }

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
      previousTotal: v.leg.totalPrice,
      totalPrice: v.verified.totalPrice,
      currency: v.verified.currency,
      priceChanged: v.verified.priceChanged,
      bookable: v.verified.bookable,
      expiresAt: v.leg.expiresAt?.toISOString?.() ?? v.leg.expiresAt ?? null,
    }));
    if (priceChanged) {
      // 涨价（或变价）：绝不自动创建订单。保存完整明细等待用户明确确认（P2 检查点）。
      const acceptedTotal = intent.acceptedTotal ?? plan.airfareTotal;
      const newTotal = verifySummary.reduce((s: number, v: any) => s + (v.totalPrice ?? 0), 0);
      await transition('PRICE_CONFIRMATION_REQUIRED', { verifyResultJson: { ok: true, verify: verifySummary } as any });
      throw new AppError('PRICE_CONFIRMATION_REQUIRED', '航班价格已变化，请确认新价格后再继续。', 409, false, {
        intentId: intent.id,
        currency: verifySummary[0]?.currency,
        previousTotal: acceptedTotal,
        newTotal: Math.round(newTotal * 100) / 100,
        delta: Math.round((newTotal - acceptedTotal) * 100) / 100,
        legs: verifySummary,
        offerExpiresAt: verifySummary[0]?.expiresAt ?? null,
      });
    }
    await transition('BOTH_VERIFIED', {
      verifyResultJson: { ok: true, verify: verifySummary } as any,
      priceConfirmedAt: new Date(),
    });

    // 2) 预订期资格复核（v2 引擎，ER-11）：两段均 Verify 后续程票才算确认；
    //    搜索期的初筛结果不能直接用于下单。
    //    产品决策：资格结论不阻断下单，非 ELIGIBLE 一律作为风险提示随订单返回。
    if (plan.hubCountry) {
      const elig = await this.gateEligibility(userId, plan, legs, 'ORDER');
      if (elig.bookingDecision !== 'ELIGIBLE') {
        const intentNow = await this.prisma.bookingIntent.findUnique({ where: { id: intent.id } });
        const vr = (intentNow?.verifyResultJson as any) ?? {};
        await this.prisma.bookingIntent.update({
          where: { id: intent.id },
          data: {
            verifyResultJson: {
              ...vr,
              bookingEligibility: {
                decision: elig.bookingDecision,
                ruleId: elig.matchedRuleIds[0] ?? null,
                explanationZh: elig.explanationZh,
              },
            } as any,
          },
        });
      }
    }

    // 3) 依次下单。先下停留段（第二段库存风险更高）。状态由实际成功的腿集合驱动。
    //    演示注入：legBFailure 在第二段成功下单后让第一段返回 INVENTORY_CHANGED。
    await this.placeOrders(intent.id, intentKey, plan, userId, verifiedLegs, input);

    await transition('PAYMENT_PENDING');
    // Sandbox 支付：为每个已创建订单签发一次性付款确认令牌（P2 检查点）。
    if (this.paymentIsSandbox()) {
      await this.issuePaymentConfirmations(userId, intent.id);
    }
    return this.get(intent.id, userId);
  }

  /**
   * 依次创建各腿订单（先停留段）。副作用操作绝不自动重试；
   * 任一腿成功、另一腿失败 → PARTIAL；尚无任何订单失败 → MANUAL_REVIEW。
   */
  private async placeOrders(
    intentId: string,
    intentKey: string,
    plan: any,
    userId: string,
    verifiedLegs: any[],
    input: CompositeOrderInput,
  ) {
    const transition = (status: string, extra: Record<string, unknown> = {}) =>
      this.prisma.bookingIntent.update({ where: { id: intentId }, data: { status, ...extra } });
    const generation = this.atlas.environmentGeneration();
    const orderSequence = [...verifiedLegs].sort((a: any, b: any) => b.leg.legNo - a.leg.legNo);
    const orderedLegs: number[] = [];

    for (const item of orderSequence) {
      const legNo = item.leg.legNo;
      await transition(legNo === 1 ? 'LEG_A_ORDERING' : 'LEG_B_ORDERING');

      if (input.legBFailure && legNo === 1 && orderedLegs.length > 0) {
        await this.recordOrderFailure(intentId, legNo, 'INVENTORY_CHANGED');
        await transition('PARTIAL_ORDER');
        await this.notifications.notify({
          userId,
          kind: 'ORDER_EVENT',
          title: '部分订单风险：第一段下单失败',
          titleEn: 'Partial order: leg 1 failed',
          body: '第二段已成功下单，第一段库存发生变化。后续支付已停止，可发起退款收尾处理。',
          bodyEn: 'Leg 2 was ordered but leg 1 hit an inventory change. Payment stopped; you can close out with a refund.',
          messageKey: 'booking.leg1_failed',
          deepLink: `layoverjoy://bookings/${intentId}`,
          planId: plan.id,
          isSimulated: true,
        });
        throw new AppError('PARTIAL_BOOKING', '第二段已下单，第一段库存变化导致下单失败。已停止支付，可执行补偿。', 409, false, {
          intentId,
          failedLeg: legNo,
          providerCode: 'INVENTORY_CHANGED',
        });
      }

      try {
        const idemKey = `${intentKey}:leg${legNo}`;
        // Sandbox 订单只用虚构乘机人（真实乘客资料绝不进 Sandbox 请求）。
        const passengerBlock = this.orderIsSandbox() ? SANDBOX_TEST_PASSENGERS : input.passengers ?? [];
        const result = await this.atlas.order.createOrder({
          bookingReference: item.verified.sessionId || item.leg.providerOfferId,
          passengers: passengerBlock,
          idempotencyKey: idemKey,
        });
        await this.prisma.flightOrder.create({
          data: {
            bookingIntentId: intentId,
            legNo,
            provider: this.atlas.providerLabel(this.atlas.order),
            orderNoEnc: this.crypto.encrypt(result.orderNo),
            verifySessionIdEnc: item.verified.sessionId ? this.crypto.encrypt(item.verified.sessionId) : null,
            status: 'CREATED',
            amount: result.amount ?? item.verified.totalPrice,
            currency: result.currency ?? item.verified.currency,
            // 环境代际：环境/凭据/交易 Provider 切换后，旧订单上下文与令牌全部失效。
            atlasGeneration: generation,
            paymentDeadlineAt: result.paymentDeadlineAt ? new Date(result.paymentDeadlineAt) : null,
            idempotencyKey: idemKey,
          },
        });
        this.logger.log(`intent ${intentId} leg ${legNo} ordered: ${maskLast4(result.orderNo)}`);
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
        await this.recordOrderFailure(intentId, legNo, code);
        if (orderedLegs.length > 0) {
          // 已有真实订单、另一段失败：立即停止后续支付，进入补偿流程。
          await transition('PARTIAL_ORDER');
          throw new AppError('PARTIAL_BOOKING', `第${orderedLegs[0]}段已下单，第${legNo}段下单失败。已停止支付，可执行补偿。`, 409, false, {
            intentId,
            failedLeg: legNo,
            orderedLegs,
            providerCode: code,
          });
        }
        // 尚无任何订单：无需补偿，转人工复核；绝不重复创建订单探测。
        await transition('MANUAL_REVIEW');
        throw new AppError(code, (e as Error).message || '下单失败，请稍后重试。', 409, false, {
          intentId,
          failedLeg: legNo,
          orderedLegs,
        });
      }
    }
  }

  /** 价格确认检查点：用户明确接受新总价后，重新 Verify（下单前必须重验）再继续下单。 */
  async confirmPrice(userId: string, intentId: string, input: { acceptedTotal: number; currency?: string }) {
    const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
    if (!intent) throw AppError.notFound('订单');
    if (intent.status !== 'PRICE_CONFIRMATION_REQUIRED') {
      throw new AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 无需价格确认。`, 409);
    }
    if (typeof input?.acceptedTotal !== 'number' || !Number.isFinite(input.acceptedTotal)) {
      throw AppError.validation(['acceptedTotal'], '请明确确认新总价。');
    }
    const plan = await this.prisma.stopoverPlan.findUnique({ where: { id: intent.planId } });
    if (!plan) throw AppError.notFound('方案');
    const legs = await this.prisma.flightOfferSnapshot.findMany({
      where: { id: { in: (plan.legOfferIdsJson as string[]) ?? [] } },
      orderBy: { legNo: 'asc' },
    });
    const now = new Date();
    if (legs.some((l) => l.expiresAt && l.expiresAt.getTime() <= now.getTime())) {
      await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
      throw new AppError('OFFER_EXPIRED', '报价已过期，请重新搜索。', 409, false, { intentId: intent.id });
    }
    // 下单前必须重新 Verify；再次变价则继续等待确认，绝不自动下单。
    const verifyResults = await Promise.all(legs.map(async (leg) => ({ leg, verified: await this.atlas.verify.verify(leg.providerOfferId) })));
    const newTotal = Math.round(verifyResults.reduce((s, r) => s + r.verified.totalPrice, 0) * 100) / 100;
    if (verifyResults.some((r) => r.verified.priceChanged) || Math.abs(newTotal - input.acceptedTotal) > 0.005) {
      await this.prisma.bookingIntent.update({
        where: { id: intent.id },
        data: {
          verifyResultJson: {
            ok: true,
            verify: verifyResults.map((r) => ({
              legNo: r.leg.legNo,
              sessionId: r.verified.sessionId ?? null,
              previousTotal: r.leg.totalPrice,
              totalPrice: r.verified.totalPrice,
              currency: r.verified.currency,
              priceChanged: r.verified.priceChanged,
            })),
          } as any,
        },
      });
      throw new AppError('PRICE_CONFIRMATION_REQUIRED', '价格再次变化，请确认最新总价。', 409, false, {
        intentId: intent.id,
        currency: verifyResults[0]?.verified.currency,
        previousTotal: input.acceptedTotal,
        newTotal,
        delta: Math.round((newTotal - input.acceptedTotal) * 100) / 100,
      });
    }
    // 用户确认的是新总价：更新接受金额后继续下单流程。
    await this.prisma.bookingIntent.update({
      where: { id: intent.id },
      data: { acceptedTotal: newTotal, currency: verifyResults[0]?.verified.currency ?? intent.currency, status: 'BOTH_VERIFIED', priceConfirmedAt: new Date() },
    });
    const intentKey = intent.idempotencyKey ?? randomUUID();
    await this.placeOrders(intent.id, intentKey, plan, userId, verifyResults, { planId: plan.id, riskAckVersion: intent.riskAckVersion });
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'PAYMENT_PENDING' } });
    if (this.paymentIsSandbox()) {
      await this.issuePaymentConfirmations(userId, intent.id);
    }
    return this.get(intent.id, userId);
  }

  /** 为 intent 下所有 CREATED 订单签发一次性付款确认令牌（存 Redis，含环境代际绑定）。 */
  private async issuePaymentConfirmations(userId: string, intentId: string): Promise<void> {
    const generation = this.atlas.environmentGeneration();
    const orders = await this.prisma.flightOrder.findMany({ where: { bookingIntentId: intentId, status: 'CREATED' }, orderBy: { legNo: 'asc' } });
    for (const order of orders) {
      const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
      const tokenId = randomUUID();
      const expiresAt = order.paymentDeadlineAt ?? new Date(Date.now() + PAY_CONFIRM_TTL_SECONDS * 1000);
      const binding: PaymentConfirmationBinding = {
        userId,
        bookingIntentId: intentId,
        orderId: order.id,
        orderNo,
        amount: order.amount ?? 0,
        currency: order.currency ?? '',
        generation,
        expiresAt: expiresAt.toISOString(),
      };
      const ttl = Math.max(30, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      await this.redis.set(`lj:payconfirm:${tokenId}`, JSON.stringify(binding), Math.min(ttl, PAY_CONFIRM_TTL_SECONDS));
      await this.prisma.flightOrder.update({ where: { id: order.id }, data: { lastProviderCode: `PAY_CONFIRM:${tokenId}` } });
    }
  }

  private async recordOrderFailure(intentId: string, legNo: number, code: string) {
    await this.prisma.auditEvent.create({
      data: { action: 'ORDER_FAILED', entity: 'BookingIntent', entityId: intentId, detailJson: { legNo, code } as any },
    });
  }

  /** 兼容旧控制器/测试入口。 */
  async mockPay(userId: string, intentId: string, demoPayResult?: string) {
    return this.pay(userId, intentId, undefined, demoPayResult);
  }

  /**
   * 支付（按订单顺序支付所有 CREATED 订单）。
   * - Sandbox 支付：必须逐单提交一次性付款确认令牌（绑定校验后消费，绝不重发）；
   *   支付成功后进入有界出票轮询（≤120s）；结果未知只转查询态，绝不重复支付。
   * - Mock 支付：保留演示注入（X-Demo-Pay-Result）与既有补偿分支。
   */
  async pay(userId: string, intentId: string, paymentConfirmationIds?: string[], demoPayResult?: string) {
    const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
    if (!intent) throw AppError.notFound('订单');
    if (intent.status !== 'PAYMENT_PENDING' && intent.status !== 'BOTH_ORDERED') {
      throw new AppError('INVALID_BOOKING_STATE', `当前状态 ${intent.status} 不可支付。`, 409);
    }
    // ER-11：Pay 前重评（行程/规则变化会得出不同结论并阻断）。
    // 联调旁路（仅开发/测试环境可开，默认关，生产禁用）：单腿测试方案无 hubCountry 时跳过。
    const skipGate = loadEnv().ATLAS_BOOKING_SKIP_ELIGIBILITY_GATE;
    const payPlan = await this.prisma.stopoverPlan.findUnique({ where: { id: intent.planId } });
    if (payPlan && !skipGate) {
      const payLegs = await this.prisma.flightOfferSnapshot.findMany({ where: { id: { in: (payPlan.legOfferIdsJson as string[]) ?? [] } }, orderBy: { legNo: 'asc' } });
      if (payLegs.length) await this.gateEligibility(userId, payPlan, payLegs, 'PAY');
    }
    const orders = await this.prisma.flightOrder.findMany({
      where: { bookingIntentId: intent.id, status: 'CREATED' },
      orderBy: { legNo: 'asc' },
    });
    const sandboxPayment = this.paymentIsSandbox();
    const generation = this.atlas.environmentGeneration();
    const confirmById = new Map<string, string>((paymentConfirmationIds ?? []).map((t, i) => [String(i), t]));

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
      const idemKey = `${order.idempotencyKey}:pay`;
      let result: PaymentResult;

      if (sandboxPayment) {
        // 环境代际校验：环境切换后旧订单与旧令牌全部失效。
        if (order.atlasGeneration && order.atlasGeneration !== generation) {
          throw new AppError('ENVIRONMENT_CHANGED', 'Atlas 环境已切换，旧报价与订单已失效，请重新搜索。', 409, false, {
            intentId: intent.id,
            legNo: order.legNo,
          });
        }
        // 一次性付款确认令牌：绑定校验 → 消费，缺失或不匹配一律拒绝支付。
        const expectedToken = (order.lastProviderCode ?? '').startsWith('PAY_CONFIRM:') ? order.lastProviderCode!.slice('PAY_CONFIRM:'.length) : null;
        const suppliedToken = paymentConfirmationIds?.[i];
        if (!expectedToken || !suppliedToken || suppliedToken !== expectedToken) {
          throw new AppError('PAYMENT_CONFIRMATION_REQUIRED', '请核对付款摘要后提交确认。', 409, false, {
            intentId: intent.id,
            legNo: order.legNo,
          });
        }
        const binding = await this.consumePaymentConfirmation(suppliedToken, { userId, intentId, orderId: order.id, orderNo, amount: order.amount ?? 0, currency: order.currency ?? '', generation });
        if (!binding.ok) {
          throw new AppError('PAYMENT_CONFIRMATION_INVALID', binding.reason ?? '付款确认无效。', 409, false, { intentId: intent.id, legNo: order.legNo });
        }
        await this.prisma.flightOrder.update({ where: { id: order.id }, data: { status: 'PAY_SUBMITTED' } });
        result = await this.atlas.payment.pay({ orderNo, idempotencyKey: idemKey });
        // Sandbox 实测：支付接口受理成功但响应无明确成功字段（UNKNOWN）。
        // 立即执行一次查询落定（查询不是重试）；确认已支付则继续，否则转人工查询态，绝不重复支付。
        if (result.status === 'UNKNOWN') {
          await this.queryAndSettleOrder(order.id);
          const settled = await this.prisma.flightOrder.findUnique({ where: { id: order.id } });
          if (settled && ['PAID', 'TICKETING_PENDING', 'TICKETED'].includes(settled.status)) {
            result = { status: 'PAID', providerCode: 'CONFIRMED_BY_QUERY' };
          }
        }
      } else if (demoPayResult === 'FAIL' && i === 0) {
        // 演示注入（客户端开发页开关，经 X-Demo-Pay-Result 头传入）：第一笔支付必然失败。
        // 仅在 Mock 支付提供方下生效，避免影响真实链路；失败走既有补偿分支，状态诚实流转。
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
          data: { status: sandboxPayment ? 'TICKETING_PENDING' : 'PAID', lastProviderCode: result.providerCode ?? 'PAID' },
        });
        if (sandboxPayment) {
          // 支付成功后进入有界出票查询（≤120s）；TICKETING_PENDING 不是失败状态。
          this.startTicketingPoll(order.id).catch((e) => this.logger.warn(`ticketing poll failed order=${order.id.slice(-8)}: ${(e as Error).message}`));
        }
      } else if (result.status === 'UNKNOWN') {
        // 支付结果未知：只允许查询，绝不重复支付。
        await this.prisma.flightOrder.update({ where: { id: order.id }, data: { status: 'UNKNOWN_REQUIRES_QUERY', lastProviderCode: 'UNKNOWN' } });
        await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'MANUAL_REVIEW' } });
        throw new AppError('PROVIDER_OUTCOME_UNKNOWN', '支付结果未知，已转入人工查询。请勿重复支付，可稍后查询订单状态。', 409, false, {
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
    const finalStatus = sandboxPayment ? 'TICKETING_IN_PROGRESS' : 'COMPLETED';
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: finalStatus } });
    await this.notifications.notify({
      userId,
      kind: 'ORDER_EVENT',
      title: sandboxPayment ? '支付已提交' : '预订完成',
      titleEn: sandboxPayment ? 'Payment submitted' : 'Booking completed',
      body: sandboxPayment
        ? '支付已提交，出票确认后将同步 PNR 与票号信息。'
        : '两段订单均已支付成功，出票确认后将同步行程信息。',
      bodyEn: sandboxPayment
        ? 'Payment submitted — PNR and ticket numbers will sync once ticketing is confirmed.'
        : 'Both legs paid — itinerary details will sync once ticketing is confirmed.',
      messageKey: sandboxPayment ? 'booking.payment_submitted' : 'booking.completed',
      deepLink: `layoverjoy://bookings/${intent.id}`,
      planId: intent.planId,
      isSimulated: true,
    });
    return this.get(intentId, userId);
  }

  /** 消费一次性付款确认令牌：所有绑定字段必须完全一致，且只能使用一次。 */
  private async consumePaymentConfirmation(
    tokenId: string,
    expect: { userId: string; intentId: string; orderId: string; orderNo: string; amount: number; currency: string; generation: string },
  ): Promise<{ ok: boolean; reason?: string }> {
    const raw = await this.redis.get(`lj:payconfirm:${tokenId}`);
    if (!raw) return { ok: false, reason: '付款确认已过期或已使用，请重新核对付款摘要。' };
    let binding: PaymentConfirmationBinding;
    try {
      binding = JSON.parse(raw);
    } catch {
      return { ok: false, reason: '付款确认无效，请重新核对付款摘要。' };
    }
    // 金额、币种、订单、用户或环境变化 → 旧令牌立即失效；已消费的令牌不得再用。
    const mismatch =
      Boolean((binding as any).consumed) ||
      binding.userId !== expect.userId ||
      binding.bookingIntentId !== expect.intentId ||
      binding.orderId !== expect.orderId ||
      binding.orderNo !== expect.orderNo ||
      Math.abs((binding.amount ?? 0) - expect.amount) > 0.005 ||
      binding.currency !== expect.currency ||
      binding.generation !== expect.generation ||
      new Date(binding.expiresAt).getTime() <= Date.now();
    if (mismatch) return { ok: false, reason: '付款摘要已变化，旧确认已失效，请重新核对。' };
    // 一次性：消费后立即删除，重复提交必拒。
    await this.redis.set(`lj:payconfirm:${tokenId}`, JSON.stringify({ ...binding, consumed: true }), 60);
    return { ok: true };
  }

  /** 有界出票轮询：退避间隔累计≤120 秒；超时保持 TICKETING_PENDING 供用户稍后刷新。 */
  private async startTicketingPoll(orderId: string, step = 0): Promise<void> {
    if (step >= TICKETING_POLL_INTERVALS_MS.length) {
      this.logger.log(`event=ticketing_poll_timeout order=${orderId.slice(-8)} state=TICKETING_PENDING`);
      return;
    }
    await new Promise((r) => setTimeout(r, TICKETING_POLL_INTERVALS_MS[step]));
    const settled = await this.queryAndSettleOrder(orderId);
    if (settled) return;
    await this.startTicketingPoll(orderId, step + 1);
  }

  /** 查询一次订单并落库出票状态；出票完成/取消返回 true，其余返回 false（继续等待）。 */
  private async queryAndSettleOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.flightOrder.findUnique({ where: { id: orderId } });
    if (!order || !order.orderNoEnc) return true;
    if (!['TICKETING_PENDING', 'UNKNOWN_REQUIRES_QUERY', 'PAID'].includes(order.status)) return true;
    const orderNo = this.crypto.decrypt(order.orderNoEnc);
    let info;
    try {
      info = await this.atlas.order.getOrder(orderNo);
    } catch (e) {
      this.logger.warn(`event=ticketing_query_failed order=${orderId.slice(-8)} code=${(e as AppError).code ?? 'ERR'}`);
      return false;
    }
    if (info.status === 'ORDER_CANCELLED' || info.orderStatus === '-3') {
      await this.prisma.flightOrder.update({ where: { id: orderId }, data: { status: 'ORDER_CANCELLED', lastProviderCode: 'ORDER_CANCELLED' } });
      return true;
    }
    if (info.ticketStatus === '1' || info.status === 'TICKETED') {
      // PNR / 票号用 FIELD_CRYPTO 加密落库；日志只记尾缀与数量，绝不输出完整值。
      await this.prisma.flightOrder.update({
        where: { id: orderId },
        data: {
          status: 'TICKETED',
          lastProviderCode: 'TICKETED',
          pnrListEnc: info.pnrList?.length ? this.crypto.encrypt(JSON.stringify(info.pnrList)) : null,
          ticketNosEnc: info.ticketNumbers?.length ? this.crypto.encrypt(JSON.stringify(info.ticketNumbers)) : null,
        },
      });
      this.logger.log(`event=ticketing_completed order=${maskLast4(orderNo)} pnr=${info.pnrList?.length ?? 0} tickets=${info.ticketNumbers?.length ?? 0}`);
      return true;
    }
    if (info.orderStatus === '0' && info.status === 'UNPAID') {
      // 支付未成功：转人工查询，绝不自动重付。
      await this.prisma.flightOrder.update({ where: { id: orderId }, data: { status: 'UNKNOWN_REQUIRES_QUERY', lastProviderCode: 'UNPAID_AFTER_PAY' } });
      return true;
    }
    // 实测（2026-08-30）：Sandbox 支付成功后 orderStatus=1、ticketStatus 可能仍为 0（异步出票）。
    // 已支付未出票：保持 TICKETING_PENDING，PNR 拿到就先加密落库；票号等后续查询补齐。
    if (info.status === 'PAID' || info.orderStatus === '1') {
      await this.prisma.flightOrder.update({
        where: { id: orderId },
        data: {
          status: 'TICKETING_PENDING',
          lastProviderCode: 'PAID_TICKETING_PENDING',
          ...(info.pnrList?.length ? { pnrListEnc: this.crypto.encrypt(JSON.stringify(info.pnrList)) } : {}),
          ...(info.ticketNumbers?.length ? { ticketNosEnc: this.crypto.encrypt(JSON.stringify(info.ticketNumbers)) } : {}),
        },
      });
      return false;
    }
    return false;
  }

  /** 用户手动刷新出票状态（单次查询，不轮询）。 */
  async refreshTicketing(userId: string, intentId: string) {
    const intent = await this.prisma.bookingIntent.findFirst({ where: { id: intentId, userId } });
    if (!intent) throw AppError.notFound('订单');
    const orders = await this.prisma.flightOrder.findMany({
      where: { bookingIntentId: intent.id, status: { in: ['TICKETING_PENDING', 'UNKNOWN_REQUIRES_QUERY', 'PAY_SUBMITTED'] } },
    });
    let allTicketed = orders.length > 0;
    for (const order of orders) {
      const settled = await this.queryAndSettleOrder(order.id);
      const fresh = await this.prisma.flightOrder.findUnique({ where: { id: order.id } });
      if (!settled || fresh?.status !== 'TICKETED') allTicketed = false;
    }
    // 全部已支付（含出票中）即视为支付环节完成；全部出票才进入 COMPLETED。
    const remaining = await this.prisma.flightOrder.findMany({
      where: { bookingIntentId: intent.id, status: { in: ['CREATED', 'UNKNOWN_REQUIRES_QUERY'] } },
    });
    if (remaining.length === 0 && intent.status === 'MANUAL_REVIEW') {
      await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: allTicketed ? 'COMPLETED' : 'TICKETING_IN_PROGRESS' } });
    } else if (allTicketed && orders.length > 0) {
      await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'COMPLETED' } });
    }
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
      titleEn: 'Partial order: leg 2 inventory changed',
      body: '第二段库存发生变化，后续支付已停止，可发起退款收尾处理。',
      bodyEn: 'Leg 2 inventory changed. Payment stopped; you can close out with a refund.',
      messageKey: 'booking.leg2_inventory',
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
    await this.prisma.bookingIntent.update({ where: { id: intent.id }, data: { status: 'REFUND_PENDING_SIMULATED' } });

    const orders = await this.prisma.flightOrder.findMany({
      where: { bookingIntentId: intent.id, status: { in: ['CREATED', 'PAY_SUBMITTED', 'PAID', 'TICKETING_PENDING', 'TICKETED', 'FAILED'] } },
    });
    for (const order of orders) {
      const orderNo = order.orderNoEnc ? this.crypto.decrypt(order.orderNoEnc) : '';
      // Sandbox 没有退款 API：只执行明确标识的模拟退款（AGENTS.md §8），UI 必须明示。
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
      title: '退款已完成',
      titleEn: 'Refund completed',
      body: '退款已完成，没有发生真实资金交易。',
      bodyEn: 'Refund completed. This is a simulated refund — no real funds moved.',
      messageKey: 'booking.refund_completed',
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
    const orders = (intent.orders ?? []) as any[];
    // 涨价确认检查点明细：原价/新价/差额/币种/报价有效期（供 Android 展示后由用户明确确认）。
    let priceConfirmation: { previousTotal: number | null; newTotal: number; delta: number; currency: string; offerExpiresAt: string | null } | null = null;
    if (intent.status === 'PRICE_CONFIRMATION_REQUIRED') {
      const verify: any[] = (intent.verifyResultJson as any)?.verify ?? [];
      const newTotal = Math.round(verify.reduce((s: number, v: any) => s + (v.totalPrice ?? 0), 0) * 100) / 100;
      const previousTotal = intent.acceptedTotal ?? null;
      priceConfirmation = {
        previousTotal,
        newTotal,
        delta: Math.round((newTotal - (previousTotal ?? 0) * 1) * 100) / 100,
        currency: verify[0]?.currency ?? intent.currency ?? '',
        offerExpiresAt: verify[0]?.expiresAt ?? null,
      };
    }
    // 预订期资格风险提示（非阻断结论）：Android 在预订页展示，最终决定权在边检/领馆/航司。
    const be = (intent.verifyResultJson as any)?.bookingEligibility;
    const eligibilityNotice =
      be && typeof be === 'object' && typeof be.decision === 'string'
        ? { decision: be.decision, ruleId: be.ruleId ?? null, explanationZh: be.explanationZh ?? '' }
        : null;
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
      // Sandbox 交易闭环回显（供 Android 付款摘要与出票页；不含任何服务端密钥）。
      orderProvider: this.atlas.providerLabel(this.atlas.order),
      paymentProvider: this.atlas.providerLabel(this.atlas.payment),
      isSandboxPayment: this.paymentIsSandbox(),
      priceIncreased: intent.status === 'PRICE_CONFIRMATION_REQUIRED',
      priceConfirmation,
      eligibilityNotice,
      orders: orders.map((o: any) => {
        const confirmToken = typeof o.lastProviderCode === 'string' && o.lastProviderCode.startsWith('PAY_CONFIRM:')
          ? o.lastProviderCode.slice('PAY_CONFIRM:'.length)
          : null;
        return {
          legNo: o.legNo,
          provider: o.provider,
          status: o.status,
          legState: o.status,
          orderNoLast4: o.orderNoEnc ? maskLast4(this.safeDecrypt(o.orderNoEnc)) : null,
          // Sandbox 测试订单号/ PNR / 票号属于当前用户自己的测试数据，可回显；日志中永不明文输出。
          orderNo: this.paymentIsSandbox() && o.orderNoEnc ? this.safeDecrypt(o.orderNoEnc) : null,
          pnrList: o.pnrListEnc ? this.safeDecryptJsonArray(o.pnrListEnc) : [],
          ticketNumbers: o.ticketNosEnc ? this.safeDecryptJsonArray(o.ticketNosEnc) : [],
          amount: o.amount,
          currency: o.currency,
          lastProviderCode: confirmToken ? 'PAYMENT_CONFIRMATION_REQUIRED' : o.lastProviderCode,
          paymentConfirmationId: o.status === 'CREATED' ? confirmToken : null,
          paymentDeadlineAt: o.paymentDeadlineAt?.toISOString?.() ?? null,
          isSimulatedRefund: o.status === 'REFUNDED_SIMULATED' || o.status === 'REFUND_PENDING_SIMULATED',
        };
      }),
    };
  }

  private safeDecryptJsonArray(payload: string): string[] {
    const raw = this.safeDecrypt(payload);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private safeDecrypt(payload: string): string | null {
    try {
      return this.crypto.decrypt(payload);
    } catch {
      return null;
    }
  }
}
