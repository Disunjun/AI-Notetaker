import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { consumeMagicLink, consumeOtp, countActiveTokens, issueMagicLink, issueOtp } from '@/lib/auth/tokens';
import { createAdminSession, createUserSession, resolveAdmin, resolveUser } from '@/lib/auth/sessions';
import { hashToken } from '@/lib/crypto';
import { verifyPassword } from '@/lib/auth/password';
import { AuthTokenType } from '@/lib/domain';
import { ErrorCode } from '@/lib/errors';
import { configureResend, createAdmin, createUser, resetDatabase } from '@/tests/helpers/db';
import { integrationAvailable } from '@/tests/helpers/integration';

/**
 * Authentication and admin isolation.
 *
 * Requires a generated Prisma client and a reachable PostgreSQL. See
 * tests/helpers/integration.ts for why these suites are gated.
 */
describe.skipIf(!integrationAvailable)('authentication', { skip: !integrationAvailable }, () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('issues a single-use magic link that cannot be replayed', async () => {
    const user = await createUser('alice@example.com');
    const { token } = await issueMagicLink(user.id);

    await consumeMagicLink(user.id, token);
    await expect(consumeMagicLink(user.id, token)).rejects.toMatchObject({ code: ErrorCode.TOKEN_INVALID });
  });

  it('issues a single-use OTP that cannot be replayed', async () => {
    const user = await createUser('bob@example.com');
    const { code } = await issueOtp(user.id);
    expect(code).toMatch(/^\d{6}$/);

    await consumeOtp(user.id, code);
    await expect(consumeOtp(user.id, code)).rejects.toMatchObject({ code: ErrorCode.TOKEN_EXPIRED });
  });

  it('rejects a wrong OTP and voids the code after too many attempts', async () => {
    const user = await createUser('carol@example.com');
    const { code } = await issueOtp(user.id);

    for (let i = 0; i < 5; i += 1) {
      const wrong = code === '000000' ? '000001' : '000000';
      await expect(consumeOtp(user.id, wrong)).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID });
    }
    // The sixth attempt is refused even with the correct code.
    await expect(consumeOtp(user.id, code)).rejects.toMatchObject({ code: ErrorCode.TOKEN_USED });
  });

  it('supersedes an earlier unspent credential of the same type', async () => {
    const user = await createUser('dave@example.com');
    const first = await issueOtp(user.id);
    const second = await issueOtp(user.id);

    await expect(consumeOtp(user.id, first.code)).rejects.toBeDefined();
    await expect(consumeOtp(user.id, second.code)).resolves.toBeUndefined();
  });

  it('stores only token hashes, never the token itself', async () => {
    const user = await createUser('erin@example.com');
    const { token } = await issueMagicLink(user.id);

    const rows = await prisma.authToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('stores only session-token hashes', async () => {
    const user = await createUser('frank@example.com');
    const session = await createUserSession(user.id);

    const row = await prisma.userSession.findFirst({ where: { userId: user.id } });
    expect(row!.tokenHash).toBe(hashToken(session.token));
    expect(JSON.stringify(row)).not.toContain(session.token);
  });

  it('resolves a user session from its cookie value', async () => {
    const user = await createUser('grace@example.com');
    const session = await createUserSession(user.id);
    const request = new Request('http://localhost/api/me', { headers: { cookie: `ai_notetaker_session=${session.token}` } });

    const resolved = await resolveUser(request);
    expect(resolved?.id).toBe(user.id);
  });

  it('never satisfies a user check with an admin session, or vice versa', async () => {
    const user = await createUser('heidi@example.com');
    const admin = await createAdmin('root@example.com', 'admin-password-123');
    const userSession = await createUserSession(user.id);
    const adminSession = await createAdminSession(admin.id);

    const userRequest = new Request('http://localhost/api/me', { headers: { cookie: `ai_notetaker_session=${userSession.token}` } });
    const adminRequest = new Request('http://localhost/api/admin/me', { headers: { cookie: `ai_notetaker_admin_session=${adminSession.token}` } });
    const crossedUser = new Request('http://localhost/api/me', { headers: { cookie: `ai_notetaker_session=${adminSession.token}` } });
    const crossedAdmin = new Request('http://localhost/api/admin/me', { headers: { cookie: `ai_notetaker_admin_session=${userSession.token}` } });

    expect(await resolveUser(userRequest)).not.toBeNull();
    expect(await resolveAdmin(adminRequest)).not.toBeNull();
    expect(await resolveUser(crossedUser)).toBeNull();
    expect(await resolveAdmin(crossedAdmin)).toBeNull();
  });

  it('hashes the admin password with Argon2id and never stores it in plaintext', async () => {
    const password = 'admin-password-123';
    const admin = await createAdmin('ivan@example.com', password);
    const row = await prisma.admin.findUnique({ where: { id: admin.id } });

    expect(row!.passwordHash).not.toBe(password);
    expect(row!.passwordHash).not.toContain(password);
    expect(String(row!.passwordHash).startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(String(row!.passwordHash), password)).toBe(true);
    expect(await verifyPassword(String(row!.passwordHash), 'wrong')).toBe(false);
  });

  it('records OTP and magic-link types distinctly', async () => {
    const user = await createUser('judy@example.com');
    await issueOtp(user.id);
    expect(await prisma.authToken.count({ where: { userId: user.id, type: AuthTokenType.OTP } })).toBe(1);
    await issueMagicLink(user.id);
    expect(await prisma.authToken.count({ where: { userId: user.id, type: AuthTokenType.MAGIC_LINK } })).toBe(1);
    expect(await countActiveTokens(user.id)).toBe(2);
  });

  it('does not depend on Resend being configured for admin sign-in', async () => {
    // No Resend row is created here on purpose.
    const admin = await createAdmin('kate@example.com', 'admin-password-123');
    const session = await createAdminSession(admin.id);
    const request = new Request('http://localhost/api/admin/me', {
      headers: { cookie: `ai_notetaker_admin_session=${session.token}` },
    });
    expect(await resolveAdmin(request)).not.toBeNull();
  });

  it('resolves nothing when Resend is configured but the session is revoked', async () => {
    await configureResend();
    const user = await createUser('leo@example.com');
    const session = await createUserSession(user.id);
    await prisma.userSession.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });

    const request = new Request('http://localhost/api/me', { headers: { cookie: `ai_notetaker_session=${session.token}` } });
    expect(await resolveUser(request)).toBeNull();
  });
});
