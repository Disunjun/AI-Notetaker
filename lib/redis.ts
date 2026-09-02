import IORedis, { type Redis } from 'ioredis';
import { env } from '@/lib/env';

/**
 * Shared Redis connection factory for BullMQ and the rate limiter.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ for blocking commands.
 */
export function createRedisConnection(options: { maxRetriesPerRequest?: number | null } = {}): Redis {
  return new IORedis(env().REDIS_URL, {
    maxRetriesPerRequest: options.maxRetriesPerRequest === undefined ? null : options.maxRetriesPerRequest,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

let shared: Redis | undefined;

/** One connection reused for queue operations inside a single process. */
export function redis(): Redis {
  if (!shared) shared = createRedisConnection();
  return shared;
}

export async function disconnectRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => shared?.disconnect());
    shared = undefined;
  }
}
