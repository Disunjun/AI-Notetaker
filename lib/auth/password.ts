import argon2, { type HashOptions } from 'argon2';

/**
 * Admin password hashing.
 *
 * Argon2id is the mandated baseline. Parameters follow the OWASP
 * recommendation (19 MiB memory, 2 iterations, parallelism 1) which is safe for
 * a login path that is additionally rate limited.
 */
export const ARGON2_OPTIONS: HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, { ...ARGON2_OPTIONS, raw: false });
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // A malformed stored hash must never throw out of the login path.
    return false;
  }
}
