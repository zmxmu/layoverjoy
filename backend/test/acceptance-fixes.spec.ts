import { afterEach, describe, expect, it, vi } from 'vitest';
import { SandboxAtlasProvider } from '../src/atlas/sandbox.provider';
import { validatePlanSnapshotConsistency } from '../src/search/search.orchestrator';
import { SearchService } from '../src/search/search.service';
import { UsersService } from '../src/users/users.service';

/**
 * 2026-08-30 验收阻塞项回归测试：
 * - P0-1 直飞基准严格 OD（多段联程不截断）
 * - P0-2 plan snapshot 一致性 + 跨用户隔离
 * - P1-4 签证原子持久化
 */

function stubSearchResponse(routings: any[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 0, msg: null, routings }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('P0-1 · 直飞基准严格 OD（多段联程不截断）', () => {
  it('多段联程路由：destination 取末段到达、arrivalAt 取末段到达时刻', async () => {
    stubSearchResponse([
      {
        routingIdentifier: 'RID_MULTI',
        currency: 'SGD',
        adultPrice: 100,
        adultTax: 10,
        transactionFee: 0,
        expireTime: '2030-01-01T00:00:00Z',
        fromSegments: [
          { depAirport: 'SIN', arrAirport: 'PUS', depTime: '202609040800', arrTime: '202609041200', carrier: 'MM', flightNumber: 'MM1' },
          { depAirport: 'PUS', arrAirport: 'PVG', depTime: '202609041400', arrTime: '202609041600', carrier: 'MM', flightNumber: 'MM2' },
        ],
      },
    ]);
    const provider = new SandboxAtlasProvider('https://sandbox.example.invalid', 'ak', 'sk');
    const offers = await provider.search({ origin: 'SIN', destination: 'PVG', departDate: '2026-09-04' });
    expect(offers).toHaveLength(1);
    expect(offers[0].origin).toBe('SIN');
    expect(offers[0].destination).toBe('PVG'); // 末段到达，而非首段 PUS
    expect(offers[0].arrivalAt).toBe('2026-09-04T16:00:00');
    expect(offers[0].segments).toHaveLength(2);
  });

  it('多机场城市以集合匹配：destinationAirports 含 PVG 时接受终到 PVG 的联程', async () => {
    stubSearchResponse([
      {
        routingIdentifier: 'RID_MULTI',
        currency: 'SGD',
        adultPrice: 100,
        adultTax: 10,
        transactionFee: 0,
        expireTime: '2030-01-01T00:00:00Z',
        fromSegments: [
          { depAirport: 'SIN', arrAirport: 'PUS', depTime: '202609040800', arrTime: '202609041200', carrier: 'MM', flightNumber: 'MM1' },
          { depAirport: 'PUS', arrAirport: 'PVG', depTime: '202609041400', arrTime: '202609041600', carrier: 'MM', flightNumber: 'MM2' },
        ],
      },
    ]);
    const provider = new SandboxAtlasProvider('https://sandbox.example.invalid', 'ak', 'sk');
    const offers = await provider.search({
      origin: 'SIN',
      destination: 'SHA',
      departDate: '2026-09-04',
      originAirports: ['SIN'],
      destinationAirports: ['SHA', 'PVG'],
    });
    expect(offers).toHaveLength(1);
    expect(offers[0].destination).toBe('PVG');
  });

  it('未传集合时按单机场严格匹配：终到 PVG 的联程对 SHA 请求不可见', async () => {
    stubSearchResponse([
      {
        routingIdentifier: 'RID_WRONG',
        currency: 'SGD',
        adultPrice: 100,
        adultTax: 10,
        transactionFee: 0,
        fromSegments: [
          { depAirport: 'SIN', arrAirport: 'SGN', depTime: '202609040800', arrTime: '202609041000' },
          { depAirport: 'SGN', arrAirport: 'PVG', depTime: '202609041200', arrTime: '202609041400' },
        ],
      },
    ]);
    const provider = new SandboxAtlasProvider('https://sandbox.example.invalid', 'ak', 'sk');
    // SGN 不属于上海机场集合 → 过滤 → NO_SANDBOX_INVENTORY
    await expect(
      provider.search({ origin: 'SIN', destination: 'SHA', departDate: '2026-09-04' }),
    ).rejects.toMatchObject({ code: 'NO_SANDBOX_INVENTORY' });
  });
});

describe('P0-2 · plan snapshot 一致性', () => {
  const run = {
    id: 'run1',
    originCode: 'SIN',
    destinationCode: 'SHA',
    preferencesJson: {
      originLocation: { cityId: 'sg-singapore', mode: 'ALL_AIRPORTS' },
      destinationLocation: { cityId: 'cn-shanghai', mode: 'ALL_AIRPORTS' },
    },
  };
  const plan = { id: 'plan1', searchRunId: 'run1', hubAirport: 'BKK' };
  const goodLegs = [
    { legNo: 1, searchRunId: 'run1', origin: 'SIN', destination: 'BKK' },
    { legNo: 2, searchRunId: 'run1', origin: 'BKK', destination: 'PVG' },
  ];

  it('一致快照通过校验', () => {
    expect(() => validatePlanSnapshotConsistency(run, plan, goodLegs)).not.toThrow();
  });

  it('leg2 目的地不属于本次搜索（如 PUS）→ PLAN_SNAPSHOT_MISMATCH', () => {
    const bad = [goodLegs[0], { legNo: 2, searchRunId: 'run1', origin: 'BKK', destination: 'PUS' }];
    expect(() => validatePlanSnapshotConsistency(run, plan, bad)).toThrowError(/PLAN_SNAPSHOT_MISMATCH/);
  });

  it('leg1 出发地不属于本次搜索 → PLAN_SNAPSHOT_MISMATCH', () => {
    const bad = [{ legNo: 1, searchRunId: 'run1', origin: 'HKG', destination: 'BKK' }, goodLegs[1]];
    expect(() => validatePlanSnapshotConsistency(run, plan, bad)).toThrowError(/PLAN_SNAPSHOT_MISMATCH/);
  });

  it('跨 search-run 的快照 → PLAN_SNAPSHOT_MISMATCH', () => {
    const bad = [{ legNo: 1, searchRunId: 'OTHER', origin: 'SIN', destination: 'BKK' }, goodLegs[1]];
    expect(() => validatePlanSnapshotConsistency(run, plan, bad)).toThrowError(/PLAN_SNAPSHOT_MISMATCH/);
  });
});

describe('P0-2 · 跨用户缓存/查询隔离', () => {
  it('getPlans 对非所有者返回 notFound', async () => {
    const prisma: any = {
      searchRun: {
        findFirst: vi.fn(async () => null), // userId 不匹配 → null
      },
    };
    const svc = new SearchService(prisma, {} as any, {} as any);
    await expect(svc.getPlans('attacker', 'run1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getStatus 对非所有者返回 notFound', async () => {
    const prisma: any = { searchRun: { findFirst: vi.fn(async () => null) } };
    const svc = new SearchService(prisma, {} as any, {} as any);
    await expect(svc.getStatus('attacker', 'run1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('P1-4 · onboarding 签证原子持久化', () => {
  function makeTx() {
    const created: any[] = [];
    const tx: any = {
      travelDocument: {
        findFirst: vi.fn(async ({ where }: any) =>
          created.find((c) => c.kind === where.kind && (where.countryCode === undefined || c.countryCode === where.countryCode)) ?? null,
        ),
        create: vi.fn(async ({ data }: any) => {
          created.push(data);
          return { id: `doc${created.length}`, ...data };
        }),
      },
    };
    return { tx, created };
  }

  it('护照 + 选中签证在同一事务内写入', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new UsersService(prisma);
    const r = await svc.completeOnboarding('u1', { passport: { countryCode: 'CN', expiresOn: '2032-01-01' }, visas: ['JP', 'KR'] });
    expect(r.passportCreated).toBe(true);
    expect(r.visasCreated).toBe(2);
    expect(created.map((c) => c.kind)).toEqual(['PASSPORT', 'VISA', 'VISA']);
  });

  it('签证为空允许跳过（只写护照）', async () => {
    const { tx, created } = makeTx();
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new UsersService(prisma);
    const r = await svc.completeOnboarding('u1', { passport: { countryCode: 'CN' }, visas: [] });
    expect(r.visasCreated).toBe(0);
    expect(created).toHaveLength(1);
  });

  it('幂等：已存在护照/签证不重复创建', async () => {
    const { tx } = makeTx();
    tx.travelDocument.findFirst = vi.fn(async ({ where }: any) => ({ id: 'existing', kind: where.kind, countryCode: where.countryCode ?? 'CN' }));
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new UsersService(prisma);
    const r = await svc.completeOnboarding('u1', { passport: { countryCode: 'CN' }, visas: ['JP'] });
    expect(r.passportCreated).toBe(false);
    expect(r.visasCreated).toBe(0);
  });
});
