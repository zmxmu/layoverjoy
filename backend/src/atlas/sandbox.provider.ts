import { createHash } from 'crypto';
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
 * 注意：真实请求/响应 Fixture 尚未抓取（Preflight PENDING），
 * 因此响应解析采用防御式多候选字段策略，绝不手工猜测完整层级。
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

  private pick(obj: any, keys: string[]): any {
    for (const k of keys) {
      if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
    }
    return undefined;
  }

  async search(input: FlightSearchInput): Promise<FlightOffer[]> {
    const { status, json } = await this.post(
      '/search.do',
      {
        origin: input.origin,
        destination: input.destination,
        departDate: input.departDate,
        adults: input.adults ?? 1,
        currency: input.currency,
        airlines: input.airlines,
      },
      true, // Search 读操作允许重试一次
    );
    if (status !== 200) this.mapHttpError(status, json, 'SEARCH');

    // 防御式解析：候选字段路径（真实 Fixture 抓取后再收紧）
    const rawOffers: any[] =
      this.pick(json, ['offers']) ||
      this.pick(json?.data, ['offers', 'routings', 'flightRoutings', 'results']) ||
      [];
    const offers: FlightOffer[] = [];
    for (const o of Array.isArray(rawOffers) ? rawOffers : []) {
      const providerOfferId = this.pick(o, ['offer_id', 'offerId', 'id', 'routingIdentifier']);
      if (!providerOfferId) continue;
      const seg = this.pick(o, ['segment', 'segments', 'flightSegment']) || {};
      const firstSeg = Array.isArray(seg) ? seg[0] : seg;
      offers.push({
        providerOfferId: String(providerOfferId),
        routingIdentifier: this.pick(o, ['routingIdentifier', 'routing_identifier', 'search_id', 'searchId']),
        origin: this.pick(firstSeg, ['origin', 'from', 'departureAirport']) ?? input.origin,
        destination: this.pick(firstSeg, ['destination', 'to', 'arrivalAirport']) ?? input.destination,
        departureAt: this.pick(o, ['departureAt', 'departureTime', 'departTime']) || this.pick(firstSeg, ['departureTime', 'departTime']),
        arrivalAt: this.pick(o, ['arrivalAt', 'arrivalTime', 'arriveTime']) || this.pick(firstSeg, ['arrivalTime', 'arriveTime']),
        carrier: this.pick(o, ['carrier', 'marketingCarrier', 'airline']) || this.pick(firstSeg, ['carrier', 'airline']),
        flightNumber: this.pick(o, ['flightNumber', 'flightNo']) || this.pick(firstSeg, ['flightNumber', 'flightNo']),
        currency: this.pick(o, ['currency']) || input.currency || 'SGD',
        totalPrice: Number(this.pick(o, ['totalPrice', 'total_price', 'price', 'amount', 'totalAmount']) ?? 0),
        priceStatus: (this.pick(o, ['priceStatus', 'price_status']) || 'current') as 'current' | 'reference',
        bookable: this.pick(o, ['bookable']) !== false,
        baggageJson: this.pick(o, ['baggageElements', 'baggage']),
        raw: o,
      });
    }
    if (offers.length === 0) {
      throw new AppError(
        'NO_SANDBOX_INVENTORY',
        'Atlas Sandbox 暂无该航线的测试航班数据。',
        404,
        false,
        { origin: input.origin, destination: input.destination, departDate: input.departDate },
      );
    }
    return offers;
  }

  async verify(offerIdentifier: string): Promise<VerifiedOffer> {
    const { status, json } = await this.post('/verify.do', { offerId: offerIdentifier, routingIdentifier: offerIdentifier });
    if (status !== 200) this.mapHttpError(status, json, 'VERIFY');
    const data = json?.data ?? json ?? {};
    const price = Number(this.pick(data, ['totalPrice', 'total_price', 'price', 'amount']) ?? 0);
    return {
      providerOfferId: String(this.pick(data, ['offer_id', 'offerId', 'id']) || offerIdentifier),
      sessionId: this.pick(data, ['sessionId', 'session_id', 'bookingId', 'booking_id']),
      currency: this.pick(data, ['currency']) || 'SGD',
      totalPrice: price,
      priceStatus: 'current',
      priceChanged: this.pick(data, ['priceChanged']) === true,
      bookable: this.pick(data, ['bookable']) !== false,
      bookingRequirements: this.pick(data, ['bookingRequirements', 'booking_requirements']),
    };
  }

  async createOrder(input: CreateOrderInput): Promise<FlightOrderResult> {
    // 副作用操作：不自动重试
    const { status, json } = await this.post('/order.do', {
      sessionId: input.bookingReference,
      passengers: input.passengers,
    });
    if (status !== 200) this.mapHttpError(status, json, 'ORDER');
    const data = json?.data ?? json ?? {};
    return {
      orderNo: String(this.pick(data, ['orderNo', 'order_no', 'orderNumber']) || ''),
      status: String(this.pick(data, ['status']) || 'CREATED'),
      currency: this.pick(data, ['currency']),
      amount: Number(this.pick(data, ['amount', 'totalPrice']) ?? 0) || undefined,
      paymentConfirmationId: this.pick(data, ['paymentConfirmationId', 'payment_confirmation_id']),
    };
  }

  async pay(input: PayOrderInput): Promise<PaymentResult> {
    const { status, json } = await this.post('/pay.do', {
      orderNo: input.orderNo,
      paymentConfirmationId: input.paymentConfirmationId,
    });
    if (status !== 200) this.mapHttpError(status, json, 'PAY');
    const data = json?.data ?? json ?? {};
    const s = String(this.pick(data, ['status']) || '').toUpperCase();
    return {
      status: s.includes('SUCCESS') || s.includes('PAID') ? 'PAID' : s.includes('FAIL') ? 'FAILED' : 'UNKNOWN',
      providerCode: this.pick(data, ['code']),
    };
  }

  async refund(input: RefundOrderInput): Promise<RefundResult> {
    // MVP 退款只允许明确标识的模拟退款
    return { status: 'SIMULATED_REFUNDED', providerCode: 'SIMULATED_REFUND' };
  }

  async getOrder(orderNo: string): Promise<FlightOrderResult> {
    const { status, json } = await this.post('/queryOrderDetails.do', { orderNo });
    if (status !== 200) this.mapHttpError(status, json, 'QUERY');
    const data = json?.data ?? json ?? {};
    return {
      orderNo: String(this.pick(data, ['orderNo', 'order_no']) || orderNo),
      status: String(this.pick(data, ['status']) || 'UNKNOWN'),
      currency: this.pick(data, ['currency']),
      amount: Number(this.pick(data, ['amount', 'totalPrice']) ?? 0) || undefined,
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
