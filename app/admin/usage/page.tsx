import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { prisma } from '@/lib/db';
import { MAX_PAGE_SIZE } from '@/lib/pagination';

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

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(1, Math.min(Number(params.page ?? '1') || 1, 10_000));

  const [rows, total, sums] = await Promise.all([
    prisma.usageLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * MAX_PAGE_SIZE,
      take: MAX_PAGE_SIZE,
      include: { user: { select: { email: true } } },
    }) as unknown as Promise<UsageRow[]>,
    prisma.usageLog.count(),
    prisma.usageLog.aggregate({ _sum: { estimatedCost: true, totalTokens: true, audioSeconds: true } }) as unknown as Promise<{
      _sum: { estimatedCost: unknown; totalTokens: number | null; audioSeconds: number | null };
    }>,
  ]);

  const cards = [
    { label: 'Successful jobs billed', value: String(total) },
    { label: 'Total tokens', value: String(sums._sum.totalTokens ?? 0) },
    { label: 'Total audio seconds', value: String(sums._sum.audioSeconds ?? 0) },
    { label: 'Estimated cost (USD)', value: `$${String(sums._sum.estimatedCost ?? '0')}` },
  ];

  return (
    <AdminShell email={admin.email}>
      <h1 className="mb-2 text-2xl font-semibold text-ink-900">Usage</h1>
      <p className="mb-6 text-sm text-ink-500">
        Only successful jobs create a usage record, and jobId is unique so retries and watchdog recoveries can never
        double-count. V1 costs are estimates.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <p className="text-sm text-ink-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Job</th>
              <th className="th">User</th>
              <th className="th">Provider</th>
              <th className="th">Model</th>
              <th className="th">Tokens</th>
              <th className="th">Audio (s)</th>
              <th className="th">Est. cost</th>
              <th className="th">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="td text-ink-500" colSpan={8}>No usage recorded yet.</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="td font-mono text-xs">{row.jobId.slice(0, 8)}</td>
                <td className="td">{row.user.email}</td>
                <td className="td">{row.provider}</td>
                <td className="td">{row.model}</td>
                <td className="td">{row.totalTokens ?? '—'}</td>
                <td className="td">{row.audioSeconds ?? '—'}</td>
                <td className="td">{row.currency} {String(row.estimatedCost)}</td>
                <td className="td text-xs text-ink-500">{new Date(row.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink-500">{total} records · page {page}</p>
    </AdminShell>
  );
}
