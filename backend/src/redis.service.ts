import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from './config/env';

/**
 * Redis 服务：搜索缓存、限流与任务协调。
 * Redis 不可用时降级为内存缓存，保证搜索和核心流程仍然可用。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis | null = null;
  private readonly memory = new Map<string, { v: string; exp: number }>();
  private connected = false;

  constructor() {
    const env = loadEnv();
    try {
      this.client = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 3000,
      });
      this.client
        .connect()
        .then(() => (this.connected = true))
        .catch(() => (this.connected = false));
      this.client.on('error', () => (this.connected = false));
    } catch {
      this.client = null;
    }
  }

  isReady(): boolean {
    return this.connected;
  }

  async get(key: string): Promise<string | null> {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        /* fall through */
      }
    }
    const item = this.memory.get(key);
    if (!item) return null;
    if (item.exp < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return item.v;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.connected && this.client) {
      try {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      } catch {
        /* fall through */
      }
    }
    this.memory.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }

  /** 简单滑动窗口限流：返回是否放行。 */
  async rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
    if (this.connected && this.client) {
      try {
        const n = await this.client.incr(key);
        if (n === 1) await this.client.expire(key, windowSeconds);
        return n <= max;
      } catch {
        /* fall through */
      }
    }
    const item = this.memory.get(key);
    const now = Date.now();
    if (!item || item.exp < now) {
      this.memory.set(key, { v: '1', exp: now + windowSeconds * 1000 });
      return true;
    }
    const n = Number(item.v) + 1;
    this.memory.set(key, { v: String(n), exp: item.exp });
    return n <= max;
  }

  async onModuleDestroy() {
    try {
      await this.client?.quit();
    } catch {
      /* ignore */
    }
  }
}
