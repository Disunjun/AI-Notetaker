import { ok, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clearedCookie, describeSessionCookie, revokeAdminSession } from '@/lib/auth/sessions';
import { ADMIN_SESSION_COOKIE } from '@/lib/domain';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await revokeAdminSession(req);
  return ok({ loggedOut: true }, { headers: { 'set-cookie': describeSessionCookie(clearedCookie(ADMIN_SESSION_COOKIE)) } });
});
