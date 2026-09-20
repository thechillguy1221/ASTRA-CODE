import { describe, expect, it } from 'vitest';
import { ensureSuperAdmin, InMemoryAuthStore } from '@lyntar/auth';

const hash = '$scrypt$16384$8$1$c2FsdA$dmFsaWQ';

describe('Super Admin bootstrap', () => {
  it('creates or updates only from a password hash, never a plaintext password', async () => {
    const store = new InMemoryAuthStore();
    expect(
      await ensureSuperAdmin({ store, email: 'ADMIN@example.com', passwordVerifier: hash }),
    ).toBe('created');
    const user = await store.findUserByEmail('admin@example.com');
    expect(user?.role).toBe('SUPER_ADMIN');
    expect(user?.passwordVerifier).toBe(hash);
    expect(
      await ensureSuperAdmin({ store, email: 'ADMIN@example.com', passwordVerifier: hash }),
    ).toBe('skipped');
    await expect(
      ensureSuperAdmin({ store, email: 'admin@example.com', passwordVerifier: 'plaintext' }),
    ).rejects.toThrow();
  });
});
