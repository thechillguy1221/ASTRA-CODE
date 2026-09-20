import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SecureCredentialStore } from '../../apps/desktop/electron/credentials.js';
import type { AuthSessionResult } from '@lyntar/contracts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('desktop credential storage', () => {
  it('stores session material only through the OS-encryption adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lyntar-credentials-'));
    roots.push(root);
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) =>
        Buffer.from(Buffer.from(value, 'utf8').toString('base64'), 'utf8'),
      decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString('utf8'),
    };
    const session: AuthSessionResult = {
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@example.test',
        emailVerifiedAt: new Date().toISOString(),
        status: 'ACTIVE',
        role: 'USER',
        planId: 'FREE',
        createdAt: new Date().toISOString(),
      },
      deviceSessionId: '22222222-2222-4222-8222-222222222222',
      accessToken: 'private-access-token',
      refreshToken: 'private-refresh-token',
      accessExpiresAt: new Date(Date.now() + 10_000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 20_000).toISOString(),
    };
    const store = new SecureCredentialStore({ userDataPath: root, safeStorage });
    await store.set(session);
    expect((await readFile(join(root, 'lyntar-session.bin'), 'utf8')).toLowerCase()).not.toContain(
      'private-access-token',
    );
    expect(await store.get()).toEqual(session);
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
