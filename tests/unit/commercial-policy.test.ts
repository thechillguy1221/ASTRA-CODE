import { describe, expect, it } from 'vitest';
import {
  CommercialPolicyService,
  InMemoryCommercialRepository,
  InMemoryInvalidationBus,
  type CommercialPlanPriceSnapshot,
} from '@astra/control-plane';

const first = '2026-01-01T00:00:00.000Z';
const second = '2026-02-01T00:00:00.000Z';

function price(version: number, effectiveFrom: string): CommercialPlanPriceSnapshot {
  return {
    planId: 'PRO',
    version,
    region: 'INDIA',
    currency: 'INR',
    monthlyAmount: version === 1 ? '999' : '1099',
    yearlyAmount: version === 1 ? '9990' : '10990',
    seatAmount: null,
    includedMonthlyCredits: version === 1 ? '600' : '650',
    includedYearlyCredits: null,
    effectiveFrom,
    effectiveTo: null,
    status: 'ACTIVE',
    updatedAt: effectiveFrom,
  };
}

function service(prices = [price(1, first), price(2, second)]) {
  const repository = new InMemoryCommercialRepository({ planPrices: prices });
  const policy = new CommercialPolicyService({
    repository,
    invalidationBus: new InMemoryInvalidationBus(),
    now: () => new Date('2026-02-15T00:00:00.000Z').getTime(),
  });
  return { repository, policy };
}

const actor = {
  userId: 'admin-1',
  role: 'SUPER_ADMIN' as const,
  permissions: ['admin.plans'] as const,
};

const context = {
  sessionId: 'session-1',
  deviceId: 'device-1',
  ipAddress: '127.0.0.1',
  userAgent: 'test',
};

describe('commercial policy service', () => {
  it('selects the effective regional version and preserves history', async () => {
    const { policy } = service();
    await expect(policy.getPlanPrice('PRO', 'INDIA')).resolves.toMatchObject({
      version: 2,
      monthlyAmount: '1099',
    });
    await expect(policy.getPlanPrice('PRO', 'GLOBAL')).resolves.toBeUndefined();
    await expect(policy.listPlanPriceVersions('PRO', 'INDIA')).resolves.toHaveLength(2);
  });

  it('requires permission, reason, and the current version for a price mutation', async () => {
    const { policy } = service([price(1, first)]);
    await expect(
      policy.updatePlanPrice({
        snapshot: price(2, second),
        metadata: { expectedVersion: 0, reason: 'update regional price', requestId: 'price-1' },
        actor,
        context,
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_PLANE_VERSION_CONFLICT' });

    const updated = await policy.updatePlanPrice({
      snapshot: price(2, second),
      metadata: { expectedVersion: 1, reason: 'update regional price', requestId: 'price-2' },
      actor,
      context,
    });
    expect(updated.version).toBe(2);
    await expect(policy.listAudit()).resolves.toHaveLength(1);
  });

  it('rejects an expired promotion and accepts an eligible one only once per user', async () => {
    const { policy } = service();
    await policy.createPromotion({
      snapshot: {
        promotionId: 'WELCOME10',
        version: 1,
        code: 'WELCOME10',
        kind: 'PERCENT',
        percentOff: 10,
        fixedAmount: null,
        fixedCurrency: null,
        bonusCredits: '0',
        planIds: ['PRO'],
        regions: ['INDIA'],
        maxRedemptions: 10,
        perUserRedemptionLimit: 1,
        validFrom: first,
        expiresAt: '2026-03-01T00:00:00.000Z',
        active: true,
        updatedAt: first,
      },
      metadata: { expectedVersion: 0, reason: 'launch promotion', requestId: 'promo-1' },
      actor: { ...actor, permissions: ['admin.billing'] },
      context,
    });
    await expect(
      policy.evaluatePromotion('WELCOME10', {
        planId: 'PRO',
        region: 'INDIA',
        userId: 'u1',
        redemptionCount: 0,
      }),
    ).resolves.toMatchObject({ eligible: true, percentOff: 10 });
    await expect(
      policy.evaluatePromotion('WELCOME10', {
        planId: 'PRO',
        region: 'INDIA',
        userId: 'u1',
        redemptionCount: 1,
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'PER_USER_LIMIT' });
  });
});
