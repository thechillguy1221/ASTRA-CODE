import { describe, expect, it } from 'vitest';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import {
  CommercialPolicyService,
  InMemoryCommercialRepository,
  InMemoryInvalidationBus,
  type CommercialPlanPriceSnapshot,
  type TopUpPackageSnapshot,
} from '@astra/control-plane';
import { createDefaultPlanCatalog } from '@astra/plans';
import { buildApi } from '@astra/api';

const now = '2026-01-01T00:00:00.000Z';

function planPrice(planId: string): CommercialPlanPriceSnapshot {
  const plan = createDefaultPlanCatalog().get(planId);
  return {
    planId,
    version: 1,
    region: 'INDIA',
    currency: 'INR',
    monthlyAmount: plan.monthlyPriceInr,
    yearlyAmount: null,
    seatAmount: null,
    includedMonthlyCredits: plan.monthlyCredits,
    includedYearlyCredits: null,
    effectiveFrom: now,
    effectiveTo: null,
    status: 'ACTIVE',
    updatedAt: now,
  };
}

const topUp: TopUpPackageSnapshot = {
  packageId: 'TOPUP_100',
  version: 1,
  displayName: '100 credits',
  credits: '100',
  bonusCredits: '0',
  validityDays: 365,
  prices: {
    INDIA: { currency: 'INR', amount: '200', taxIncluded: true },
    GLOBAL: { currency: 'USD', amount: '1.6', taxIncluded: true },
  },
  active: true,
  displayOrder: 100,
  purchaseLimit: null,
  effectiveFrom: now,
  effectiveTo: null,
  updatedAt: now,
};

async function sessionFor(role: 'USER' | 'FINANCE' | 'SUPER_ADMIN') {
  const store = new InMemoryAuthStore();
  const auth = new AuthService({ store });
  const registration = await auth.register({
    email: `${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'correct horse battery staple',
    device: { label: 'Test', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
  });
  await auth.verifyEmail(registration.verificationToken);
  await store.updateUser({ ...(await store.getUser(registration.user.id))!, role });
  const session = await auth.login({
    email: registration.user.email,
    password: 'correct horse battery staple',
    device: { label: 'Test', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
  });
  return { auth, token: session.accessToken };
}

function commercial() {
  const repository = new InMemoryCommercialRepository({
    planPrices: createDefaultPlanCatalog()
      .list()
      .flatMap((plan) => [
        planPrice(plan.id),
        {
          ...planPrice(plan.id),
          region: 'GLOBAL',
          currency: 'USD',
          monthlyAmount: plan.monthlyPriceUsd ?? '0',
        },
      ]),
    topUps: [topUp],
  });
  return new CommercialPolicyService({
    repository,
    invalidationBus: new InMemoryInvalidationBus(),
    now: () => new Date(now).getTime(),
  });
}

describe('commercial control-plane API', () => {
  it('serves regional pricing from the commercial policy service', async () => {
    const identity = await sessionFor('USER');
    const app = buildApi({ auth: identity.auth, commercial: commercial() });
    const response = await app.inject({ method: 'GET', url: '/v1/pricing?country=IN' });
    expect(response.statusCode).toBe(200);
    expect(response.json().policy.source).toBe('control_plane');
    expect(
      response.json().plans.find((plan: { id: string }) => plan.id === 'PRO').regionalPrice,
    ).toMatchObject({
      amount: '999',
      currency: 'INR',
    });
    expect(response.json().creditPacks[0]).toMatchObject({
      packageId: 'TOPUP_100',
      price: { amount: '200' },
    });
  });

  it('enforces commercial permissions and version protection on admin price writes', async () => {
    const identity = await sessionFor('USER');
    const app = buildApi({ auth: identity.auth, commercial: commercial() });
    const denied = await app.inject({
      method: 'PUT',
      url: '/v1/admin/commercial/plan-prices/PRO/INDIA',
      headers: { authorization: `Bearer ${identity.token}` },
      payload: {
        snapshot: { ...planPrice('PRO'), version: 2, monthlyAmount: '1001' },
        metadata: { expectedVersion: 1, reason: 'regional test price', requestId: 'price-api-1' },
      },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('fails closed when commercial billing has no authoritative model pricing snapshot', async () => {
    const identity = await sessionFor('USER');
    const app = buildApi({ auth: identity.auth, commercial: commercial() });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/billing/reservations',
      headers: { authorization: `Bearer ${identity.token}` },
      payload: {
        taskId: 'unpriced-task',
        modelId: 'approved-core',
        mode: 'BUILD',
        amountCredits: '10',
        idempotencyKey: 'unpriced-reservation',
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'MODEL_PRICING_UNAVAILABLE' });
  });
});
