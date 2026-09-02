import { ok, route } from '@/lib/http/respond';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { env } from '@/lib/env';
import { JobStatus, QUEUE_NAME, WATCHDOG_STALE_AFTER_MS } from '@/lib/domain';
import { queueHealthCounts } from '@/lib/queue/producer';
import type { QueueHealthDto } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireAdmin(req);

  const cutoff = new Date(Date.now() - WATCHDOG_STALE_AFTER_MS);
  const [counts, connected, staleProcessingJobs, stuckQueuedJobs] = await Promise.all([
    queueHealthCounts().catch(() => null),
    redis()
      .ping()
      .then((pong) => pong === 'PONG')
      .catch(() => false),
    prisma.job.count({
      where: {
        status: JobStatus.PROCESSING,
        OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null, startedAt: { lt: cutoff } }],
      },
    }),
    prisma.job.count({ where: { status: JobStatus.QUEUED, queuedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } } }),
  ]);

  const dto: QueueHealthDto = {
    queueName: QUEUE_NAME,
    connected,
    waiting: counts?.waiting ?? 0,
    active: counts?.active ?? 0,
    delayed: counts?.delayed ?? 0,
    failed: counts?.failed ?? 0,
    completed: counts?.completed ?? 0,
    workerConcurrency: env().WORKER_CONCURRENCY,
    staleProcessingJobs,
    stuckQueuedJobs,
  };

  return ok(dto, { status: connected ? 200 : 503 });
});
