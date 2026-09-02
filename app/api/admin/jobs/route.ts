import { ok, route } from '@/lib/http/respond';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { buildPage, parsePagination, skipFor } from '@/lib/pagination';
import { JobStatus } from '@/lib/domain';
import { toAdminJobDto, type AdminJobRow } from '@/lib/admin/dto';
import type { AdminJobDto, Paginated } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireAdmin(req);
  const params = new URL(req.url).searchParams;
  const pagination = parsePagination(params);
  const status = params.get('status');

  const where = {
    ...(status && status in JobStatus ? { status: JobStatus[status as keyof typeof JobStatus] } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skipFor(pagination),
      take: pagination.pageSize,
      include: { user: { select: { email: true } }, note: { select: { title: true } } },
    }) as unknown as Promise<AdminJobRow[]>,
    prisma.job.count({ where }),
  ]);

  const page: Paginated<AdminJobDto> = buildPage(rows.map(toAdminJobDto), total, pagination);
  return ok(page);
});
