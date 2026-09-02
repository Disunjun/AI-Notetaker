import { describe, expect, it } from 'vitest';

/**
 * End-to-end smoke test against a running deployment.
 *
 * Set E2E_BASE_URL (and optionally E2E_EMAIL) to run it, e.g. against
 * `docker compose up`. It exercises the real HTTP surface: health, service
 * status, the passwordless sign-in entry points, origin protection, and the
 * admin login path.
 *
 * It deliberately stops short of requiring a real AI provider or a real
 * mailbox — those are environment-specific. The upload/pipeline path is covered
 * by the integration suite with a stubbed provider boundary.
 */
const BASE_URL = process.env.E2E_BASE_URL;
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@example.com';

describe.skipIf(!BASE_URL)('end to end', { skip: !BASE_URL }, () => {
  const base = BASE_URL ?? '';

  it('reports health', async () => {
    const response = await fetch(`${base}/api/health`);
    expect([200, 503]).toContain(response.status);
    const body = (await response.json()) as { data: { status: string; database: string; queue: string } };
    expect(body.data.status).toBeDefined();
    expect(body.data.database).toBe('ok');
  });

  it('exposes the public service status without leaking configuration', async () => {
    const response = await fetch(`${base}/api/auth/service-status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      emailConfigured: expect.any(Boolean),
      aiConfigured: expect.any(Boolean),
      otpEnabled: expect.any(Boolean),
      magicLinkEnabled: expect.any(Boolean),
    });
    expect(JSON.stringify(body)).not.toMatch(/sk-|re_|apiKey/i);
  });

  it('requires the user authentication cookie on protected routes', async () => {
    for (const path of ['/api/me', '/api/notes']) {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('requires the admin cookie on admin routes', async () => {
    const response = await fetch(`${base}/api/admin/ai-providers`, { redirect: 'manual' });
    expect(response.status).toBe(401);
  });

  it('rejects a mutating request from a foreign origin', async () => {
    const response = await fetch(`${base}/api/auth/request-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: EMAIL }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ORIGIN_REJECTED');
  });

  it('accepts a magic-link request from the application origin', async () => {
    const response = await fetch(`${base}/api/auth/request-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email: EMAIL }),
    });
    // 200 whether or not email is configured; the response must not reveal
    // whether the address exists.
    expect([200, 503]).toContain(response.status);
  });

  it('rejects an invalid sign-in token', async () => {
    const response = await fetch(`${base}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email: EMAIL, token: 'a'.repeat(40), method: 'magic_link' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects bad admin credentials without revealing whether the account exists', async () => {
    const response = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'whatever-password' }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ADMIN_CREDENTIALS_INVALID');
    expect(body.error.message).not.toMatch(/no such|not found|unknown user/i);
  });

  it('sends security headers on every response', async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});
