import { prisma } from '@/lib/db';
import type { Logger } from '@/lib/logger';

/**
 * Heartbeat.
 *
 * The worker refreshes `lastHeartbeatAt` every 30 seconds (the contract allows
 * 30–60). The watchdog treats a PROCESSING job whose heartbeat is older than 30
 * minutes as abandoned.
 */

export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface Heartbeat {
  stop(): Promise<void>;
  beat(): Promise<void>;
}

export async function startHeartbeat(jobId: string, log: Logger, intervalMs = HEARTBEAT_INTERVAL_MS): Promise<Heartbeat> {
  let running = true;

  const beat = async (): Promise<void> => {
    if (!running) return;
    try {
      await prisma.job.updateMany({ where: { id: jobId }, data: { lastHeartbeatAt: new Date() } });
    } catch (error) {
      log.warn('heartbeat_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const timer = setInterval(() => void beat(), intervalMs);
  // Do not keep the event loop alive just for the heartbeat.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    async stop() {
      running = false;
      clearInterval(timer);
    },
    beat,
  };
}
