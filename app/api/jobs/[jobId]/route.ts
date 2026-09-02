import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { getOwnedJob, toJobDto } from '@/lib/auth/ownership';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/:jobId — polled by the UI every 4 seconds until the job reaches
 * COMPLETED or FAILED.
 */
export const GET = route<{ jobId: string }>(async (req, { params }) => {
  const user = await requireUser(req);
  const job = await getOwnedJob(user.id, params.jobId);
  return ok(toJobDto(job));
});
