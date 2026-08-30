import { createHash, randomUUID } from 'crypto';
import { AppError } from '../common/errors';
import {
  CreateOrderInput,
  FlightOffer,
  FlightOrderResult,
  FlightProvider,
  FlightSearchInput,
  PayOrderInput,
  PaymentResult,
  RefundOrderInput,
  RefundResult,
  VerifiedOffer,
} from './atlas.types';

/**
 * SandboxAtlasGateway：直连 ATRIP Sandbox。
 * 契约来源：03 技术方案 §3.1、§13；凭据映射：x-atlas-client-id / x-atlas-client-secret。
 *
 * 真实请求/响应 Fixture 已于 2026-08-29 抓取并脱敏存档：
 *   test/fixtures/atlas/search.do.json、test/fixtures/atlas/verify.do.json
 * 关键契约（实测确认）：
 * - 请求必须携带 Accept-Encoding: gzip，否则返回 status=102；
 * - Search 字段为 tripType/adultNum/fromCity/toCity/fromDate(YYYYMMDD)，响应在顶层
 *   返回 { status, msg, routings[] }，status=0 才是业务成功；
 * - Verify 请求 { routingIdentifier }，响应顶层 { sessionId, routing, bookingRequirement,
 *   priceChange: { isPriceChange } }；
 * - routingIdentifier 即后续 Verify 的 offer 标识。
 * 日志绝不输出 AK/SK；原始响应只保存脱敏 Hash。
 */
export class SandboxAtlasProvider implements FlightProvider {
  readonly name = 'ATLAS_SANDBOX';

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly timeoutMs = 8000,
    private readonly cid = '',
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      // Sandbox 强制要求 gzip，否则返回 status=102（实测）
      'accept-encoding': 'gzip',
      'x-atlas-client-id': this.clientId,
      'x-atlas-client-secret': this.clientSecret,
    };
  }

  /** 带超时的 POST；Search 读操作允许重试 1 次，副作用操作绝不重试。 */
  private async post(path: string, body: unknown, allowRetry = false): Promise<{ status: number; json: any }> {
    const attempt = async (): Promise<{ status: number; json: any }> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body ?? {}),
          signal: ctrl.signal,
        });
        let json: any = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        return { status: res.status, json };
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await attempt();
    } catch (e) {
      if (allowRetry) {
        try {
          return await attempt();
        } catch {
          throw new AppError('ATLAS_TIMEOUT', '航班服务响应超时，请稍后重试。', 504, true, { provider: this.name });
        }
      }
      throw new AppError('ATLAS_TIMEOUT', '航班服务响应超时，请稍后重试。', 504, true, { provider: this.name });
    }
  }

  /** HTTP 状态码 → 稳定错误码映射（03 技术方案 §13.3）。 */
  private mapHttpError(status: number, json: any, operation: string): never {
    const providerCode = json?.code || json?.errorCode || json?.error?.code || String(status);
    if (status === 308) {
      throw new AppError('PRICE_CHANGED', '航班价格已变化，请确认后继续。', 409, false, { providerCode });
    }
    if (status === 401 || status === 403) {
      throw new AppError('PROVIDER_AUTH_FAILED', '航班服务认证失败，请联系管理员。', 502, false, { providerCode });
    }
    if (status === 429) {
      throw new AppError('PROVIDER_RATE_LIMITED', '航班服务限流，请稍后重试。', 429, true, { providerCode });
    }
    if (operation === 'ORDER' || operation === 'PAY') {
      throw new AppError('PROVIDER_OUTCOME_UNKNOWN', '订单结果不明确，仅可查询订单状态，不会自动重试。', 500, false, { providerCode });
    }
    throw new AppError('ATLAS_PROVIDER_ERROR', '航班服务返回异常，请稍后重试。', 502, true, { providerCode });
  }

  /** 业务层错误：HTTP 200 但 status !== 0（如 102 参数错误）。日志只记 status/msg 摘要，不输出凭据与乘客信息。 */
  private mapBusinessError(json: any, operation: string): never {
    const code = `ATLAS_STATUS_${json?.status}`;
    // 脱敏诊断：保留上游 status 与 msg（不含凭据/乘客字段），供联调定位与报告引用。
    // eslint-disable-next-line no-console
    console.warn(`[AtlasSandbox] ${operation} business_error status=${json?.status} msg=${String(json?.msg ?? '').slice(0, 200)}`);
    if (operation === 'SEARCH' && json?.status === 102) {
      throw new AppError('ATLAS_BAD_REQUEST', json?.msg || '航班查询参数有误。', 400, false, { providerCode: code });
    }
    if (operation === 'VERIFY') {
      // 验价失败常见于报价过期，按可重试的上游异常处理
      throw new AppError('ATLAS_PROVIDER_ERROR', json?.msg || '验价失败，请刷新后重试。', 502, true, { providerCode: code });
    }
    throw new AppError('ATLAS_PROVIDER_ERROR', json?.msg || '航班服务返回业务错误。', 502, true, { providerCode: code });
  }

  /** "2026-08-30T07:28:33Z" 或 "202608300728" → 合法 ISO；无法解析时返回 undefined。紧凑格式按 UTC 解释（有效期是绝对时刻，不涉机场本地时区）。 */
  private parseExpireTime(v: unknown): string | undefined {
    if (typeof v !== 'string' || !v) return undefined;
    const direct = new Date(v);
    if (!Number.isNaN(direct.getTime())) return direct.toISOString();
    const parsed = this.parseSandboxTime(v);
    if (!parsed) return undefined;
    const d = new Date(`${parsed}Z`);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  /** "202609150600" -> "2026-09-15T06:00:00"（沙箱时刻为机场当地时间，不做时区换算）。 */
  private parseSandboxTime(v: string | undefined | null): string | undefined {
    if (!v || v.length < 12) return undefined;
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:00`;
  }

  /** 成人单价合计：票价 + 税费 + 交易费。 */
  private routingTotalPrice(routing: any, adults: number): number {
    const perPax = Number(routing?.adultPrice ?? 0) + Number(routing?.adultTax ?? 0);
    const fee = Number(routing?.transactionFee ?? 0);
    return Math.round((perPax * Math.max(adults, 1) + fee) * 100) / 100;
  }

  async search(input: FlightSearchInput): Promise<FlightOffer[]> {
    const adults = input.adults ?? 1;
    const { status, json } = await this.post(
      '/search.do',
      {
        tripType: '1',
        requestId: randomUUID(),
        adultNum: adults,
        childNum: 0,
        infantNum: 0,
        fromCity: input.origin,
        toCity: input.destination,
        fromDate: input.departDate.replace(/-/g, ''),
        currency: input.currency,
        ...(input.airlines?.length ? { airlines: input.airlines } : {}),
        includeMultipleFareFamily: false,
      },
      true, // Search 读操作允许重试一次
    );
    if (status !== 200) this.mapHttpError(status, json, 'SEARCH');
    if (json?.status !== 0) this.mapBusinessError(json, 'SEARCH');

    const routings: any[] = Array.isArray(json?.routings) ? json.routings : [];
    const offers: FlightOffer[] = [];
    for (const r of routings) {
      const routingIdentifier = r?.routingIdentifier;
      if (!routingIdentifier) continue;
      const firstSeg = Array.isArray(r?.fromSegments) ? r.fromSegments[0] : undefined;
      offers.push({
        // routingIdentifier 是后续 Verify/Order 的报价标识
        providerOfferId: String(routingIdentifier),
        routingIdentifier: String(routingIdentifier),
        origin: firstSeg?.depAirport ?? input.origin,
        destination: firstSeg?.arrAirport ?? input.destination,
        departureAt: this.parseSandboxTime(firstSeg?.depTime) ?? '',
        arrivalAt: this.parseSandboxTime(firstSeg?.arrTime) ?? '',
        carrier: firstSeg?.carrier,
        flightNumber: firstSeg?.flightNumber,
        currency: r?.currency || input.currency || 'SGD',
        totalPrice: this.routingTotalPrice(r, adults),
        priceStatus: 'current',
        bookable: true,
        // 上游报价有效期：过期后不得 Verify/Order/Pay（AGENTS.md §8）
        expiresAt: this.parseExpireTime(r?.expireTime),
        baggageJson: Array.isArray(r?.ancillarySupported) ? r.ancillarySupported : undefined,
        raw: r,
      });
    }
    if (offers.length === 0) {
      throw new AppError(
        'NO_SANDBOX_INVENTORY',
        '该航线当前暂无可售航班数据。',
        404,
        false,
        { origin: input.origin, destination: input.destination, departDate: input.departDate },
      );
    }
    return offers;
  }

  async verify(offerIdentifier: string): Promise<VerifiedOffer> {
    const { status, json } = await this.post('/verify.do', { routingIdentifier: offerIdentifier });
    if (status !== 200) this.mapHttpError(status, json, 'VERIFY');
    if (json?.status !== 0) this.mapBusinessError(json, 'VERIFY');

    const routing = json?.routing ?? {};
    const priceChange = json?.priceChange ?? {};
    return {
      providerOfferId: String(routing?.routingIdentifier || offerIdentifier),
      sessionId: json?.sessionId,
      currency: routing?.currency || 'SGD',
      totalPrice: this.routingTotalPrice(routing, 1),
      priceStatus: 'current',
      priceChanged: priceChange?.isPriceChange === true,
      bookable: true,
      bookingRequirements: json?.bookingRequirement,
    };
  }

  async createOrder(input: CreateOrderInput): Promise<FlightOrderResult> {
    // 副作用操作：不自动重试。
    // Atlas 实际协议（Skill 源码实测）：{ sessionId, passengers:[...], contact:{...}, ifSeatOccupied? }。
    // input.passengers 为完整的乘客块（{passengers:[...], contact:{...}}），原样展开。
    const block = (input.passengers ?? {}) as Record<string, unknown>;
    const { status, json } = await this.post('/order.do', {
      sessionId: input.bookingReference,
      ...block,
    });
    if (status !== 200) this.mapHttpError(status, json, 'ORDER');
    if (json?.status !== 0) this.mapBusinessError(json, 'ORDER');
    const data = json?.data ?? json ?? {};
    // 注：paymentConfirmationId 是 LayoverJoy 后端签发的一次性付款确认令牌，
    // 不是 Atlas 字段，不从这里读取也不回传。
    return {
      orderNo: String(data.orderNo || data.order_no || ''),
      status: String(data.status || 'CREATED'),
      currency: data.currency,
      amount: Number(data.amount ?? data.totalPrice ?? 0) || undefined,
      paymentDeadlineAt: this.parseExpireTime(data.paymentDeadline ?? data.payDeadline),
    };
  }

  async pay(input: PayOrderInput): Promise<PaymentResult> {
    // Atlas 实际协议（Skill 源码实测）：{ orderNo, paymentMethod: 1 }（余额支付）。
    // paymentConfirmationId 是 LayoverJoy 后端签发的一次性确认令牌，绝不发送给 Atlas。
    const { status, json } = await this.post('/pay.do', {
      orderNo: input.orderNo,
      paymentMethod: 1,
    });
    if (status !== 200) this.mapHttpError(status, json, 'PAY');
    if (json?.status !== 0) this.mapBusinessError(json, 'PAY');
    // 实测（2026-08-30）：支付成功时业务 status=0，响应体不含明确成功字段；
    // 支付是否真正成功以 queryOrderDetails 的 orderStatus/payTime 为准。
    // 因此这里只在业务错误时判失败，其余返回 UNKNOWN 交由有界查询落定（绝不自行重试支付）。
    return { status: 'UNKNOWN', providerCode: 'PAY_ACCEPTED_QUERY_REQUIRED' };
  }

  async refund(input: RefundOrderInput): Promise<RefundResult> {
    // MVP 退款只允许明确标识的模拟退款
    return { status: 'SIMULATED_REFUNDED', providerCode: 'SIMULATED_REFUND' };
  }

  async getOrder(orderNo: string): Promise<FlightOrderResult> {
    const { status, json } = await this.post('/queryOrderDetails.do', { orderNo });
    if (status !== 200) this.mapHttpError(status, json, 'QUERY');
    if (json?.status !== 0) this.mapBusinessError(json, 'QUERY');
    // 实测（2026-08-30）：字段在响应顶层（非 data 内）：orderStatus/ticketStatus/pnrCode/paxTicketInfos。
    const data = (json?.data && Object.keys(json.data).length > 0 ? json.data : json) ?? {};
    // PNR：顶层 pnrCode 优先；票号与分段 PNR 在乘客列表 paxTicketInfos[] 里。
    const passengers: any[] = Array.isArray(data?.paxTicketInfos)
      ? data.paxTicketInfos
      : Array.isArray(data?.passengers)
        ? data.passengers
        : [];
    const pnrSet = new Set<string>();
    if (typeof data?.pnrCode === 'string' && data.pnrCode) pnrSet.add(data.pnrCode);
    passengers.forEach((p) => {
      (Array.isArray(p?.airlinePNRs) ? p.airlinePNRs : []).forEach((x: unknown) => typeof x === 'string' && x && pnrSet.add(x));
    });
    const ticketSet = new Set<string>();
    passengers.forEach((p) => {
      (Array.isArray(p?.ticketNos) ? p.ticketNos : []).forEach((x: unknown) => typeof x === 'string' && x && ticketSet.add(x));
    });
    const orderStatus = data.orderStatus !== undefined && data.orderStatus !== null ? String(data.orderStatus) : undefined;
    const ticketStatus = data.ticketStatus !== undefined && data.ticketStatus !== null ? String(data.ticketStatus) : undefined;
    // 实测语义：orderStatus=1 且有 payTime = 已支付；-3 = 已取消；0 = 未支付。
    const hasPayTime = typeof data?.payTime === 'string' && !!data.payTime;
    return {
      orderNo: String(data.orderNo || data.order_no || orderNo),
      status:
        orderStatus === '-3' ? 'ORDER_CANCELLED' : orderStatus === '0' ? 'UNPAID' : ticketStatus === '1' ? 'TICKETED' : hasPayTime || orderStatus === '1' ? 'PAID' : 'UNKNOWN',
      currency: data.currency,
      amount: Number(data.totalPrice ?? data.amount ?? 0) || undefined,
      // 支付截止时间（实测字段 tktLimitTime，格式 "2026-08-30 17:38:13"，服务器时区）。
      paymentDeadlineAt: typeof data?.tktLimitTime === 'string' ? data.tktLimitTime.replace(' ', 'T') : undefined,
      orderStatus,
      ticketStatus,
      pnrList: Array.from(pnrSet),
      ticketNumbers: Array.from(ticketSet),
    };
  }

  /** 注册 Sandbox webhook：首次仅发送 url；只有接口明确要求时才补 cid。 */
  async updateWebhookUrl(url: string): Promise<{ status: number; rawHash: string }> {
    const body: Record<string, string> = { url };
    if (this.cid) body.cid = this.cid;
    const { status, json } = await this.post('/updateWebhookURL.do', body);
    const rawHash = createHash('sha256').update(JSON.stringify(json ?? {})).digest('hex');
    return { status, rawHash };
  }
}
