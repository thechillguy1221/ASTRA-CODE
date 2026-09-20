import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function hashPassword(password: string): string {
  if (password.length < 12) throw new Error('Password must contain at least 12 characters');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (![n, r, p].every(Number.isSafeInteger)) return false;
  try {
    const salt = Buffer.from(parts[5] ?? '', 'base64url');
    const expected = Buffer.from(parts[6] ?? '', 'base64url');
    const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
    return expected.length > 0 && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
