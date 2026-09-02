import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clientIdentifier, enforceRateLimit } from '@/lib/security/rate-limit';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { adminSessionCookie, createAdminSession, describeSessionCookie } from '@/lib/auth/sessions';
import { AdminLoginSchema, parseWith } from '@/lib/validation';
import { AppError, ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Admin login. Email + password only — deliberately independent of Resend, so
 * an email outage can never lock an administrator out.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { email, password } = parseWith(AdminLoginSchema, await readJson(req));

  await enforceRateLimit(redis(), 'admin:login', clientIdentifier(req, email), 8, 15 * 60);

  const admin = (await prisma.admin.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, isActive: true },
  })) as unknown as { id: string; email: string; passwordHash: string; isActive: boolean } | null;

  // Identical error for unknown account and wrong password: no account enumeration.
  const valid = admin ? await verifyPassword(admin.passwordHash, password) : false;
  if (!admin || !valid) {
    logger.warn('admin_login_failed', { email });
    throw new AppError(ErrorCode.ADMIN_CREDENTIALS_INVALID, 'Invalid email or password');
  }
  if (!admin.isActive) {
    throw new AppError(ErrorCode.FORBIDDEN, 'This admin account is disabled');
  }

  const { token, expiresAt } = await createAdminSession(admin.id, req);
  const cookie = describeSessionCookie(adminSessionCookie(token));

  logger.info('admin_signed_in', { adminId: admin.id });

  return ok({ admin: { id: admin.id, email: admin.email }, expiresAt: expiresAt.toISOString() }, { headers: { 'set-cookie': cookie } });
});
