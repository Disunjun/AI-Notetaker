import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { env } from '@/lib/env';
import { JobStatus, QUEUE_NAME, WATCHDOG_MAX_REQUEUES, WATCHDOG_STALE_AFTER_MS } from '@/lib/domain';
import { queueHealthCounts } from '@/lib/queue/producer';

export const dynamic = 'force-dynamic';

export default async function AdminQueueHealthPage() {
  const admin = await requireAdminPage();

  const cutoff = new Date(Date.now() - WATCHDOG_STALE_AFTER_MS);
  const [counts, connected, stale, stuck, maxedOut] = await Promise.all([
    queueHealthCounts().catch(() => null),
    redis()
      .ping()
      .then((pong) => pong === 'PONG')
      .catch(() => false),
    prisma.job.count({
      where: { status: JobStatus.PROCESSING, OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null, startedAt: { lt: cutoff } }] },
    }),
    prisma.job.count({ where: { status: JobStatus.QUEUED, queuedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } } }),
    prisma.job.count({ where: { watchdogRequeues: { gte: WATCHDOG_MAX_REQUEUES } } }),
  ]);

  const cards = [
    { label: 'Queue name', value: QUEUE_NAME },
    { label: 'Redis', value: connected ? 'connected' : 'unreachable' },
    { label: 'Waiting', value: String(counts?.waiting ?? '—') },
    { label: 'Active', value: String(counts?.active ?? '—') },
    { label: 'Delayed', value: String(counts?.delayed ?? '—') },
    { label: 'Failed', value: String(counts?.failed ?? '—') },
    { label: 'Completed', value: String(counts?.completed ?? '—') },
    { label: 'Worker concurrency', value: String(env().WORKER_CONCURRENCY) },
    { label: 'Stale PROCESSING (>30m)', value: String(stale) },
    { label: 'Stuck QUEUED (>15m)', value: String(stuck) },
    { label: 'At watchdog limit (3)', value: String(maxedOut) },
  ];

  return (
    <AdminShell email={admin.email}>
      <h1 className="mb-2 text-2xl font-semibold text-ink-900">Queue health</h1>
      <p className="mb-6 text-sm text-ink-500">
        The watchdog requeues PROCESSING jobs whose heartbeat is more than 30 minutes stale, up to {WATCHDOG_MAX_REQUEUES}{' '}
        times. Beyond that a job is marked FAILED rather than looping forever.
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <p className="text-sm text-ink-500">{card.label}</p>
            <p className="mt-1 truncate text-xl font-semibold text-ink-900">{card.value}</p>
          </div>
        ))}
      </div>

      {!connected && (
        <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Redis is unreachable from the web process. Jobs cannot be enqueued or consumed until it recovers.
        </p>
      )}
    </AdminShell>
  );
}
