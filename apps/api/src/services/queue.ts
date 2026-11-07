import { Redis } from 'ioredis';
import type { AppConfig } from '../config.js';
import type { Logger } from '../lib/logger.js';

export interface IndexQueue {
  readonly kind: 'redis' | 'memory';
  health(): Promise<boolean>;
  enqueue(runId: string): Promise<void>;
  pop(timeoutMs?: number): Promise<string | null>;
  close(): Promise<void>;
}

export class RedisIndexQueue implements IndexQueue {
  readonly kind = 'redis';
  private redis: Redis;

  constructor(private readonly config: AppConfig) {
    this.redis = new Redis(config.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 2 ? null : Math.min(times * 100, 500))
    });
  }

  async health(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  async enqueue(runId: string): Promise<void> {
    await this.redis.connect();
    await this.redis.lpush(this.key, runId);
  }

  async pop(timeoutMs = 1000): Promise<string | null> {
    await this.redis.connect();
    const result = await this.redis.brpop(this.key, Math.max(1, Math.floor(timeoutMs / 1000)));
    return result?.[1] ?? null;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private get key(): string {
    return `${this.config.REDIS_PREFIX}:indexing`;
  }
}

export class MemoryIndexQueue implements IndexQueue {
  readonly kind = 'memory';
  private items: string[] = [];

  async health(): Promise<boolean> {
    return true;
  }

  async enqueue(runId: string): Promise<void> {
    this.items.push(runId);
  }

  async pop(): Promise<string | null> {
    return this.items.shift() ?? null;
  }

  async close(): Promise<void> {
    this.items = [];
  }
}

export async function createIndexQueue(config: AppConfig, logger: Logger): Promise<IndexQueue> {
  if (config.REDIS_URL) {
    const queue = new RedisIndexQueue(config);
    if (await queue.health()) return queue;
    logger.warn('queue', 'Redis is configured but unavailable; falling back to in-memory queue');
    await queue.close().catch(() => undefined);
  }

  return new MemoryIndexQueue();
}
