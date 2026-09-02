import { Worker, type Job } from 'bullmq';
import { createRedisConnection } from '@/lib/redis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { QUEUE_NAME, type ProcessingJobPayload } from '@/lib/domain';
import { processJob } from '@/worker/pipeline';
import { startWatchdog } from '@/worker/watchdog';

/**
 * Worker entry point.
 *
 * This process runs the BullMQ consumer, the pipeline, the heartbeat and the
 * watchdog. It deliberately exposes NO HTTP server.
 */

async function main(): Promise<void> {
  const configuration = env();
  const log = logger.child({ component: 'worker', queue: QUEUE_NAME });

  const worker = new Worker<ProcessingJobPayload>(
    QUEUE_NAME,
    async (job: Job<ProcessingJobPayload>) => {
      const outcome = await processJob(job.data);
      if (outcome.status === 'FAILED') {
        // Surface the failure to BullMQ without triggering another retry: the
        // pipeline has already decided this failure is terminal.
        throw Object.assign(new Error('Job processing failed'), { __terminal: true });
      }
      return outcome.status;
    },
    {
      connection: createRedisConnection(),
      concurrency: configuration.WORKER_CONCURRENCY,
      lockDuration: 5 * 60 * 1000,
      lockRenewTime: 2 * 60 * 1000,
    },
  );

  worker.on('ready', () => log.info('worker_ready', { concurrency: configuration.WORKER_CONCURRENCY }));
  worker.on('completed', (job: Job<ProcessingJobPayload>) => log.info('bullmq_job_completed', { jobId: job.id }));
  worker.on('failed', (job: Job<ProcessingJobPayload> | undefined, error: Error) => {
    const terminal = (error as Error & { __terminal?: boolean }).__terminal === true;
    log.warn('bullmq_job_failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      terminal,
      error: error.message,
    });
  });
  worker.on('stalled', (jobId: string) => log.warn('bullmq_job_stalled', { jobId }));
  worker.on('error', (error: Error) => log.error('worker_error', { error: error.message }));

  const stopWatchdog = startWatchdog();

  const shutdown = async (signal: string): Promise<void> => {
    log.info('worker_shutting_down', { signal });
    stopWatchdog();
    await worker.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info('worker_started', { queue: QUEUE_NAME, concurrency: configuration.WORKER_CONCURRENCY });
}

main().catch((error: unknown) => {
  logger.error('worker_startup_failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
