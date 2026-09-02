import { ok, route } from '@/lib/http/respond';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';
import { toAdminJobDto, type AdminJobRow } from '@/lib/admin/dto';

export const dynamic = 'force-dynamic';

export const GET = route<{ id: string }>(async (req, { params }) => {
  await requireAdmin(req);

  const job = (await prisma.job.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { email: true } },
      note: { select: { title: true } },
      usageLog: { select: { estimatedCost: true, totalTokens: true, audioSeconds: true } },
    },
  })) as unknown as (AdminJobRow & {
    usageLog: { estimatedCost: unknown; totalTokens: number | null; audioSeconds: number | null } | null;
  }) | null;

  if (!job) throw new AppError(ErrorCode.JOB_NOT_FOUND, 'Job not found');

  return ok({
    ...toAdminJobDto(job),
    usage: job.usageLog
      ? {
          estimatedCost: String(job.usageLog.estimatedCost),
          totalTokens: job.usageLog.totalTokens,
          audioSeconds: job.usageLog.audioSeconds,
        }
      : null,
  });
});
