import { ok, route } from '@/lib/http/respond';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { buildPage, parsePagination, skipFor } from '@/lib/pagination';
import type { EmailLogDto } from '@/types';

export const dynamic = 'force-dynamic';

interface EmailLogRow {
  id: string;
  type: string;
  status: string;
  to: string;
  subject: string | null;
  jobId: string | null;
  messageId: string | null;
  error: string | null;
  createdAt: Date;
}

export const GET = route(async (req) => {
  await requireAdmin(req);
  const params = new URL(req.url).searchParams;
  const pagination = parsePagination(params);
  const type = params.get('type');

  const where = type ? { type } : {};
  const [rows, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skipFor(pagination),
      take: pagination.pageSize,
    }) as unknown as Promise<EmailLogRow[]>,
    prisma.emailLog.count({ where }),
  ]);

  const items: EmailLogDto[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    to: row.to,
    subject: row.subject,
    jobId: row.jobId,
    messageId: row.messageId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  }));

  return ok(buildPage(items, total, pagination));
});
