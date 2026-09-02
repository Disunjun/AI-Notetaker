import { generateOtp, hashToken, randomToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { AuthTokenType } from '@/lib/domain';

/**
 * Magic links and 6-digit OTPs.
 *
 * Both are finite-TTL and single-use. Only hashes are stored, and consumption
 * happens inside a transaction with a re-check, so a credential cannot be
 * replayed even under concurrent requests.
 */

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

export async function issueMagicLink(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, type: AuthTokenType.MAGIC_LINK, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({ data: { userId, type: AuthTokenType.MAGIC_LINK, tokenHash: hashToken(token), expiresAt } }),
  ]);
  return { token, expiresAt };
}

export async function issueOtp(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, type: AuthTokenType.OTP, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({ data: { userId, type: AuthTokenType.OTP, otpHash: hashToken(code), expiresAt } }),
  ]);
  return { code, expiresAt };
}

/** Find (or create) the user for an email address. Emails are stored lowercase. */
export async function findOrCreateUserByEmail(email: string): Promise<{ id: string; email: string }> {
  const normalised = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalised }, select: { id: true, email: true } });
  if (existing) {
    if (!existing.isActive) throw new AppError(ErrorCode.FORBIDDEN, 'This account is disabled');
    return { id: existing.id as string, email: existing.email as string };
  }
  const created = await prisma.user.create({ data: { email: normalised }, select: { id: true, email: true } });
  logger.info('user_created', { userId: created.id as string });
  return { id: created.id as string, email: created.email as string };
}

interface ConsumeResult {
  userId: string;
}

/**
 * Atomically mark a matching, unspent, unexpired credential as used.
 * Returns null when nothing matched.
 */
async function consumeToken(where: Record<string, unknown>): Promise<ConsumeResult | null> {
  const updated = await prisma.authToken.updateMany({
    where: { ...where, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (updated.count === 0) return null;
  const record = await prisma.authToken.findFirst({
    where: { ...where, usedAt: { not: null } },
    orderBy: { usedAt: 'desc' },
    select: { userId: true },
  });
  return record ? { userId: record.userId as string } : null;
}

export async function consumeMagicLink(userId: string, token: string): Promise<void> {
  const result = await consumeToken({ userId, type: AuthTokenType.MAGIC_LINK, tokenHash: hashToken(token) });
  if (!result) throw new AppError(ErrorCode.TOKEN_INVALID, 'This sign-in link is invalid, expired, or already used');
}

export async function consumeOtp(userId: string, code: string): Promise<void> {
  const pending = await prisma.authToken.findFirst({
    where: { userId, type: AuthTokenType.OTP, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!pending || pending.expiresAt.getTime() <= Date.now()) {
    throw new AppError(ErrorCode.TOKEN_EXPIRED, 'This code has expired. Request a new one.');
  }

  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.authToken.update({ where: { id: pending.id }, data: { usedAt: new Date() } });
    throw new AppError(ErrorCode.TOKEN_USED, 'Too many incorrect attempts. Request a new code.');
  }

  if (pending.otpHash !== hashToken(code)) {
    await prisma.authToken.update({ where: { id: pending.id }, data: { attempts: { increment: 1 } } });
    throw new AppError(ErrorCode.OTP_INVALID, 'That code is incorrect');
  }

  // Single-use: consumed exactly once, guarded by usedAt: null.
  const consumed = await prisma.authToken.updateMany({
    where: { id: pending.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) {
    throw new AppError(ErrorCode.TOKEN_USED, 'That code has already been used');
  }
}

/** Diagnostic only — never returns credentials. */
export async function describeAuthService(userId: string): Promise<{ pendingMagicLinks: number; pendingOtps: number }> {
  const [pendingMagicLinks, pendingOtps] = await Promise.all([
    prisma.authToken.count({ where: { userId, type: AuthTokenType.MAGIC_LINK, usedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.authToken.count({ where: { userId, type: AuthTokenType.OTP, usedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { pendingMagicLinks, pendingOtps };
}

/** Test helper used by integration tests to assert single-use behaviour. */
export async function countActiveTokens(userId: string): Promise<number> {
  return prisma.authToken.count({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
}
