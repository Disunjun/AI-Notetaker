import { requireAdminPage } from '@/lib/admin/guard';
import { AdminShell } from '@/components/AdminShell';
import { ResendManager } from '@/components/ResendManager';
import { prisma } from '@/lib/db';
import { toResendDto, type ResendRow } from '@/lib/ai/dto';

export const dynamic = 'force-dynamic';

export default async function AdminResendPage() {
  const admin = await requireAdminPage();
  const row = (await prisma.resendConfig.findFirst()) as unknown as ResendRow | null;

  return (
    <AdminShell email={admin.email}>
      <h1 className="mb-2 text-2xl font-semibold text-ink-900">Resend</h1>
      <p className="mb-6 text-sm text-ink-500">
        The API key is stored encrypted in PostgreSQL. Email failures never change a completed AI job to FAILED — they are
        independent side effects recorded in the email log.
      </p>
      <ResendManager config={row ? toResendDto(row) : null} />
    </AdminShell>
  );
}
