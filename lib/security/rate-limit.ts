import type { Redis } from 'ioredis';
import { AppError, ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

/**
 * Fixed-window rate limiter backed by Redis.
 *
 * Uses INCR + EXPIRE(NX) so a key always expires, and degrades open (allowing
 * the request) if Redis is unreachable — availability of authentication must not
 * be held hostage by the limiter, and the failure is logged loudly.
 */
export async function rateLimit(
  redis: Redis,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const safeIdentifier = identifier.slice(0, 128);
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const key = `rl:${scope}:${safeIdentifier}:${windowStart}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    const ttl = await redis.ttl(key);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      limit,
      resetSeconds: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (error) {
    logger.warn('rate_limit_degraded_open', { scope, error: error instanceof Error ? error.message : String(error) });
    return { allowed: true, remaining: limit, limit, resetSeconds: windowSeconds };
  }
}

/** Throw RATE_LIMITED (429) when the limit is exceeded. */
export async function enforceRateLimit(
  redis: Redis,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = await rateLimit(redis, scope, identifier, limit, windowSeconds);
  if (!result.allowed) {
    throw new AppError(ErrorCode.RATE_LIMITED, 'Too many requests. Please try again later.', {
      status: 429,
    });
  }
  return result;
}

export function clientIdentifier(req: Request, fallbackEmail?: string): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  return fallbackEmail ? `${ip}|${fallbackEmail.toLowerCase()}` : ip;
}
