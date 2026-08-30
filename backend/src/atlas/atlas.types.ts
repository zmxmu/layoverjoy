/**
 * Atlas Provider 契约。
 * 契约来源：00 启动说明 §5、03 技术方案 §13、atlas-flight-booking-skill CLI 契约。
 * 所有 providerOfferId / routingIdentifier 均为 opaque，原样透传，不解析不构造。
 */

export interface FlightSearchInput {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  adults?: number;
  currency?: string;
  airlines?: string[];
}

export interface FlightOffer {
  providerOfferId: string;
  routingIdentifier?: string;
  origin: string;
  destination: string;
  departureAt: string; // ISO
  arrivalAt: string; // ISO
  carrier?: string;
  flightNumber?: string;
  currency: string;
  totalPrice: number;
  priceStatus: 'current' | 'reference';
  bookable: boolean;
  /** 上游报价有效期（Atlas Search 响应 `expireTime`）；过期后不得 Verify/Order/Pay。 */
  expiresAt?: string; // ISO
  baggageJson?: unknown;
  raw?: unknown; // 脱敏后的原始结构（仅服务端）
}

export interface VerifiedOffer {
  providerOfferId: string;
  sessionId?: string;
  currency: string;
  totalPrice: number;
  priceStatus: 'current' | 'reference';
  priceChanged: boolean;
  previousTotal?: number;
  bookable: boolean;
  bookingRequirements?: unknown;
}

export interface CreateOrderInput {
  bookingReference: string; // sessionId 或 offerId 等 opaque 标识
  passengers: unknown;
  idempotencyKey: string;
}

export interface FlightOrderResult {
  orderNo: string;
  status: string;
  currency?: string;
  amount?: number;
  /** 支付截止时间（上游返回时才有）。 */
  paymentDeadlineAt?: string;
  /** 出票信息（仅 queryOrderDetails 解析后才有）。 */
  pnrList?: string[];
  ticketNumbers?: string[];
  orderStatus?: string; // 上游 orderStatus 枚举（0/1/2/-3）
  ticketStatus?: string; // 上游 ticketStatus 枚举（0/1）
}

export interface PayOrderInput {
  orderNo: string;
  paymentConfirmationId?: string;
  idempotencyKey: string;
}

export interface PaymentResult {
  status: 'PAID' | 'FAILED' | 'UNKNOWN';
  providerCode?: string;
}

export interface RefundOrderInput {
  orderNo: string;
  reason?: string;
}

export interface RefundResult {
  status: 'SIMULATED_REFUND_PENDING' | 'SIMULATED_REFUNDED';
  providerCode?: string;
}

export interface FlightProvider {
  readonly name: string;
  search(input: FlightSearchInput): Promise<FlightOffer[]>;
  verify(offerIdentifier: string): Promise<VerifiedOffer>;
  createOrder(input: CreateOrderInput): Promise<FlightOrderResult>;
  pay(input: PayOrderInput): Promise<PaymentResult>;
  refund(input: RefundOrderInput): Promise<RefundResult>;
  getOrder(orderNo: string): Promise<FlightOrderResult>;
}
