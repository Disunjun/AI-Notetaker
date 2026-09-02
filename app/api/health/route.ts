import { ok, route } from '@/lib/http/respond';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness endpoint. Public and unauthenticated, but reveals nothing
 * beyond component health.
 */
export const GET = route(async () => {
  const database = await prisma
    .$queryRaw`SELECT 1`
    .then(() => 'ok' as const)
    .catch(() => 'error' as const);

  const redisClient = redis();
  let queue: 'ok' | 'error' = 'error';
  try {
    const pong = await redisClient.ping();
    queue = pong === 'PONG' ? 'ok' : 'error';
  } catch {
    queue = 'error';
  }

  const healthy = database === 'ok' && queue === 'ok';
  return ok(
    { status: healthy ? 'ok' : 'degraded', database, queue, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
});
