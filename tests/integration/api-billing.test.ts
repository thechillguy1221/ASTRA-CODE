import { describe, expect, it } from 'vitest';
import { buildApi } from '@lyntar/api';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';
import { createMemoryReceiptStore } from '@lyntar/db';

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
    const receipts = createMemoryReceiptStore();
    const app = buildApi({
      auth,
      billing,
      plans: createDefaultPlanCatalog(),
      receipts,
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
      plans.json().plans.find((plan: { id: string }) => plan.id === 'BASIC').monthlyCredits,
    ).toBe('300');
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
    // Free plan grants 25 credits upon signup; 25 - 10 reserved = 15 available
    expect(wallet.json().wallet.availableCredits).toBe('15');
    expect(wallet.json().wallet.reservedCredits).toBe('10');
    await receipts.save({
      requestId: 'billing-request-1',
      gatewayRequestId: 'gateway-billing-1',
      taskId: 'task-wallet',
      agentTaskId: 'task-wallet',
      agentSessionId: 'session-wallet',
      modelId: 'approved-core',
      gatewayModelId: 'test/core',
      provider: 'test',
      providerRoute: 'test/core',
      inputTokens: 10,
      outputTokens: 5,
      cacheTokens: null,
      actualCostUsd: 0.005,
      receivedAt: '2026-09-20T00:00:00.000Z',
    });
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
    // $0.005 USD = 0.5 credits settled; 9.5 credits released; 15 + 9.5 = 24.5 available
    expect(settledWallet.json().wallet.availableCredits).toBe('24.5');
    expect(settledWallet.json().wallet.reservedCredits).toBe('0');
    expect(settledWallet.json().wallet.consumedCredits).toBe('0.5');
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
