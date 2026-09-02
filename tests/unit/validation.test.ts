import { describe, expect, it } from 'vitest';
import {
  ActionItemPatchSchema,
  AIProviderUpsertSchema,
  AdminLoginSchema,
  parseWith,
  ResendUpsertSchema,
  VerifySchema,
} from '@/lib/validation';
import { ErrorCode } from '@/lib/errors';

describe('request validation', () => {
  it('normalises emails to lowercase and trims them', () => {
    expect(parseWith(VerifySchema, { email: '  User@Example.COM ', code: '123456' }).email).toBe('user@example.com');
  });

  it('rejects an invalid email with a field error', () => {
    try {
      parseWith(VerifySchema, { email: 'not-an-email', code: '123456' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      expect((error as { fields?: Record<string, string> }).fields?.email).toBeDefined();
    }
  });

  it('requires an OTP to be exactly six digits', () => {
    expect(parseWith(VerifySchema, { email: 'a@b.co', code: '123456' }).code).toBe('123456');
    expect(() => parseWith(VerifySchema, { email: 'a@b.co', code: '12345' })).toThrow();
    expect(() => parseWith(VerifySchema, { email: 'a@b.co', code: '1234567' })).toThrow();
    expect(() => parseWith(VerifySchema, { email: 'a@b.co', code: 'abcdef' })).toThrow();
  });

  it('requires an admin password to be present', () => {
    expect(() => parseWith(AdminLoginSchema, { email: 'a@b.co', password: '' })).toThrow();
  });

  it('requires at least one field on an action item patch', () => {
    expect(() => parseWith(ActionItemPatchSchema, {})).toThrow();
    expect(parseWith(ActionItemPatchSchema, { completed: true }).completed).toBe(true);
  });

  it('rejects an over-long action item content', () => {
    expect(() => parseWith(ActionItemPatchSchema, { content: 'a'.repeat(2000) })).toThrow();
  });
});

describe('AI provider configuration validation', () => {
  const base = { name: 'primary', provider: 'OPENAI', model: 'gpt-4o-mini' };

  it('accepts a minimal provider definition', () => {
    expect(parseWith(AIProviderUpsertSchema, base).name).toBe('primary');
  });

  it('accepts an optional apiKey but rejects one that is too short', () => {
    expect(parseWith(AIProviderUpsertSchema, { ...base, apiKey: 'sk-abcdefghij' }).apiKey).toBe('sk-abcdefghij');
    expect(() => parseWith(AIProviderUpsertSchema, { ...base, apiKey: 'short' })).toThrow();
  });

  it('validates baseUrl as an absolute URL', () => {
    expect(() => parseWith(AIProviderUpsertSchema, { ...base, baseUrl: 'not-a-url' })).toThrow();
    expect(parseWith(AIProviderUpsertSchema, { ...base, baseUrl: '' }).baseUrl).toBeNull();
  });

  it('bounds the timeout', () => {
    expect(() => parseWith(AIProviderUpsertSchema, { ...base, timeoutMs: 10 })).toThrow();
    expect(parseWith(AIProviderUpsertSchema, { ...base, timeoutMs: 30000 }).timeoutMs).toBe(30000);
  });

  it('rejects an unknown provider type', () => {
    expect(() => parseWith(AIProviderUpsertSchema, { ...base, provider: 'SKYNET' })).toThrow();
  });
});

describe('Resend configuration validation', () => {
  it('requires a valid sender address', () => {
    expect(parseWith(ResendUpsertSchema, { fromEmail: 'notes@example.com' }).fromEmail).toBe('notes@example.com');
    expect(() => parseWith(ResendUpsertSchema, { fromEmail: 'nope' })).toThrow();
  });

  it('keeps the existing key when apiKey is omitted', () => {
    expect(parseWith(ResendUpsertSchema, { fromEmail: 'notes@example.com' }).apiKey).toBeUndefined();
  });
});
