import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { getOwnedJob } from '@/lib/auth/ownership';
import { queuePosition } from '@/lib/queue/producer';
import { env } from '@/lib/env';
import type { QueuePositionDto } from '@/types';

export const dynamic = 'force-dynamic';

/** Rough throughput assumption used only to estimate a wait time. */
const ASSUMED_SECONDS_PER_JOB = 90;

export const GET = route<{ jobId: string }>(async (req, { params }) => {
  const user = await requireUser(req);
  const job = await getOwnedJob(user.id, params.jobId);

  const { position, totalWaiting } = await queuePosition(job.id);
  const dto: QueuePositionDto = {
    jobId: job.id,
    position,
    totalWaiting,
    estimatedWaitSeconds:
      position === null ? null : Math.max(0, (position - 1) * Math.ceil(ASSUMED_SECONDS_PER_JOB / env().WORKER_CONCURRENCY)),
  };
  return ok(dto);
});
