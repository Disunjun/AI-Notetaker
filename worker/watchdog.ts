import { prisma } from '@/lib/db';
import { JobStage, JobStatus, QUEUE_NAME, WATCHDOG_MAX_REQUEUES, WATCHDOG_STALE_AFTER_MS } from '@/lib/domain';
import { logger } from '@/lib/logger';
import { enqueueProcessingJob, processingQueue } from '@/lib/queue/producer';

/**
 * Watchdog.
 *
 * Finds PROCESSING jobs whose heartbeat is more than 30 minutes stale and puts
 * them back on the queue. Recovery is capped at 3 attempts per job so an
 * unrecoverable job can never loop forever.
 */

export interface WatchdogRunResult {
  scanned: number;
  requeued: string[];
  abandoned: string[];
}

export async function runWatchdogOnce(staleAfterMs = WATCHDOG_STALE_AFTER_MS): Promise<WatchdogRunResult> {
  const log = logger.child({ component: 'watchdog' });
  const cutoff = new Date(Date.now() - staleAfterMs);

  const stale = (await prisma.job.findMany({
    where: {
      status: JobStatus.PROCESSING,
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, startedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, noteId: true, userId: true, watchdogRequeues: true },
    take: 100,
  })) as unknown as Array<{ id: string; noteId: string; userId: string; watchdogRequeues: number }>;

  const requeued: string[] = [];
  const abandoned: string[] = [];

  for (const job of stale) {
    if (job.watchdogRequeues >= WATCHDOG_MAX_REQUEUES) {
      // Hard stop: mark FAILED instead of recovering a fourth time.
      await prisma.job.updateMany({
        where: { id: job.id, status: JobStatus.PROCESSING },
        data: {
          status: JobStatus.FAILED,
          errorCode: 'WATCHDOG_MAX_REQUEUES',
          errorMessage: 'Job exceeded the maximum number of watchdog recoveries',
          failedAt: new Date(),
        },
      });
      abandoned.push(job.id);
      log.error('watchdog_abandoned', { jobId: job.id, requeues: job.watchdogRequeues });
      continue;
    }

    // Atomic: only reclaim a job that is still PROCESSING.
    const reclaimed = await prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.PROCESSING },
      data: {
        status: JobStatus.QUEUED,
        stage: JobStage.QUEUED,
        progress: 0,
        watchdogRequeues: { increment: 1 },
        lastHeartbeatAt: new Date(),
        startedAt: null,
      },
    });
    if (reclaimed.count === 0) continue;

    // The previous BullMQ attempt is gone or failed; replace it with a fresh job
    // that keeps the same id (the DB job id).
    const existing = await processingQueue().getJob(job.id);
    if (existing) await existing.remove().catch(() => undefined);
    await enqueueProcessingJob({ jobId: job.id, noteId: job.noteId, userId: job.userId });

    requeued.push(job.id);
    log.warn('watchdog_requeue', { jobId: job.id, requeues: job.watchdogRequeues + 1 });
  }

  return { scanned: stale.length, requeued, abandoned };
}

export const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

export function startWatchdog(intervalMs = WATCHDOG_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    runWatchdogOnce().catch((error: unknown) => {
      logger.error('watchdog_error', { error: error instanceof Error ? error.message : String(error) });
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export { QUEUE_NAME };
