import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateOtp,
  hashToken,
  isValidOtpFormat,
  randomToken,
  safeEqual,
} from '@/lib/crypto';

describe('credential encryption (AES-256-GCM keyed by APP_SECRET)', () => {
  it('round-trips a credential', () => {
    const plaintext = 'sk-abcdef1234567890abcdef';
    const envelope = encryptSecret(plaintext);
    expect(envelope).not.toBe(plaintext);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(decryptSecret(envelope)).toBe(plaintext);
  });

  it('never stores the plaintext inside the envelope', () => {
    const plaintext = 'super-secret-key-value';
    const envelope = encryptSecret(plaintext);
    expect(envelope).not.toContain(plaintext);
    // Neither base64 nor base64url encodings of the secret may appear.
    expect(envelope).not.toContain(Buffer.from(plaintext).toString('base64'));
    expect(envelope).not.toContain(Buffer.from(plaintext).toString('base64url'));
  });

  it('produces a different envelope each time (random IV)', () => {
    const plaintext = 'same-input';
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it('rejects a tampered envelope', () => {
    const envelope = encryptSecret('payload');
    const parts = envelope.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}AA`].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => decryptSecret('not-an-envelope')).toThrow();
    expect(() => decryptSecret('v2.aaa.bbb.ccc')).toThrow();
  });
});

describe('token hashing', () => {
  it('is stable and hex-encoded', () => {
    const token = randomToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
  });

  it('does not leak the token in the hash', () => {
    const token = randomToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it('compares safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('OTP generation', () => {
  it('always produces exactly 6 digits, preserving leading zeros', () => {
    for (let i = 0; i < 500; i += 1) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{6}$/);
      expect(isValidOtpFormat(code)).toBe(true);
    }
  });

  it('rejects malformed OTP strings', () => {
    expect(isValidOtpFormat('12345')).toBe(false);
    expect(isValidOtpFormat('1234567')).toBe(false);
    expect(isValidOtpFormat('12345a')).toBe(false);
    expect(isValidOtpFormat('')).toBe(false);
  });

  it('is not constant across calls', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(150);
  });
});

describe('random tokens', () => {
  it('are URL-safe and unique', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
