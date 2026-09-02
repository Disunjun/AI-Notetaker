import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clientIdentifier, enforceRateLimit } from '@/lib/security/rate-limit';
import { redis } from '@/lib/redis';
import { consumeMagicLink, consumeOtp, findOrCreateUserByEmail } from '@/lib/auth/tokens';
import { createUserSession, describeSessionCookie, userSessionCookie } from '@/lib/auth/sessions';
import { VerifySchema, parseWith } from '@/lib/validation';
import { AppError, ErrorCode } from '@/lib/errors';
import { AuthTokenType } from '@/lib/domain';
import { logger } from '@/lib/logger';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = parseWith(VerifySchema, await readJson(req));

  await enforceRateLimit(redis(), 'auth:verify', clientIdentifier(req, body.email), 10, 15 * 60);

  const user = await findOrCreateUserByEmail(body.email);

  const method = body.method ?? (body.code ? 'otp' : body.token ? 'magic_link' : undefined);
  if (!method) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Provide either a token or a 6-digit code');
  }

  if (method === 'otp') {
    if (!body.code) throw new AppError(ErrorCode.VALIDATION_ERROR, 'A 6-digit code is required');
    await consumeOtp(user.id, body.code);
  } else {
    if (!body.token) throw new AppError(ErrorCode.VALIDATION_ERROR, 'A sign-in token is required');
    await consumeMagicLink(user.id, body.token);
  }

  const session = await createUserSession(user.id, req);
  const cookie = describeSessionCookie(userSessionCookie(session.token));

  logger.info('user_signed_in', { userId: user.id, method: method === 'otp' ? AuthTokenType.OTP : AuthTokenType.MAGIC_LINK });

  return ok(
    { user: session.user, expiresAt: session.expiresAt.toISOString() },
    { headers: { 'set-cookie': cookie } },
  );
});
