import { ok, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clearedCookie, describeSessionCookie, revokeUserSession } from '@/lib/auth/sessions';
import { USER_SESSION_COOKIE } from '@/lib/domain';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await revokeUserSession(req);
  return ok({ loggedOut: true }, { headers: { 'set-cookie': describeSessionCookie(clearedCookie(USER_SESSION_COOKIE)) } });
});
