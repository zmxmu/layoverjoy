import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { loadEnv } from '../config/env';
import { RedisService } from '../redis.service';
import { FlightProvider, FlightSearchInput, FlightOffer } from './atlas.types';
import { MockAtlasProvider } from './mock.provider';
import { SandboxAtlasProvider } from './sandbox.provider';

const SEARCH_CACHE_TTL_SECONDS = 15 * 60;

/**
 * Atlas 网关服务：按操作选择 Provider（00 启动说明 §5 分层），
 * Search 结果缓存 15 分钟（缓存 Key 包含路线、日期、乘客数、币种与环境）。
 */
@Injectable()
export class AtlasService {
  private readonly logger = new Logger('AtlasService');
  private readonly searchProvider: FlightProvider;
  private readonly verifyProvider: FlightProvider;
  private readonly orderProvider: FlightProvider;
  private readonly paymentProvider: FlightProvider;
  private readonly refundProvider: FlightProvider;
  readonly sandboxInstance: SandboxAtlasProvider | null = null;
  readonly mockInstance: MockAtlasProvider;

  constructor(private readonly redis: RedisService) {
    const env = loadEnv();
    const mock = new MockAtlasProvider();
    this.mockInstance = mock;
    const sandboxReady = Boolean(env.ATLAS_CLIENT_ID && env.ATLAS_CLIENT_SECRET);
    if (!sandboxReady) {
      this.logger.warn('Atlas Sandbox credentials missing; falling back to MOCK providers.');
    }
    const sandbox = sandboxReady
      ? new SandboxAtlasProvider(
          env.ATLAS_BASE_URL,
          env.ATLAS_CLIENT_ID,
          env.ATLAS_CLIENT_SECRET,
          env.ATLAS_SEARCH_TIMEOUT_MS,
          env.ATLAS_CID,
        )
      : null;
    this.sandboxInstance = sandbox;

    const pick = (setting: string): FlightProvider => {
      if (setting === 'sandbox' && sandbox) return sandbox;
      return mock;
    };
    this.searchProvider = pick(env.ATLAS_SEARCH_PROVIDER);
    this.verifyProvider = pick(env.ATLAS_VERIFY_PROVIDER);
    this.orderProvider = pick(env.ATLAS_ORDER_PROVIDER);
    this.paymentProvider = pick(env.ATLAS_PAYMENT_PROVIDER);
    this.refundProvider = pick(env.ATLAS_REFUND_PROVIDER);
  }

  providerLabel(provider: FlightProvider): 'ATLAS_SANDBOX' | 'MOCK' {
    return provider.name === 'ATLAS_SANDBOX' ? 'ATLAS_SANDBOX' : 'MOCK';
  }

  searchProviderLabel(): 'ATLAS_SANDBOX' | 'MOCK' {
    return this.providerLabel(this.searchProvider);
  }

  get search() {
    return this.searchProvider;
  }
  get verify() {
    return this.verifyProvider;
  }
  get order() {
    return this.orderProvider;
  }
  get payment() {
    return this.paymentProvider;
  }
  get refund() {
    return this.refundProvider;
  }

  /** 演示 Fixture 回退专用：直接使用确定性 Mock 数据（仅在用户显式触发时调用）。 */
  async searchMock(input: FlightSearchInput): Promise<FlightOffer[]> {
    return this.mockInstance.search(input);
  }

  /** 带缓存搜索。缓存只存脱敏摘要结构。 */
  async searchWithCache(input: FlightSearchInput): Promise<{ offers: FlightOffer[]; fromCache: boolean }> {
    const key = [
      'atlas:search',
      input.origin,
      input.destination,
      input.departDate,
      input.adults ?? 1,
      input.currency ?? 'SGD',
      this.searchProvider.name,
    ].join(':');

    const cached = await this.redis.get(key);
    if (cached) {
      try {
        return { offers: JSON.parse(cached), fromCache: true };
      } catch {
        /* 缓存损坏，继续真实搜索 */
      }
    }
    const offers = await this.searchProvider.search(input);
    const redacted = offers.map(({ raw, ...rest }) => rest);
    await this.redis.set(key, JSON.stringify(redacted), SEARCH_CACHE_TTL_SECONDS);
    return { offers: redacted, fromCache: false };
  }

  /** 原始响应脱敏 Hash（审计用，不保存明文敏感 payload）。 */
  rawHash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
  }
}
