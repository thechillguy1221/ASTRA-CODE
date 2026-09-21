import { describe, expect, it } from 'vitest';
import { BillingService, InMemoryBillingStore } from '@astra/billing';
import { createDefaultPlanCatalog } from '@astra/plans';

describe('fixed-point credit buckets', () => {
  it('allocates earliest-expiring buckets first and releases unused reservation credits', async () => {
    const store = new InMemoryBillingStore();
    const billing = new BillingService({ store, plans: createDefaultPlanCatalog() });
    await billing.grantCredits({
      userId: 'bucket-user',
      amountCredits: '10',
      transactionType: 'SUBSCRIPTION_GRANT',
      sourceType: 'subscription_monthly',
      expiresAt: '2026-10-01T00:00:00.000Z',
      idempotencyKey: 'bucket-old',
      reason: 'old cycle',
    });
    await billing.grantCredits({
      userId: 'bucket-user',
      amountCredits: '20',
      transactionType: 'CREDIT_PURCHASE',
      sourceType: 'purchased_topup',
      expiresAt: '2027-10-01T00:00:00.000Z',
      idempotencyKey: 'bucket-new',
      reason: 'top up',
    });
    const reservation = await billing.reserveTask({
      userId: 'bucket-user',
      planId: 'BASIC',
      taskId: 'bucket-task',
      modelId: 'model',
      mode: 'BUILD',
      amountCredits: '12',
      idempotencyKey: 'bucket-reservation',
    });
    expect(reservation.bucketAllocations).toEqual([
      { bucketId: expect.any(String), amountCredits: '10' },
      { bucketId: expect.any(String), amountCredits: '2' },
    ]);
    const reservedBuckets = await billing.getBuckets('bucket-user');
    expect(reservedBuckets.map((bucket) => bucket.remainingCredits)).toEqual(['0', '18']);
    const settlement = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'bucket-settlement',
      providerActualCostUsd: '0.05',
      customerBillableCostUsd: '0.05',
    });
    expect(settlement.settledCredits).toBe('5');
    expect(settlement.releasedCredits).toBe('7');
    const afterRelease = await billing.getBuckets('bucket-user');
    expect(afterRelease.map((bucket) => bucket.remainingCredits)).toEqual(['5', '20']);
  });

  it('expires available bucket credits through an auditable compensating entry', async () => {
    const store = new InMemoryBillingStore();
    await store.grantCredits({
      userId: 'expired-user',
      amountCredits: '12',
      transactionType: 'CREDIT_PURCHASE',
      sourceType: 'purchased_topup',
      expiresAt: '2000-01-01T00:00:00.000Z',
      idempotencyKey: 'expired-grant',
      reason: 'expired test bucket',
    });

    expect((await store.getWallet('expired-user')).availableCredits).toBe('0');
    const ledger = await store.listLedger('expired-user');
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      transactionType: 'ADJUSTMENT',
      amountCredits: '12',
      availableDeltaCredits: '-12',
    });
  });
});
