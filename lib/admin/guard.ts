import { redirect } from 'next/navigation';
import { resolveAdmin } from '@/lib/auth/sessions';

/**
 * Server-component guard for admin pages. User sessions never satisfy this —
 * only a valid admin session does.
 */
export async function requireAdminPage(): Promise<{ id: string; email: string }> {
  const admin = await resolveAdmin();
  if (!admin) redirect('/admin/login');
  return admin;
}
