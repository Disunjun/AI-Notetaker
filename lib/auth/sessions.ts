import { cookies } from 'next/headers';
import { hashToken, randomToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { env, isProduction } from '@/lib/env';
import { ADMIN_SESSION_COOKIE, USER_SESSION_COOKIE } from '@/lib/domain';
import { AppError, ErrorCode } from '@/lib/errors';
import type { UserDto } from '@/types';

/**
 * Session management for users and admins.
 *
 *  - The raw token is returned to the caller exactly once (to be set as a
 *    cookie). Only its SHA-256 hash is persisted.
 *  - User and admin sessions live in separate tables under separate cookies, so
 *    one can never satisfy a check for the other.
 */

export const USER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

interface CookieDescriptor {
  name: string;
  value: string;
  maxAge: number;
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number): CookieDescriptor {
  return { name, value, maxAge: maxAgeSeconds };
}

export function describeSessionCookie(descriptor: CookieDescriptor): string {
  const parts = [
    `${descriptor.name}=${descriptor.value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${descriptor.maxAge}`,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

function meta(req?: Request): { userAgent: string | null; ip: string | null } {
  if (!req) return { userAgent: null, ip: null };
  return {
    userAgent: req.headers.get('user-agent')?.slice(0, 512) ?? null,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0, 64) ?? req.headers.get('x-real-ip') ?? null,
  };
}

export interface CreatedUserSession {
  token: string;
  expiresAt: Date;
  user: UserDto;
}

export async function createUserSession(userId: string, req?: Request): Promise<CreatedUserSession> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + USER_SESSION_TTL_MS);
  const { userAgent, ip } = meta(req);

  const session = await prisma.userSession.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent, ip },
    include: { user: { select: { id: true, email: true, createdAt: true } } },
  });

  return {
    token,
    expiresAt,
    user: {
      id: session.user.id as string,
      email: session.user.email as string,
      createdAt: (session.user.createdAt as Date).toISOString(),
    },
  };
}

export async function createAdminSession(adminId: string, req?: Request): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
  const { userAgent, ip } = meta(req);
  await prisma.adminSession.create({ data: { adminId, tokenHash: hashToken(token), expiresAt, userAgent, ip } });
  return { token, expiresAt };
}

export function userSessionCookie(token: string): CookieDescriptor {
  return sessionCookie(USER_SESSION_COOKIE, token, Math.floor(USER_SESSION_TTL_MS / 1000));
}

export function adminSessionCookie(token: string): CookieDescriptor {
  return sessionCookie(ADMIN_SESSION_COOKIE, token, Math.floor(ADMIN_SESSION_TTL_MS / 1000));
}

export function clearedCookie(name: string): CookieDescriptor {
  return { name, value: '', maxAge: 0 };
}

async function cookieValue(name: string, req?: Request): Promise<string | null> {
  if (req) {
    const header = req.headers.get('cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
  }
  const store = await cookies();
  return store.get(name)?.value ?? null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export async function resolveUser(req?: Request): Promise<AuthenticatedUser | null> {
  const token = await cookieValue(USER_SESSION_COOKIE, req);
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, isActive: true } } },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;

  return { id: session.user.id as string, email: session.user.email as string };
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
}

export async function resolveAdmin(req?: Request): Promise<AuthenticatedAdmin | null> {
  const token = await cookieValue(ADMIN_SESSION_COOKIE, req);
  if (!token) return null;

  const session = await prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { admin: { select: { id: true, email: true, isActive: true } } },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.admin.isActive) return null;

  return { id: session.admin.id as string, email: session.admin.email as string };
}

/** Throws 401 UNAUTHENTICATED when there is no valid user session. */
export async function requireUser(req: Request): Promise<AuthenticatedUser> {
  const user = await resolveUser(req);
  if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
  return user;
}

/** Throws 401 UNAUTHENTICATED when there is no valid admin session. */
export async function requireAdmin(req: Request): Promise<AuthenticatedAdmin> {
  const admin = await resolveAdmin(req);
  if (!admin) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Admin authentication required');
  return admin;
}

export async function revokeUserSession(req: Request): Promise<void> {
  const token = await cookieValue(USER_SESSION_COOKIE, req);
  if (!token) return;
  await prisma.userSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAdminSession(req: Request): Promise<void> {
  const token = await cookieValue(ADMIN_SESSION_COOKIE, req);
  if (!token) return;
  await prisma.adminSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Fail closed if APP_URL is not an absolute URL — links must be absolute. */
export function absoluteUrl(path: string): string {
  return new URL(path, env().APP_URL).toString();
}
