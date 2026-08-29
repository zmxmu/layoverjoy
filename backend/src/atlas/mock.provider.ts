import { createHash, randomUUID } from 'crypto';
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
 * MockAtlasProvider：确定性模拟数据。
 * 用途：外部凭证缺失时的完整闭环、本地开发、契约测试。
 * 价格全部为模拟价格，输出必须带 isSimulated / Sandbox 测试标签。
 */
export class MockAtlasProvider implements FlightProvider {
  readonly name = 'MOCK';

  /** 产品原型故事价格（SIN→KUL→PVG 主线），其他路线使用确定性派生价。 */
  private static readonly STORY_PRICES: Record<string, number> = {
    'SIN-KUL': 210,
    'KUL-SIN': 205,
    'KUL-PVG': 282,
    'KUL-SHA': 282,
    'SIN-PVG': 420,
    'SIN-SHA': 420,
    'SIN-BKK': 190,
    'BKK-PVG': 305,
    'SIN-HKG': 240,
    'HKG-PVG': 260,
  };

  private hash(s: string): number {
    return createHash('sha256').update(s).digest().readUInt32BE(0);
  }

  private basePrice(origin: string, destination: string): number {
    const key = `${origin}-${destination}`;
    if (MockAtlasProvider.STORY_PRICES[key]) return MockAtlasProvider.STORY_PRICES[key];
    return 150 + (this.hash(key) % 220);
  }

  async search(input: FlightSearchInput): Promise<FlightOffer[]> {
    const currency = input.currency || 'SGD';
    const date = new Date(`${input.departDate}T00:00:00Z`);
    const offers: FlightOffer[] = [];
    const hours = [8, 13, 19];
    for (let i = 0; i < hours.length; i++) {
      const h = hours[i];
      const dep = new Date(date.getTime() + h * 3600_000);
      const arr = new Date(dep.getTime() + (2 + (this.hash(`${input.origin}${input.destination}${i}`) % 3)) * 3600_000);
      const price = this.basePrice(input.origin, input.destination) + i * 17;
      offers.push({
        providerOfferId: `mock-offer-${input.origin}-${input.destination}-${input.departDate}-${i}`,
        routingIdentifier: `mock-routing-${this.hash(input.origin + input.destination + input.departDate + i)}`,
        origin: input.origin,
        destination: input.destination,
        departureAt: dep.toISOString(),
        arrivalAt: arr.toISOString(),
        carrier: i === 0 ? 'AtlasDemo Air' : 'AtlasDemo Connect',
        flightNumber: `AD${100 + this.hash(input.origin + input.destination + i) % 800}`,
        currency,
        totalPrice: price,
        priceStatus: 'current',
        bookable: true,
        baggageJson: { includedCheckedBags: i === 2 ? 0 : 1 },
      });
    }
    // 额外提供一个 reference 报价，仅用于比较，不可出票
    offers.push({
      ...offers[0],
      providerOfferId: `${offers[0].providerOfferId}-ref`,
      priceStatus: 'reference',
      bookable: false,
      totalPrice: offers[0].totalPrice - 12,
    });
    return offers;
  }

  async verify(offerIdentifier: string): Promise<VerifiedOffer> {
    // 演示涨价：offer 标识带 -drift 后缀时模拟价格上涨
    const drift = offerIdentifier.includes('-drift');
    const base = 282;
    return {
      providerOfferId: offerIdentifier.replace(/-drift$/, ''),
      sessionId: `mock-session-${randomUUID().slice(0, 8)}`,
      currency: 'SGD',
      totalPrice: drift ? Math.round(base * 1.08) : base,
      priceStatus: 'current',
      priceChanged: drift,
      previousTotal: drift ? base : undefined,
      bookable: true,
      bookingRequirements: { passengersRequired: true, contactRequired: true },
    };
  }

  async createOrder(input: CreateOrderInput): Promise<FlightOrderResult> {
    const fail = input.bookingReference.includes('-legb-fail');
    if (fail) {
      const err: any = new Error('INVENTORY_CHANGED');
      err.providerCode = 'INVENTORY_UNAVAILABLE';
      throw err;
    }
    const orderNo = `MOCK-ORD-${randomUUID().slice(0, 8).toUpperCase()}`;
    return {
      orderNo,
      status: 'CREATED',
      currency: 'SGD',
      amount: 282,
      paymentConfirmationId: `mock-pay-${randomUUID().slice(0, 8)}`,
    };
  }

  async pay(input: PayOrderInput): Promise<PaymentResult> {
    // 模拟支付：绝不收集真实银行卡信息
    if (input.orderNo.includes('FAIL')) return { status: 'FAILED', providerCode: 'PAYMENT_DECLINED' };
    if (input.orderNo.includes('UNKNOWN')) return { status: 'UNKNOWN', providerCode: 'OUTCOME_UNKNOWN' };
    return { status: 'PAID', providerCode: 'PAYMENT_SUCCESS' };
  }

  async refund(_input: RefundOrderInput): Promise<RefundResult> {
    // 明确标识的模拟退款，没有发生真实资金交易
    return { status: 'SIMULATED_REFUNDED', providerCode: 'SIMULATED_REFUND' };
  }

  async getOrder(orderNo: string): Promise<FlightOrderResult> {
    return { orderNo, status: 'CREATED', currency: 'SGD', amount: 282 };
  }
}
