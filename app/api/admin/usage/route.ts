import { ok, route } from '@/lib/http/respond';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { buildPage, parsePagination, skipFor } from '@/lib/pagination';
import type { UsageRowDto, UsageSummaryDto } from '@/types';

export const dynamic = 'force-dynamic';

interface UsageRow {
  id: string;
  jobId: string;
  provider: string;
  model: string;
  audioSeconds: number | null;
  totalTokens: number | null;
  estimatedCost: unknown;
  currency: string;
  createdAt: Date;
  user: { email: string };
}

export const GET = route(async (req) => {
  await requireAdmin(req);
  const params = new URL(req.url).searchParams;
  const pagination = parsePagination(params);

  const [rows, total, totals] = await Promise.all([
    prisma.usageLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: skipFor(pagination),
      take: pagination.pageSize,
      include: { user: { select: { email: true } } },
    }) as unknown as Promise<UsageRow[]>,
    prisma.usageLog.count(),
    prisma.usageLog.aggregate({
      _sum: { estimatedCost: true, totalTokens: true, audioSeconds: true },
    }) as unknown as Promise<{ _sum: { estimatedCost: unknown; totalTokens: number | null; audioSeconds: number | null } }>,
  ]);

  const items: UsageRowDto[] = rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    userEmail: row.user.email,
    provider: row.provider,
    model: row.model,
    audioSeconds: row.audioSeconds,
    totalTokens: row.totalTokens,
    estimatedCost: String(row.estimatedCost),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  }));

  const summary: UsageSummaryDto = {
    totalJobs: total,
    totalAudioSeconds: totals._sum.audioSeconds ?? 0,
    totalTokens: totals._sum.totalTokens ?? 0,
    totalEstimatedCost: String(totals._sum.estimatedCost ?? '0'),
    currency: 'USD',
  };

  return ok({ ...buildPage(items, total, pagination), summary });
});
