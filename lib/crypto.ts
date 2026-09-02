import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Cryptographic primitives.
 *
 *  - Credential encryption: AES-256-GCM keyed by a value derived from
 *    APP_SECRET. Ciphertext is stored in PostgreSQL; plaintext never is.
 *  - Token storage: only SHA-256 hashes of session/magic-link tokens and OTPs
 *    are persisted.
 */

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_SALT = 'ai-notetaker:v1:credential-key';
const IV_LENGTH = 12;
const CIPHER = 'aes-256-gcm';
const ENVELOPE_PREFIX = 'v1';

let cachedKey: Buffer | undefined;

function credentialKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(env().APP_SECRET, SCRYPT_SALT, SCRYPT_KEY_LENGTH);
  return cachedKey;
}

/** Encrypt a credential for storage. Returns `v1.<iv>.<tag>.<ciphertext>` base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(CIPHER, credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Decrypt a stored credential. Throws on tampering or a changed APP_SECRET. */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) {
    throw new Error('Malformed credential envelope');
  }
  const [, ivPart, tagPart, dataPart] = parts;
  const iv = Buffer.from(ivPart!, 'base64url');
  const tag = Buffer.from(tagPart!, 'base64url');
  const data = Buffer.from(dataPart!, 'base64url');
  const decipher = createDecipheriv(CIPHER, credentialKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** SHA-256 hex digest — used for session tokens, magic links and OTPs. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for hash strings. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Cryptographically strong URL-safe token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * A 6-digit OTP. Leading zeros are preserved (returned as a string) and the
 * range is uniform because `randomInt` is not modulo-biased.
 */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function isValidOtpFormat(value: string): boolean {
  return /^\d{6}$/.test(value);
}
