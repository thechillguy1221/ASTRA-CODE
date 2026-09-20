import { randomUUID } from 'node:crypto';
import type { AuthStore, StoredUser } from './ports.js';

export function isSupportedPasswordHash(value: string): boolean {
  return /^\$scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(value);
}

export async function ensureSuperAdmin(input: {
  store: AuthStore;
  email?: string;
  passwordVerifier?: string;
  now?: () => Date;
}): Promise<'created' | 'updated' | 'skipped'> {
  if (!input.email || !input.passwordVerifier) return 'skipped';
  if (!isSupportedPasswordHash(input.passwordVerifier))
    throw new Error('Super Admin password hash format is unsupported');
  const email = input.email.trim().toLowerCase();
  const now = (input.now?.() ?? new Date()).toISOString();
  const current = await input.store.findUserByEmail(email);
  if (!current) {
    const user: StoredUser = {
      id: randomUUID(),
      email,
      passwordVerifier: input.passwordVerifier,
      emailVerifiedAt: now,
      status: 'ACTIVE',
      role: 'SUPER_ADMIN',
      planId: 'FREE',
      createdAt: now,
    };
    await input.store.saveUser(user);
    return 'created';
  }
  if (current.role === 'SUPER_ADMIN' && current.passwordVerifier === input.passwordVerifier)
    return 'skipped';
  await input.store.updateUser({
    ...current,
    role: 'SUPER_ADMIN',
    passwordVerifier: input.passwordVerifier,
    emailVerifiedAt: current.emailVerifiedAt ?? now,
  });
  return 'updated';
}
