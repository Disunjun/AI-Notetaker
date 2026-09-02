import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { AIProvidersManager } from '@/components/AIProvidersManager';
import { prisma } from '@/lib/db';
import { toProviderDto, type ProviderRow } from '@/lib/ai/dto';

export const dynamic = 'force-dynamic';

export default async function AdminAIProvidersPage() {
  const admin = await requireAdminPage();
  const rows = (await prisma.aIProviderConfig.findMany({ orderBy: [{ role: 'asc' }, { priority: 'asc' }] })) as unknown as ProviderRow[];

  return (
    <AdminShell email={admin.email}>
      <h1 className="mb-2 text-2xl font-semibold text-ink-900">AI providers</h1>
      <p className="mb-6 text-sm text-ink-500">
        Credentials are stored encrypted in PostgreSQL and are never read from environment variables. Keys are always
        masked here. Fallback is used only for transient failures (timeout, network, HTTP 429 or 5xx).
      </p>
      <AIProvidersManager providers={rows.map(toProviderDto)} />
    </AdminShell>
  );
}
