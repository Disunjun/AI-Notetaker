import { describe, expect, it } from 'vitest';
import { redact, REDACTION_PLACEHOLDER } from '@/lib/logger';

describe('log redaction', () => {
  it('redacts credential-bearing keys by name', () => {
    const output = redact({
      apiKey: 'sk-abcdefghij1234567890',
      password: 'hunter2',
      token: 'a-session-token',
      tokenHash: 'deadbeef',
      otp: '123456',
      authorization: 'Bearer abc',
      appSecret: 'secret-value',
    }) as Record<string, unknown>;

    for (const key of ['apiKey', 'password', 'token', 'tokenHash', 'otp', 'authorization', 'appSecret']) {
      expect(output[key]).toBe(REDACTION_PLACEHOLDER);
    }
  });

  it('redacts key names regardless of casing or separators', () => {
    const output = redact({ API_KEY: 'sk-1234', api_key: 'sk-1234', ApiKeyEncrypted: 'v1.a.b.c' }) as Record<string, unknown>;
    expect(output.API_KEY).toBe(REDACTION_PLACEHOLDER);
    expect(output.api_key).toBe(REDACTION_PLACEHOLDER);
    expect(output.ApiKeyEncrypted).toBe(REDACTION_PLACEHOLDER);
  });

  it('redacts credential-shaped values even under an innocent key', () => {
    const output = redact({ note: 'sk-proj-abcdefghijklmnop' }) as Record<string, unknown>;
    expect(output.note).toBe(REDACTION_PLACEHOLDER);
  });

  it('redacts Resend, Google, Anthropic and Groq key shapes', () => {
    const values = ['re_abcdefgh12345', 'AIzaSyABCDEFGHIJKLMNOPQRSTUV', 'sk-ant-abcdefgh12345', 'gsk_abcdefgh12345'];
    for (const value of values) {
      expect((redact({ v: value }) as Record<string, unknown>).v).toBe(REDACTION_PLACEHOLDER);
    }
  });

  it('redacts a Bearer header value', () => {
    expect((redact({ header: 'Bearer sk-something-secret' }) as Record<string, unknown>).header).toBe(REDACTION_PLACEHOLDER);
  });

  it('truncates transcript, prompt, response and content fields instead of logging them whole', () => {
    const long = 'x'.repeat(5000);
    const output = redact({ transcript: long, prompt: long, response: long, content: long }) as Record<string, string>;
    for (const key of ['transcript', 'prompt', 'response', 'content']) {
      expect(output[key]!.length).toBeLessThan(200);
      expect(output[key]).toContain('[truncated:5000]');
    }
  });

  it('redacts recursively through nested objects and arrays', () => {
    const output = redact({ request: { headers: { Authorization: 'Bearer x' }, body: { apiKey: 'sk-1' } }, list: [{ token: 't' }] });
    const nested = output as { request: { headers: { Authorization: string }; body: { apiKey: string } }; list: Array<{ token: string }> };
    expect(nested.request.headers.Authorization).toBe(REDACTION_PLACEHOLDER);
    expect(nested.request.body.apiKey).toBe(REDACTION_PLACEHOLDER);
    expect(nested.list[0]!.token).toBe(REDACTION_PLACEHOLDER);
  });

  it('serialises an Error without its stack', () => {
    const output = redact(new Error('boom')) as { name: string; message: string; stack?: string };
    expect(output.name).toBe('Error');
    expect(output.message).toBe('boom');
    expect(output.stack).toBeUndefined();
  });

  it('preserves non-sensitive values', () => {
    const output = redact({ jobId: 'abc-123', status: 'QUEUED', attempts: 2, ok: true }) as Record<string, unknown>;
    expect(output).toEqual({ jobId: 'abc-123', status: 'QUEUED', attempts: 2, ok: true });
  });

  it('redacts a 6-digit OTP held under the ambiguous "code" key', () => {
    expect((redact({ code: '482913' }) as Record<string, unknown>).code).toBe(REDACTION_PLACEHOLDER);
  });

  it('does NOT redact error codes, which observability depends on', () => {
    const output = redact({ code: 'AI_PROVIDER_TIMEOUT', errorCode: 'WATCHDOG_MAX_REQUEUES' }) as Record<string, unknown>;
    expect(output.code).toBe('AI_PROVIDER_TIMEOUT');
    expect(output.errorCode).toBe('WATCHDOG_MAX_REQUEUES');
  });

  it('stops at a bounded depth', () => {
    let deep: Record<string, unknown> = { apiKey: 'sk-1' };
    for (let i = 0; i < 12; i += 1) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain('[max-depth]');
  });
});
