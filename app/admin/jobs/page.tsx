import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { prisma } from '@/lib/db';
import { JobStatus } from '@/lib/domain';
import { toAdminJobDto, type AdminJobRow } from '@/lib/admin/dto';
import { MAX_PAGE_SIZE } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

function badge(status: string): string {
  if (status === JobStatus.COMPLETED) return 'bg-emerald-100 text-emerald-800';
  if (status === JobStatus.FAILED) return 'bg-red-100 text-red-800';
  if (status === JobStatus.PROCESSING) return 'bg-blue-100 text-blue-800';
  return 'bg-ink-100 text-ink-700';
}

export default async function AdminJobsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  const page = Math.max(1, Math.min(Number(params.page ?? '1') || 1, 10_000));
  const status = params.status && params.status in JobStatus ? JobStatus[params.status as keyof typeof JobStatus] : undefined;

  const where = status ? { status } : {};
  const [rows, total] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * MAX_PAGE_SIZE,
      take: MAX_PAGE_SIZE,
      include: { user: { select: { email: true } }, note: { select: { title: true } } },
    }) as unknown as Promise<AdminJobRow[]>,
    prisma.job.count({ where }),
  ]);

  const jobs = rows.map(toAdminJobDto);

  return (
    <AdminShell email={admin.email}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-900">Jobs</h1>
        <div className="flex gap-2 text-sm">
          {['', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'].map((value) => (
            <a
              key={value || 'all'}
              href={value ? `/admin/jobs?status=${value}` : '/admin/jobs'}
              className={(params.status ?? '') === value ? 'btn-primary' : 'btn-secondary'}
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
              <th className="th">Job</th>
              <th className="th">User</th>
              <th className="th">Note</th>
              <th className="th">Status</th>
              <th className="th">Stage</th>
              <th className="th">Provider</th>
              <th className="th">Attempts</th>
              <th className="th">Watchdog</th>
              <th className="th">Error</th>
              <th className="th">Created</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td className="td text-ink-500" colSpan={10}>No jobs.</td>
              </tr>
            )}
            {jobs.map((job) => (
              <tr key={job.id}>
                <td className="td font-mono text-xs">{job.id.slice(0, 8)}</td>
                <td className="td">{job.userEmail}</td>
                <td className="td">{job.noteTitle}</td>
                <td className="td"><span className={`badge ${badge(job.status)}`}>{job.status}</span></td>
                <td className="td">{job.stage} · {job.progress}%</td>
                <td className="td text-xs">{job.providerUsed ?? '—'}</td>
                <td className="td">{job.attempts}</td>
                <td className="td">{job.watchdogRequeues}</td>
                <td className="td text-xs text-red-700">{job.errorCode ?? '—'}</td>
                <td className="td text-xs text-ink-500">{new Date(job.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink-500">{total} jobs · page {page}</p>
    </AdminShell>
  );
}
