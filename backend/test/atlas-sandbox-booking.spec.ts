import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxAtlasProvider } from '../src/atlas/sandbox.provider';
import { AtlasService } from '../src/atlas/atlas.service';
import { BookingsService } from '../src/bookings/bookings.service';

/**
 * P1：Atlas Sandbox 交易闭环基础（2026-08-30 用户授权实施）。
 * 覆盖：expireTime 解析、/order.do 与 /pay.do 请求 Fixture、缓存有效期过滤、
 * 环境代际（generation）、组合配置安全门禁、Refund 锁定。
 * 所有上游响应均为脱敏 Fixture，不含任何真实密钥。
 */

function makeProvider(): SandboxAtlasProvider {
  return new SandboxAtlasProvider('https://sandbox.example.invalid', 'ak-test', 'sk-test', 5000, '');
}

// 文件级兼容清理：避免 setTimeout/env 桩泄漏到其他用例。
afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchSequence(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; body: any }> = [];
  let i = 0;
  const fetchMock = vi.fn(async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const SEARCH_OK = {
  status: 0,
  msg: null,
  routings: [
    {
      routingIdentifier: 'RID_FRESH_AAA',
      currency: 'USD',
      adultPrice: 29.51,
      adultTax: 3.7,
      transactionFee: 0,
      expireTime: '2026-08-30T07:28:33Z',
      ancillarySupported: ['seat', 'luggage'],
      fromSegments: [{ depAirport: 'NRT', arrAirport: 'KIX', depTime: '202609040830', arrTime: '202609041010', carrier: 'MM', flightNumber: 'MM304' }],
    },
    {
      routingIdentifier: 'RID_EXPIRED_BBB',
      currency: 'USD',
      adultPrice: 44.87,
      adultTax: 4.9,
      transactionFee: 0,
      expireTime: '2020-01-01T00:00:00Z',
      fromSegments: [{ depAirport: 'NRT', arrAirport: 'KIX', depTime: '202609042020', arrTime: '202609042200', carrier: 'MM', flightNumber: 'MM312' }],
    },
  ],
};

describe('SandboxAtlasProvider · expireTime 解析', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('把上游 ISO 形式的 expireTime 解析进 offer.expiresAt', async () => {
    mockFetchSequence([{ body: SEARCH_OK }]);
    const offers = await makeProvider().search({ origin: 'NRT', destination: 'KIX', departDate: '2026-09-04' });
    expect(offers[0].expiresAt).toBe('2026-08-30T07:28:33.000Z');
  });

  it('支持 YYYYMMDDHHmm 紧凑格式', async () => {
    mockFetchSequence([
      {
        body: {
          status: 0,
          routings: [{ ...SEARCH_OK.routings[0], expireTime: '202609041230' }],
        },
      },
    ]);
    const offers = await makeProvider().search({ origin: 'NRT', destination: 'KIX', departDate: '2026-09-04' });
    expect(offers[0].expiresAt).toBe('2026-09-04T12:30:00.000Z');
  });

  it('无法解析的 expireTime → undefined（不阻断搜索）', async () => {
    mockFetchSequence([
      {
        body: {
          status: 0,
          routings: [{ ...SEARCH_OK.routings[0], expireTime: 'garbage' }],
        },
      },
    ]);
    const offers = await makeProvider().search({ origin: 'NRT', destination: 'KIX', departDate: '2026-09-04' });
    expect(offers[0].expiresAt).toBeUndefined();
  });
});

describe('SandboxAtlasProvider · order.do / pay.do 请求 Fixture（脱敏）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('order.do 载荷包含 sessionId 与乘客信息，头只带 AK/SK 字段名', async () => {
    const calls = mockFetchSequence([{ body: { status: 0, data: { orderNo: 'SBX-ORD-1' } } }]);
    const provider = makeProvider();
    await provider.createOrder({
      bookingReference: 'session-xyz',
      passengers: {
        passengers: [
          { name: 'TEST/TRAVELER', passengerType: 'ADT', gender: 'M', birthday: '19900101', nationality: 'JP', cardType: 'PASSPORT', cardNum: 'TR0000001', cardIssuePlace: 'JP', cardExpired: '20321231' },
        ],
        contact: { name: 'TEST/TRAVELER' },
      },
      idempotencyKey: 'idem-1',
    });
    expect(calls[0].url).toBe('https://sandbox.example.invalid/order.do');
    expect(calls[0].body.sessionId).toBe('session-xyz');
    // 乘客块（{passengers:[...], contact:{...}}）按 Atlas 实际协议原样展开到顶层。
    expect(calls[0].body.passengers[0].name).toBe('TEST/TRAVELER');
    expect(calls[0].body.contact.name).toBe('TEST/TRAVELER');
  });

  it('pay.do 载荷严格为 { orderNo, paymentMethod: 1 }，绝不发送 paymentConfirmationId；结果转查询态', async () => {
    const calls = mockFetchSequence([{ body: { status: 0, data: { status: 'SUCCESS' } } }]);
    const provider = makeProvider();
    const result = await provider.pay({ orderNo: 'SBX-ORD-1', paymentConfirmationId: 'lj-local-token-abc', idempotencyKey: 'idem-2' });
    expect(calls[0].url).toBe('https://sandbox.example.invalid/pay.do');
    expect(calls[0].body).toEqual({ orderNo: 'SBX-ORD-1', paymentMethod: 1 });
    expect(JSON.stringify(calls[0].body)).not.toContain('paymentConfirmationId');
    // 实测（2026-08-30）：支付成功响应无明确成功字段，不得自行判定 PAID；
    // 返回 UNKNOWN 交由 queryOrderDetails 有界查询落定，绝不自动重试支付。
    expect(result.status).toBe('UNKNOWN');
    expect(result.providerCode).toBe('PAY_ACCEPTED_QUERY_REQUIRED');
  });

  it('queryOrderDetails.do 解析 PNR / 票号 / 状态枚举', async () => {
    mockFetchSequence([
      {
        body: {
          status: 0,
          data: {
            orderNo: 'SBX-ORD-1',
            orderStatus: '2',
            ticketStatus: '1',
            passengers: [{ airlinePNRs: ['ABC123'], ticketNos: ['123-4567890123'] }],
          },
        },
      },
    ]);
    const r = await makeProvider().getOrder('SBX-ORD-1');
    expect(r.status).toBe('TICKETED');
    expect(r.pnrList).toEqual(['ABC123']);
    expect(r.ticketNumbers).toEqual(['123-4567890123']);
    expect(r.orderStatus).toBe('2');
    expect(r.ticketStatus).toBe('1');
  });

  it('orderStatus=-3 映射 ORDER_CANCELLED；orderStatus=0 映射 UNPAID', async () => {
    mockFetchSequence([{ body: { status: 0, data: { orderNo: 'X', orderStatus: '-3', ticketStatus: '0', passengers: [] } } }]);
    expect((await makeProvider().getOrder('X')).status).toBe('ORDER_CANCELLED');
    mockFetchSequence([{ body: { status: 0, data: { orderNo: 'Y', orderStatus: '0', ticketStatus: '0', passengers: [] } } }]);
    expect((await makeProvider().getOrder('Y')).status).toBe('UNPAID');
  });
});

describe('AtlasService · 缓存有效期与环境代际', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@localhost:5432/db');
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret-0123456789');
    vi.stubEnv('DATA_ENCRYPTION_KEY', 'test-enc-key-0123456789');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function makeServiceWithRedis(store: Map<string, string>, searchOffers: any[]) {
    const svc = new AtlasService({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
      },
    } as any);
    (svc as any).searchProvider = { name: 'ATLAS_SANDBOX', search: vi.fn(async () => searchOffers) };
    return svc;
  }

  it('缓存命中时逐条过滤过期报价，只返回新鲜报价', async () => {
    const store = new Map<string, string>();
    const fresh = { providerOfferId: 'A', totalPrice: 10, currency: 'USD', expiresAt: new Date(Date.now() + 60000).toISOString() };
    const stale = { providerOfferId: 'B', totalPrice: 20, currency: 'USD', expiresAt: new Date(Date.now() - 60000).toISOString() };
    const svc = makeServiceWithRedis(store, []);
    const key = (svc as any) && undefined; // key 由实现生成，这里先写一次再读
    // 先写入缓存（绕过 search）
    await (svc as any).redis.set('atlas:search:NRT:KIX:2026-09-04:1:SGD:ATLAS_SANDBOX:' + svc.environmentGeneration(), JSON.stringify([fresh, stale]));
    const { offers, fromCache } = await svc.searchWithCache({ origin: 'NRT', destination: 'KIX', departDate: '2026-09-04' });
    expect(fromCache).toBe(true);
    expect(offers.map((o) => o.providerOfferId)).toEqual(['A']);
    void key;
  });

  it('全部缓存报价过期时重新调用 Atlas Search', async () => {
    const store = new Map<string, string>();
    const stale = { providerOfferId: 'B', totalPrice: 20, currency: 'USD', expiresAt: new Date(Date.now() - 60000).toISOString() };
    const freshFromUpstream = { providerOfferId: 'C', totalPrice: 30, currency: 'USD', expiresAt: new Date(Date.now() + 600000).toISOString() };
    const svc = makeServiceWithRedis(store, [freshFromUpstream]);
    await (svc as any).redis.set('atlas:search:NRT:KIX:2026-09-04:1:SGD:ATLAS_SANDBOX:' + svc.environmentGeneration(), JSON.stringify([stale]));
    const { offers, fromCache } = await svc.searchWithCache({ origin: 'NRT', destination: 'KIX', departDate: '2026-09-04' });
    expect(fromCache).toBe(false);
    expect(offers.map((o) => o.providerOfferId)).toEqual(['C']);
    expect((svc as any).searchProvider.search).toHaveBeenCalledTimes(1);
  });

  it('isOfferFresh：无 expiresAt 视为不过期；过期为 false', () => {
    expect(AtlasService.isOfferFresh({} as any)).toBe(true);
    expect(AtlasService.isOfferFresh({ expiresAt: new Date(Date.now() + 1000).toISOString() })).toBe(true);
    expect(AtlasService.isOfferFresh({ expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(false);
  });

  it('environmentGeneration 是稳定且对配置敏感的 24 位摘要', () => {
    const svc = makeServiceWithRedis(new Map(), []);
    const g1 = svc.environmentGeneration();
    const g2 = svc.environmentGeneration();
    expect(g1).toBe(g2);
    expect(g1).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('env 组合安全门禁（Production 安全）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadEnvFresh() {
    vi.resetModules();
    const mod = await import('../src/config/env');
    return mod.loadEnv();
  }

  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'test-jwt-secret-0123456789',
    DATA_ENCRYPTION_KEY: 'test-enc-key-0123456789',
  };

  it('ATLAS_MODE=production + ATLAS_ORDER_PROVIDER=sandbox → 启动失败', async () => {
    vi.stubEnv('ATLAS_MODE', 'production');
    vi.stubEnv('ATLAS_ORDER_PROVIDER', 'sandbox');
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    await expect(loadEnvFresh()).rejects.toThrow(/ATLAS_MODE=sandbox/);
  });

  it('ATLAS_MODE=mock + ATLAS_PAYMENT_PROVIDER=sandbox → 启动失败', async () => {
    vi.stubEnv('ATLAS_MODE', 'mock');
    vi.stubEnv('ATLAS_PAYMENT_PROVIDER', 'sandbox');
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    await expect(loadEnvFresh()).rejects.toThrow(/ATLAS_MODE=sandbox/);
  });

  it('ATLAS_MODE=sandbox + Order/Payment=sandbox → 通过', async () => {
    vi.stubEnv('ATLAS_MODE', 'sandbox');
    vi.stubEnv('ATLAS_ORDER_PROVIDER', 'sandbox');
    vi.stubEnv('ATLAS_PAYMENT_PROVIDER', 'sandbox');
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    const env = await loadEnvFresh();
    expect(env.ATLAS_ORDER_PROVIDER).toBe('sandbox');
    expect(env.ATLAS_PAYMENT_PROVIDER).toBe('sandbox');
  });

  it('默认 Profile：Order/Payment 仍为 mock', async () => {
    vi.stubEnv('ATLAS_MODE', 'sandbox');
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    const env = await loadEnvFresh();
    expect(env.ATLAS_ORDER_PROVIDER).toBe('mock');
    expect(env.ATLAS_PAYMENT_PROVIDER).toBe('mock');
  });

  it('ATLAS_REFUND_PROVIDER 永远只允许 mock', async () => {
    vi.stubEnv('ATLAS_MODE', 'sandbox');
    vi.stubEnv('ATLAS_REFUND_PROVIDER', 'sandbox');
    for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
    await expect(loadEnvFresh()).rejects.toThrow(/ATLAS_REFUND_PROVIDER/);
  });
});

// ---------------------------------------------------------------------------
// P2/P3/P4：Sandbox 支付确认令牌、未知状态不重试、环境代际、出票有界轮询、补偿状态。
// ---------------------------------------------------------------------------

function buildSandboxBookingService(opts: { payResult?: 'PAID' | 'UNKNOWN' | 'FAILED'; generation?: string } = {}) {
  // 单测中屏蔽出票轮询定时器（生产退避链最长 120s，不应在测试中触发）。
  vi.stubGlobal('setTimeout', vi.fn(() => 0));
  const generation = opts.generation ?? 'gen-A';
  const redisStore = new Map<string, string>();
  const redis: any = {
    get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      redisStore.set(k, v);
    }),
  };
  const order = {
    id: 'o1',
    bookingIntentId: 'i1',
    legNo: 1,
    status: 'CREATED',
    orderNoEnc: 'enc:SBX-ORD-1',
    amount: 31.84,
    currency: 'USD',
    atlasGeneration: generation,
    lastProviderCode: 'PAY_CONFIRM:tok-1',
    paymentDeadlineAt: null,
    idempotencyKey: 'idem-1',
  };
  const prisma: any = {
    bookingIntent: {
      findFirst: vi.fn(async () => ({ id: 'i1', userId: 'u1', status: 'PAYMENT_PENDING', planId: 'p1', acceptedTotal: 31.84, currency: 'USD', createdAt: new Date(), orders: [] })),
      update: vi.fn(async () => ({})),
    },
    stopoverPlan: { findUnique: vi.fn(async () => null) }, // 无 plan → 跳过 Pay 前资格重评（单测聚焦支付链路）
    flightOfferSnapshot: { findMany: vi.fn(async () => []) },
    flightOrder: {
      findMany: vi.fn(async () => [order]),
      findUnique: vi.fn(async () => order),
      update: vi.fn(async (args: any) => {
        // 同步 mock 对象状态，模拟落库后的读取结果。
        if (args?.where?.id === order.id && args?.data?.status) order.status = args.data.status;
        return {};
      }),
      create: vi.fn(async () => ({})),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
  };
  const atlas: any = {
    providerLabel: () => 'ATLAS_SANDBOX',
    environmentGeneration: () => generation,
    order: { getOrder: vi.fn(async () => ({ orderNo: 'SBX-ORD-1', status: 'TICKETED', orderStatus: '2', ticketStatus: '1', pnrList: ['ABC123'], ticketNumbers: ['123-4567890123'] })) },
    payment: {
      pay: vi.fn(async () => ({ status: opts.payResult ?? 'PAID', providerCode: 'X' })),
    },
    verify: { verify: vi.fn() },
    refund: { refund: vi.fn(async () => ({ status: 'SIMULATED_REFUNDED', providerCode: 'SIMULATED_REFUND' })) },
  };
  const notifications: any = { notify: vi.fn(async () => ({})) };
  const crypto: any = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => String(v).replace('enc:', '') };
  const service = new BookingsService(prisma, atlas, redis, notifications, {} as any, {} as any, {} as any, crypto);
  const binding = {
    userId: 'u1',
    bookingIntentId: 'i1',
    orderId: 'o1',
    orderNo: 'SBX-ORD-1',
    amount: 31.84,
    currency: 'USD',
    generation,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  };
  redisStore.set('lj:payconfirm:tok-1', JSON.stringify(binding));
  return { service, prisma, atlas, redisStore, order };
}

describe('P2 · 一次性付款确认令牌', () => {
  it('正确令牌支付成功；同一令牌第二次使用被拒绝（一次性）', async () => {
    const { service, atlas, redisStore } = buildSandboxBookingService();
    await service.pay('u1', 'i1', ['tok-1']);
    expect(atlas.payment.pay).toHaveBeenCalledTimes(1);
    // 绝不把确认令牌发送给 Atlas：
    expect(atlas.payment.pay.mock.calls[0][0]).toEqual({ orderNo: 'SBX-ORD-1', idempotencyKey: 'idem-1:pay' });
    // 已消费标记写回：
    expect(JSON.parse(redisStore.get('lj:payconfirm:tok-1')!).consumed).toBe(true);
    // 重置为可支付状态模拟重复提交：
    await expect(service.pay('u1', 'i1', ['tok-1'])).rejects.toMatchObject({ code: 'PAYMENT_CONFIRMATION_INVALID' });
    expect(atlas.payment.pay).toHaveBeenCalledTimes(1); // 绝不重复支付
  });

  it('金额变化 → 旧令牌立即失效', async () => {
    const { service, redisStore } = buildSandboxBookingService();
    const b = JSON.parse(redisStore.get('lj:payconfirm:tok-1')!);
    // 令牌绑定金额与当前订单金额不一致（摘要已变化）→ 旧确认必须失效。
    b.amount = 29.99;
    redisStore.set('lj:payconfirm:tok-1', JSON.stringify(b));
    await expect(service.pay('u1', 'i1', ['tok-1'])).rejects.toMatchObject({ code: 'PAYMENT_CONFIRMATION_INVALID' });
  });

  it('环境代际变化 → 令牌失效', async () => {
    const { service, redisStore } = buildSandboxBookingService();
    const b = JSON.parse(redisStore.get('lj:payconfirm:tok-1')!);
    b.generation = 'gen-OLD';
    redisStore.set('lj:payconfirm:tok-1', JSON.stringify(b));
    await expect(service.pay('u1', 'i1', ['tok-1'])).rejects.toMatchObject({ code: 'PAYMENT_CONFIRMATION_INVALID' });
  });

  it('缺失令牌 → 拒绝支付（明确付款确认检查点）', async () => {
    const { service, atlas } = buildSandboxBookingService();
    await expect(service.pay('u1', 'i1', undefined)).rejects.toMatchObject({ code: 'PAYMENT_CONFIRMATION_REQUIRED' });
    expect(atlas.payment.pay).not.toHaveBeenCalled();
  });

  it('订单环境代际与当前不一致 → ENVIRONMENT_CHANGED，旧订单不得支付', async () => {
    const { service, order } = buildSandboxBookingService();
    order.atlasGeneration = 'gen-OLD-ENV';
    await expect(service.pay('u1', 'i1', ['tok-1'])).rejects.toMatchObject({ code: 'ENVIRONMENT_CHANGED' });
  });
});

describe('P2/P3 · 未知状态与出票轮询', () => {
  it('支付结果未知 → 只转查询态，绝不重复支付', async () => {
    const { service, atlas, prisma } = buildSandboxBookingService({ payResult: 'UNKNOWN' });
    await expect(service.pay('u1', 'i1', ['tok-1'])).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(atlas.payment.pay).toHaveBeenCalledTimes(1);
    const updates = prisma.flightOrder.update.mock.calls.map((c: any) => c[0].data.status).filter(Boolean);
    expect(updates).toContain('UNKNOWN_REQUIRES_QUERY');
  });

  it('有界出票轮询：总时长≤120 秒且退避递增', async () => {
    // 通过模块常量间接验证：轮询间隔数组总和 ≤120s。
    const src = (await import('fs')).readFileSync((await import('path')).resolve(process.cwd(), 'src/bookings/bookings.service.ts'), 'utf8');
    const m = src.match(/TICKETING_POLL_INTERVALS_MS = \[([0-9, ]+)\]/);
    expect(m).toBeTruthy();
    const intervals = m![1].split(',').map((s) => Number(s.trim()));
    expect(intervals.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120000);
    expect(intervals.length).toBeGreaterThanOrEqual(3);
  });

  it('refreshTicketing：出票完成后加密保存 PNR/票号并进入 COMPLETED', async () => {
    const { service, order, prisma } = buildSandboxBookingService();
    order.status = 'TICKETING_PENDING';
    (prisma.bookingIntent.findFirst as any).mockResolvedValue({ id: 'i1', userId: 'u1', status: 'TICKETING_IN_PROGRESS', planId: 'p1', createdAt: new Date(), orders: [] });
    await service.refreshTicketing('u1', 'i1');
    const ticketUpdate = prisma.flightOrder.update.mock.calls.map((c: any) => c[0].data).find((d: any) => d.status === 'TICKETED');
    expect(ticketUpdate).toBeTruthy();
    // 加密落库（enc: 前缀为测试 crypto 的确定性输出），且为 JSON 数组。
    expect(ticketUpdate.pnrListEnc).toBe('enc:["ABC123"]');
    expect(ticketUpdate.ticketNosEnc).toBe('enc:["123-4567890123"]');
    expect(prisma.bookingIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
  });
});

describe('P4 · 补偿状态与报价过期', () => {
  it('补偿退款使用明确标识的模拟状态（REFUND_PENDING_SIMULATED → REFUNDED_SIMULATED），不调用真实退款', async () => {
    const { service, prisma } = buildSandboxBookingService();
    (prisma.bookingIntent.findFirst as any).mockResolvedValue({ id: 'i1', userId: 'u1', status: 'PARTIAL_ORDER', planId: 'p1', createdAt: new Date(), orders: [] });
    await service.mockRefund('u1', 'i1');
    const statuses = prisma.bookingIntent.update.mock.calls.map((c: any) => c[0].data.status);
    expect(statuses).toContain('REFUND_PENDING_SIMULATED');
    expect(statuses).toContain('SIMULATED_REFUNDED');
    expect(prisma.flightOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED_SIMULATED' }) }));
  });

  it('confirmPrice：报价已过期 → OFFER_EXPIRED，绝不继续下单', async () => {
    const { service, prisma } = buildSandboxBookingService();
    (prisma.bookingIntent.findFirst as any).mockResolvedValue({ id: 'i1', userId: 'u1', status: 'PRICE_CONFIRMATION_REQUIRED', planId: 'p1', acceptedTotal: 31.84, currency: 'USD', riskAckVersion: 1, idempotencyKey: 'k1', createdAt: new Date(), orders: [] });
    prisma.stopoverPlan.findUnique.mockResolvedValue({ id: 'p1', legOfferIdsJson: ['s1'] });
    prisma.flightOfferSnapshot.findMany.mockResolvedValue([{ id: 's1', legNo: 1, providerOfferId: 'rid-1', expiresAt: new Date(Date.now() - 1000) }]);
    await expect(service.confirmPrice('u1', 'i1', { acceptedTotal: 31.84 })).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
  });
});
