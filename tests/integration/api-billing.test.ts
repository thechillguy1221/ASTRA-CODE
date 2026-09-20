import { describe, expect, it } from 'vitest';
import { buildApi } from '@lyntar/api';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';

describe('billing API', () => {
  it('returns server plans and reserves credits using the authenticated plan', async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      now: () => new Date('2026-09-20T00:00:00.000Z'),
    });
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const app = buildApi({
      auth,
      billing,
      plans: createDefaultPlanCatalog(),
      exposeDevelopmentTokens: true,
    });
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'wallet@example.com',
        password: 'correct horse battery staple',
        device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: registration.json().verificationToken },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'wallet@example.com',
        password: 'correct horse battery staple',
        device: { label: 'Windows', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
      },
    });
    const accessToken = login.json().accessToken as string;
    const userId = login.json().user.id as string;
    expect(userId).toBeTruthy();
    const plans = await app.inject({ method: 'GET', url: '/v1/plans' });
    expect(plans.statusCode).toBe(200);
    expect(
      plans.json().plans.find((plan: { id: string }) => plan.id === 'STUDENT').monthlyCredits,
    ).toBe('500');
    const reservation = await app.inject({
      method: 'POST',
      url: '/v1/billing/reservations',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        taskId: 'task-wallet',
        modelId: 'approved-core',
        mode: 'BUILD',
        amountCredits: '10',
        idempotencyKey: 'wallet-reservation',
      },
    });
    expect(reservation.statusCode).toBe(201);
    const wallet = await app.inject({
      method: 'GET',
      url: '/v1/wallet',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(wallet.json().wallet.availableCredits).toBe('40');
    expect(wallet.json().wallet.reservedCredits).toBe('10');
    const settlement = await app.inject({
      method: 'POST',
      url: '/v1/billing/settlements',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        reservationId: reservation.json().reservation.reservationId,
        providerActualCostUsd: '0.005',
        customerBillableCostUsd: '0.005',
        idempotencyKey: 'wallet-settlement',
      },
    });
    expect(settlement.statusCode).toBe(200);
    const settledWallet = await app.inject({
      method: 'GET',
      url: '/v1/wallet',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(settledWallet.json().wallet.availableCredits).toBe('45');
    expect(settledWallet.json().wallet.reservedCredits).toBe('0');
    expect(settledWallet.json().wallet.consumedCredits).toBe('5');
  });

  it('does not expose wallet data without a session', async () => {
    const app = buildApi({
      billing: new BillingService({
        store: new InMemoryBillingStore(),
        plans: createDefaultPlanCatalog(),
      }),
      plans: createDefaultPlanCatalog(),
    });
    const response = await app.inject({ method: 'GET', url: '/v1/wallet' });
    expect(response.statusCode).toBe(401);
  });
});
