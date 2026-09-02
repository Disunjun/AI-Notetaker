import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { JobStatus } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const [noteCount, processingCount] = await Promise.all([
    prisma.note.count({ where: { userId: user.id } }),
    prisma.job.count({ where: { userId: user.id, status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] } } }),
  ]);
  return ok({ id: user.id, email: user.email, noteCount, processingCount });
});
