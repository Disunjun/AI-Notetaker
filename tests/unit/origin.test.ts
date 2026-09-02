import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from '@/lib/security/origin';
import { ErrorCode } from '@/lib/errors';

const APP_ORIGIN = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin;

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request(`${APP_ORIGIN}/api/notes/upload`, { method, headers });
}

describe('CSRF / origin protection', () => {
  it('allows a same-origin mutating request', () => {
    expect(() => assertSameOrigin(request('POST', { origin: APP_ORIGIN }))).not.toThrow();
  });

  it('rejects a cross-origin POST', () => {
    expect(() => assertSameOrigin(request('POST', { origin: 'https://evil.example' }))).toThrowError(
      expect.objectContaining({ code: ErrorCode.ORIGIN_REJECTED, status: 403 }),
    );
  });

  it('rejects a mutating request with no Origin header at all', () => {
    expect(() => assertSameOrigin(request('POST'))).toThrowError(expect.objectContaining({ code: ErrorCode.ORIGIN_REJECTED }));
  });

  it('rejects a malformed Origin header', () => {
    expect(() => assertSameOrigin(request('POST', { origin: 'not a url' }))).toThrowError(
      expect.objectContaining({ code: ErrorCode.ORIGIN_REJECTED }),
    );
  });

  it('accepts a matching Referer when Origin is absent', () => {
    expect(() => assertSameOrigin(request('POST', { referer: `${APP_ORIGIN}/dashboard` }))).not.toThrow();
  });

  it('rejects a foreign Referer', () => {
    expect(() => assertSameOrigin(request('POST', { referer: 'https://evil.example/dashboard' }))).toThrowError(
      expect.objectContaining({ code: ErrorCode.ORIGIN_REJECTED }),
    );
  });

  it('does not constrain safe read methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(() => assertSameOrigin(request(method))).not.toThrow();
    }
  });

  it('constrains every mutating method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => assertSameOrigin(request(method))).toThrowError(expect.objectContaining({ code: ErrorCode.ORIGIN_REJECTED }));
    }
  });

  it('is not bypassed by a subdomain or port variation', () => {
    for (const origin of [`${APP_ORIGIN}.evil.com`, 'http://localhost:9999', 'https://localhost:3000']) {
      if (origin === APP_ORIGIN) continue;
      expect(() => assertSameOrigin(request('POST', { origin }))).toThrow();
    }
  });
});
