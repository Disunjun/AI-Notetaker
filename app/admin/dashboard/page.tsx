import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { prisma } from '@/lib/db';
import { JobStatus, WATCHDOG_STALE_AFTER_MS } from '@/lib/domain';
import { ProviderRole } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const admin = await requireAdminPage();

  const staleCutoff = new Date(Date.now() - WATCHDOG_STALE_AFTER_MS);
  const [users, notes, jobs, queued, processing, completed, failed, stale, providers, emailConfigured] = await Promise.all([
    prisma.user.count(),
    prisma.note.count(),
    prisma.job.count(),
    prisma.job.count({ where: { status: JobStatus.QUEUED } }),
    prisma.job.count({ where: { status: JobStatus.PROCESSING } }),
    prisma.job.count({ where: { status: JobStatus.COMPLETED } }),
    prisma.job.count({ where: { status: JobStatus.FAILED } }),
    prisma.job.count({
      where: { status: JobStatus.PROCESSING, OR: [{ lastHeartbeatAt: { lt: staleCutoff } }, { lastHeartbeatAt: null, startedAt: { lt: staleCutoff } }] },
    }),
    prisma.aIProviderConfig.count({ where: { isActive: true } }),
    prisma.resendConfig.count({ where: { isActive: true } }),
  ]);

  const [transcriptionProviders, textProviders] = await Promise.all([
    prisma.aIProviderConfig.count({ where: { role: ProviderRole.TRANSCRIPTION, isActive: true } }),
    prisma.aIProviderConfig.count({ where: { role: ProviderRole.TEXT, isActive: true } }),
  ]);

  const cards = [
    { label: 'Users', value: users },
    { label: 'Notes', value: notes },
    { label: 'Jobs', value: jobs },
    { label: 'Queued', value: queued },
    { label: 'Processing', value: processing },
    { label: 'Completed', value: completed },
    { label: 'Failed', value: failed },
    { label: 'Stale (needs watchdog)', value: stale },
  ];

  return (
    <AdminShell email={admin.email}>
      <h1 className="mb-6 text-2xl font-semibold text-ink-900">Overview</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="card">
            <p className="text-sm text-ink-500">{card.label}</p>
            <p className="mt-1 text-3xl font-semibold text-ink-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-sm text-ink-500">Transcription providers</p>
          <p className="mt-1 text-2xl font-semibold">{transcriptionProviders}</p>
          <p className="mt-1 text-xs text-ink-500">{transcriptionProviders === 0 ? 'Uploads will return 503' : 'Active'}</p>
        </div>
        <div className="card">
          <p className="text-sm text-ink-500">Text providers</p>
          <p className="mt-1 text-2xl font-semibold">{textProviders}</p>
          <p className="mt-1 text-xs text-ink-500">{textProviders === 0 ? 'Uploads will return 503' : 'Active'}</p>
        </div>
        <div className="card">
          <p className="text-sm text-ink-500">Email (Resend)</p>
          <p className="mt-1 text-2xl font-semibold">{emailConfigured > 0 ? 'Configured' : 'Missing'}</p>
          <p className="mt-1 text-xs text-ink-500">{emailConfigured > 0 ? `${providers} AI configs active` : 'Sign-in emails cannot be sent'}</p>
        </div>
      </div>
    </AdminShell>
  );
}
