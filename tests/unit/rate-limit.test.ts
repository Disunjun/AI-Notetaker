import { beforeEach, describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';

type MockRedis = InstanceType<typeof RedisMock>;
import { enforceRateLimit, rateLimit } from '@/lib/security/rate-limit';
import { ErrorCode } from '@/lib/errors';

/**
 * The limiter is exercised against an in-memory Redis. BullMQ-level behaviour
 * needs a real Redis and is covered by the integration suite.
 */
describe('rate limiting', () => {
  let redis: MockRedis;

  beforeEach(() => {
    redis = new RedisMock();
  });

  it('allows requests up to the limit and reports the remaining budget', async () => {
    const first = await rateLimit(redis, 'auth:link', 'user-1', 3, 60);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await rateLimit(redis, 'auth:link', 'user-1', 3, 60);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('denies the request once the limit is exceeded', async () => {
    for (let i = 0; i < 3; i += 1) await rateLimit(redis, 'auth:otp', 'user-1', 3, 60);
    const denied = await rateLimit(redis, 'auth:otp', 'user-1', 3, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('scopes counters per identifier', async () => {
    for (let i = 0; i < 3; i += 1) await rateLimit(redis, 'auth:link', 'user-1', 3, 60);
    const other = await rateLimit(redis, 'auth:link', 'user-2', 3, 60);
    expect(other.allowed).toBe(true);
  });

  it('scopes counters per scope', async () => {
    for (let i = 0; i < 3; i += 1) await rateLimit(redis, 'auth:link', 'user-1', 3, 60);
    const otherScope = await rateLimit(redis, 'auth:verify', 'user-1', 3, 60);
    expect(otherScope.allowed).toBe(true);
  });

  it('throws a 429 RATE_LIMITED AppError when enforced', async () => {
    for (let i = 0; i < 2; i += 1) await enforceRateLimit(redis, 'admin:login', 'admin-1', 2, 60);
    await expect(enforceRateLimit(redis, 'admin:login', 'admin-1', 2, 60)).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMITED,
      status: 429,
    });
  });

  it('sets an expiry on the counter key so limits reset', async () => {
    await rateLimit(redis, 'notes:upload', 'user-1', 5, 120);
    const keys = await redis.keys('rl:notes:upload:user-1:*');
    expect(keys.length).toBe(1);
    const ttl = await redis.ttl(keys[0]!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('degrades open when Redis is unavailable rather than blocking sign-in', async () => {
    const broken = new RedisMock();
    // Force the counter operation to fail.
    broken.incr = (() => Promise.reject(new Error('connection refused'))) as unknown as typeof broken.incr;
    const result = await rateLimit(broken, 'auth:link', 'user-1', 3, 60);
    expect(result.allowed).toBe(true);
  });
});
