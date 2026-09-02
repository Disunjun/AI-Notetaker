import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { prisma } from '@/lib/db';
import { MAX_PAGE_SIZE } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

interface EmailLogRow {
  id: string;
  type: string;
  status: string;
  to: string;
  subject: string | null;
  jobId: string | null;
  error: string | null;
  createdAt: Date;
}

function statusBadge(status: string): string {
  if (status === 'SENT') return 'bg-emerald-100 text-emerald-800';
  if (status === 'FAILED') return 'bg-red-100 text-red-800';
  return 'bg-ink-100 text-ink-700';
}

export default async function AdminEmailLogsPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string }> }) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(1, Math.min(Number(params.page ?? '1') || 1, 10_000));
  const where = params.type ? { type: params.type } : {};

  const [rows, total] = await Promise.all([
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * MAX_PAGE_SIZE,
      take: MAX_PAGE_SIZE,
    }) as unknown as Promise<EmailLogRow[]>,
    prisma.emailLog.count({ where }),
  ]);

  return (
    <AdminShell email={admin.email}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-900">Email logs</h1>
        <div className="flex gap-2 text-sm">
          {['', 'MAGIC_LINK', 'OTP', 'RESULT', 'FAILURE', 'TEST'].map((value) => (
            <a
              key={value || 'all'}
              href={value ? `/admin/email-logs?type=${value}` : '/admin/email-logs'}
              className={(params.type ?? '') === value ? 'btn-primary' : 'btn-secondary'}
            >
              {value || 'All'}
            </a>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="th">Type</th>
              <th className="th">Status</th>
              <th className="th">To</th>
              <th className="th">Subject</th>
              <th className="th">Job</th>
              <th className="th">Error</th>
              <th className="th">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="td text-ink-500" colSpan={7}>No emails recorded.</td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="td">{row.type}</td>
                <td className="td"><span className={`badge ${statusBadge(row.status)}`}>{row.status}</span></td>
                <td className="td">{row.to}</td>
                <td className="td">{row.subject ?? '—'}</td>
                <td className="td font-mono text-xs">{row.jobId ? row.jobId.slice(0, 8) : '—'}</td>
                <td className="td text-xs text-red-700">{row.error ?? '—'}</td>
                <td className="td text-xs text-ink-500">{new Date(row.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink-500">{total} entries · page {page}</p>
    </AdminShell>
  );
}
