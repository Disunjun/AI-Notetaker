import { ok, route } from '@/lib/http/respond';
import { requireAdmin } from '@/lib/auth/sessions';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const admin = await requireAdmin(req);
  return ok({ id: admin.id, email: admin.email });
});
