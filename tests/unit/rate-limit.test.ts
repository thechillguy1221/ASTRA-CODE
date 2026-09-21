import { describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore, hashRateLimitIdentity } from '@astra/auth';

describe('shared rate-limit contract', () => {
  it('enforces a fixed window and resets after the window', async () => {
    const store = new InMemoryRateLimitStore();
    const first = await store.consume('login:one', { limit: 2, windowMs: 1000, now: 1000 });
    const second = await store.consume('login:one', { limit: 2, windowMs: 1000, now: 1100 });
    const blocked = await store.consume('login:one', { limit: 2, windowMs: 1000, now: 1200 });
    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800);
    await expect(
      store.consume('login:one', { limit: 2, windowMs: 1000, now: 2000 }),
    ).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it('hashes identities so raw email or IP values are not used as shared keys', () => {
    const hashed = hashRateLimitIdentity(' User@example.test ');
    expect(hashed).toMatch(/^[a-f0-9]{64}$/);
    expect(hashed).toBe(hashRateLimitIdentity('user@example.test'));
    expect(hashed).not.toContain('@');
  });
});
