import { Queue } from 'bullmq';
import { createRedisConnection } from '@/lib/redis';
import { QUEUE_NAME, type ProcessingJobPayload } from '@/lib/domain';
import { JOB_MAX_ATTEMPTS } from '@/lib/domain';
import { logger } from '@/lib/logger';

/**
 * BullMQ producer.
 *
 * The BullMQ job id is the DB Job.id, which makes enqueue idempotent: adding the
 * same jobId twice is a no-op rather than a duplicate job.
 */

let queue: Queue<ProcessingJobPayload> | undefined;

export function processingQueue(): Queue<ProcessingJobPayload> {
  if (!queue) {
    queue = new Queue<ProcessingJobPayload>(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: JOB_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: { age: 7 * 86_400 },
      },
    });
  }
  return queue;
}

export interface EnqueueResult {
  enqueued: boolean;
  jobId: string;
}

/**
 * Enqueue a job. `jobId` is always the DB Job.id.
 *
 * Duplicate enqueues for the same jobId resolve to `enqueued: false` instead of
 * creating a second unit of work.
 */
export async function enqueueProcessingJob(payload: ProcessingJobPayload): Promise<EnqueueResult> {
  const existing = await processingQueue().getJob(payload.jobId);
  if (existing) {
    logger.warn('queue_enqueue_duplicate_ignored', { jobId: payload.jobId });
    return { enqueued: false, jobId: payload.jobId };
  }

  await processingQueue().add('process', payload, { jobId: payload.jobId });
  logger.info('queue_enqueued', { jobId: payload.jobId, noteId: payload.noteId, userId: payload.userId });
  return { enqueued: true, jobId: payload.jobId };
}

/** 0-based position of a queued job, or null when it is not waiting. */
export async function queuePosition(jobId: string): Promise<{ position: number | null; totalWaiting: number }> {
  const q = processingQueue();
  const waiting = await q.getWaitingCount();
  const jobs = await q.getWaiting(0, Math.max(0, waiting - 1));
  const index = jobs.findIndex((job) => job.id === jobId);
  return { position: index === -1 ? null : index + 1, totalWaiting: waiting };
}

export async function queueHealthCounts(): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}> {
  const q = processingQueue();
  const [waiting, active, delayed, failed, completed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getDelayedCount(),
    q.getFailedCount(),
    q.getCompletedCount(),
  ]);
  return { waiting, active, delayed, failed, completed };
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close().catch(() => undefined);
    queue = undefined;
  }
}
