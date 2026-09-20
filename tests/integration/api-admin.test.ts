import { describe, expect, it } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';
import { buildApi } from '@lyntar/api';

describe('admin API boundary', () => {
  it('rejects ordinary users and exposes only explicit server role controls', async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({ store: authStore });
    const registration = await auth.register({
      email: 'admin-test@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Test desktop',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.0',
      },
    });
    await auth.verifyEmail(registration.verificationToken);
    const session = await auth.login({
      email: 'admin-test@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Test desktop',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.0',
      },
    });
    const app = buildApi({
      auth,
      billing: new BillingService({
        store: new InMemoryBillingStore(),
        plans: createDefaultPlanCatalog(),
      }),
    });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/admin/overview',
          headers: { authorization: `Bearer ${session.accessToken}` },
        })
      ).statusCode,
    ).toBe(403);
    const user = await authStore.getUser(registration.user.id);
    await authStore.updateUser({ ...user!, role: 'SUPER_ADMIN' });
    const overview = await app.inject({
      method: 'GET',
      url: '/v1/admin/overview',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().dataStatus).toBe('NO_LIVE_DATA');
    const users = await app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=10',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(users.statusCode).toBe(200);
    expect(users.json().total).toBe(1);
    const audit = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().entries).toEqual([]);
  });

  it('records wallet adjustments as compensating audit actions', async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({ store: authStore });
    const registration = await auth.register({
      email: 'finance-test@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Test desktop',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.0',
      },
    });
    await auth.verifyEmail(registration.verificationToken);
    await authStore.updateUser({
      ...(await authStore.getUser(registration.user.id))!,
      role: 'FINANCE',
    });
    const session = await auth.login({
      email: 'finance-test@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Test desktop',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.0',
      },
    });
    const app = buildApi({
      auth,
      billing: new BillingService({
        store: new InMemoryBillingStore(),
        plans: createDefaultPlanCatalog(),
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/admin/wallet/${registration.user.id}/adjust`,
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        amountCredits: '10.5',
        direction: 'credit',
        reason: 'Test correction',
        requestId: 'admin-test-1',
      },
    });
    expect(response.statusCode).toBe(204);
    const audit = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(audit.json().entries).toHaveLength(1);
    expect(audit.json().entries[0].action).toBe('adjust_wallet');
  });
});
