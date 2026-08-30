import { describe, expect, it, vi } from 'vitest';
import { BookingsService } from '../src/bookings/bookings.service';

/**
 * 双订单 Saga 验收用例（审查报告 P0-06）：
 * 状态迁移必须由实际成功下单的腿集合驱动——
 * 覆盖两种单边失败：先下的第二段失败、第一段失败而第二段已成功。
 */

function buildService(orderBehavior: 'ALL_OK' | 'LEG1_FAILS' | 'LEG2_FAILS' | 'ELIGIBILITY_FAIL') {
  const transitions: string[] = [];
  const prisma: any = {
    stopoverPlan: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'plan1',
        searchRunId: 'run1',
        hubCountry: 'MY',
        stayDays: 2,
        airfareTotal: 100,
        currency: 'SGD',
        sourceProvider: 'ATLAS_SANDBOX',
        legOfferIdsJson: ['snap1', 'snap2'],
      }),
    },
    flightOfferSnapshot: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'snap1', legNo: 1, providerOfferId: 'offer-1', origin: 'SIN', destination: 'KUL', departureAt: new Date(), totalPrice: 50 },
        { id: 'snap2', legNo: 2, providerOfferId: 'offer-2', origin: 'KUL', destination: 'SIN', departureAt: new Date(), totalPrice: 50 },
      ]),
    },
    bookingIntent: {
      create: vi.fn().mockResolvedValue({ id: 'intent1' }),
      update: vi.fn().mockImplementation(({ data }: any) => {
        if (data.status) transitions.push(data.status);
        return Promise.resolve({ id: 'intent1', ...data });
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: 'intent1',
        planId: 'plan1',
        status: transitions[transitions.length - 1] ?? 'DRAFT',
        sourceEnvironment: 'ATLAS_SANDBOX',
        isSimulated: true,
        acceptedTotal: 100,
        currency: 'SGD',
        riskAckVersion: 1,
        createdAt: new Date(),
        orders: [],
      }),
    },
    flightOrder: { create: vi.fn().mockResolvedValue({}) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    searchRun: { findUnique: vi.fn().mockResolvedValue({ departureDate: new Date('2026-09-15') }) },
  };

  const atlas: any = {
    verify: {
      // sessionId 区分腿：s1=第一段，s2=第二段
      verify: vi.fn().mockImplementation((offerId: string) =>
        Promise.resolve({
          sessionId: offerId === 'offer-1' ? 's1' : 's2',
          totalPrice: 50,
          currency: 'SGD',
          priceChanged: false,
          bookable: true,
        }),
      ),
    },
    order: {
      createOrder: vi.fn().mockImplementation(({ bookingReference }: any) => {
        if (orderBehavior === 'LEG1_FAILS' && bookingReference === 's1') {
          return Promise.reject(Object.assign(new Error('inventory changed'), { code: 'INVENTORY_CHANGED' }));
        }
        if (orderBehavior === 'LEG2_FAILS' && bookingReference === 's2') {
          return Promise.reject(Object.assign(new Error('inventory changed'), { code: 'INVENTORY_CHANGED' }));
        }
        return Promise.resolve({ orderNo: `ORD-${bookingReference}`, currency: 'SGD', amount: 50 });
      }),
    },
    providerLabel: () => 'ATLAS_SANDBOX',
  };

  const notifications: any = { notify: vi.fn().mockResolvedValue({}) };
  const rules: any = {
    evaluate: vi.fn().mockResolvedValue(
      orderBehavior === 'ELIGIBILITY_FAIL'
        ? { status: 'NEEDS_INFO', reasonCodes: ['ONWARD_TICKET_UNCONFIRMED'], requiredDocuments: [], disclaimerRequired: true }
        : { status: 'ELIGIBLE', reasonCodes: ['VISA_EXEMPT'], requiredDocuments: [], disclaimerRequired: true },
    ),
  };
  const users: any = {
    profileForRules: vi.fn().mockResolvedValue({
      passport: { issuingCountry: 'CN', type: 'ORDINARY', validUntil: '2030-01-01' },
      visas: [],
    }),
  };
  const crypto: any = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.replace('enc:', '') };
  const assessV2: any = {
    assess: vi.fn().mockImplementation(() => ({
      searchDecision: 'ELIGIBLE',
      bookingDecision: orderBehavior === 'ELIGIBILITY_FAIL' ? 'NEEDS_INFO' : 'CONDITIONALLY_ELIGIBLE',
      matchedRuleIds: ['CN_MY_MUTUAL_VISA_FREE'],
      missingFacts: [],
      explanationZh: 'test',
      assessmentId: 'ela_test',
    })),
  };

  const service = new BookingsService(prisma, atlas, notifications, rules, users, assessV2, crypto);
  return { service, transitions, rules, assessV2 };
}

const input = { planId: 'plan1', riskAckVersion: 1, passengers: [{ givenName: 'WEI', familyName: 'ZHANG' }] };

describe('双订单 Saga 状态机', () => {
  it('两段全部成功：B 先下 -> LEG_B_ORDERED -> BOTH_ORDERED -> PAYMENT_PENDING', async () => {
    const { service, transitions } = buildService('ALL_OK');
    await service.createComposite('user1', input);
    expect(transitions).toContain('BOTH_VERIFIED');
    expect(transitions).toContain('LEG_B_ORDERED');
    expect(transitions).toContain('BOTH_ORDERED');
    expect(transitions[transitions.length - 1]).toBe('PAYMENT_PENDING');
    // BOTH_ORDERED 只能出现在两段都成功之后
    expect(transitions.indexOf('LEG_B_ORDERED')).toBeLessThan(transitions.indexOf('BOTH_ORDERED'));
  });

  it('第二段（先下）失败：无任何订单 -> MANUAL_REVIEW，不得谎报 PARTIAL_ORDER', async () => {
    const { service, transitions } = buildService('LEG2_FAILS');
    await expect(service.createComposite('user1', input)).rejects.toMatchObject({ code: 'INVENTORY_CHANGED' });
    expect(transitions).not.toContain('PARTIAL_ORDER');
    expect(transitions[transitions.length - 1]).toBe('MANUAL_REVIEW');
  });

  it('第二段成功、第一段失败：已有真实订单 -> PARTIAL_ORDER 且携带 orderedLegs', async () => {
    const { service, transitions } = buildService('LEG1_FAILS');
    let caught: any = null;
    try {
      await service.createComposite('user1', input);
    } catch (e) {
      caught = e;
    }
    expect(caught?.code).toBe('PARTIAL_BOOKING');
    expect(caught?.details?.orderedLegs).toEqual([2]);
    expect(caught?.details?.failedLeg).toBe(1);
    expect(transitions).toContain('LEG_B_ORDERED');
    expect(transitions[transitions.length - 1]).toBe('PARTIAL_ORDER');
    expect(transitions).not.toContain('BOTH_ORDERED');
  });

  it('预订期资格复核未通过：不下任何订单 -> EXPIRED', async () => {
    const { service, transitions, assessV2 } = buildService('ELIGIBILITY_FAIL');
    await expect(service.createComposite('user1', input)).rejects.toMatchObject({ code: 'BOOKING_ELIGIBILITY_FAILED' });
    expect(assessV2.assess).toHaveBeenCalledWith(expect.objectContaining({ mode: 'BOOKING' }), expect.anything());
    expect(transitions[transitions.length - 1]).toBe('EXPIRED');
    expect(transitions).not.toContain('LEG_B_ORDERING');
  });
});
