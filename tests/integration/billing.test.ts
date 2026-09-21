import { describe, expect, it } from 'vitest';
import { BillingError, BillingService, InMemoryBillingStore } from '@astra/billing';
import { createDefaultPlanCatalog } from '@astra/plans';

describe('wallet reservation and settlement', () => {
  it('reserves, settles exact usage, and releases the unused reservation', async () => {
    const store = new InMemoryBillingStore();
    const billing = new BillingService({ store, plans: createDefaultPlanCatalog() });
    await billing.grantCredits({
      userId: 'user-1',
      amountCredits: '100',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'seed-1',
      reason: 'test seed',
    });
    const reservation = await billing.reserveTask({
      userId: 'user-1',
      planId: 'STUDENT',
      taskId: 'task-1',
      modelId: 'approved-core',
      mode: 'BUILD',
      amountCredits: '100',
      idempotencyKey: 'reserve-1',
    });
    const settlement = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'settle-1',
      providerActualCostUsd: '0.037826',
      customerBillableCostUsd: '0.037826',
    });
    expect(settlement.settledCredits).toBe('3.7826');
    expect(settlement.releasedCredits).toBe('96.2174');
    expect(settlement.absorbedCostUsd).toBe('0');
    expect((await billing.getWallet('user-1')).availableCredits).toBe('96.2174');
    expect((await billing.getWallet('user-1')).reservedCredits).toBe('0');
    expect((await billing.getWallet('user-1')).consumedCredits).toBe('3.7826');
  });

  it('keeps provider cost separate when a Astra failure absorbs the cost', async () => {
    const store = new InMemoryBillingStore();
    const billing = new BillingService({ store, plans: createDefaultPlanCatalog() });
    await billing.grantCredits({
      userId: 'user-2',
      amountCredits: '20',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'seed-2',
      reason: 'test seed',
    });
    const reservation = await billing.reserveTask({
      userId: 'user-2',
      planId: 'STUDENT',
      taskId: 'task-2',
      modelId: 'approved-core',
      mode: 'BUILD',
      amountCredits: '10',
      idempotencyKey: 'reserve-2',
    });
    const settlement = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'settle-2',
      providerActualCostUsd: '0.050000',
      customerBillableCostUsd: '0',
    });
    expect(settlement.settledCredits).toBe('0');
    expect(settlement.releasedCredits).toBe('10');
    expect(settlement.absorbedCostUsd).toBe('0.05');
  });

  it('allows only one of two simultaneous 70-credit reservations from a 100-credit wallet', async () => {
    const store = new InMemoryBillingStore();
    const billing = new BillingService({ store, plans: createDefaultPlanCatalog() });
    await billing.grantCredits({
      userId: 'user-3',
      amountCredits: '100',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'seed-3',
      reason: 'test seed',
    });
    const results = await Promise.allSettled([
      billing.reserveTask({
        userId: 'user-3',
        planId: 'STUDENT',
        taskId: 'task-a',
        modelId: 'approved-core',
        mode: 'BUILD',
        amountCredits: '70',
        idempotencyKey: 'reserve-a',
      }),
      billing.reserveTask({
        userId: 'user-3',
        planId: 'STUDENT',
        taskId: 'task-b',
        modelId: 'approved-core',
        mode: 'BUILD',
        amountCredits: '70',
        idempotencyKey: 'reserve-b',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((result) => result.status === 'rejected')
        .map((result) => (result as PromiseRejectedResult).reason),
    ).toSatisfy((errors: unknown[]) =>
      errors.some(
        (error) => error instanceof BillingError && error.code === 'INSUFFICIENT_CREDITS',
      ),
    );
    expect((await billing.getWallet('user-3')).availableCredits).toBe('30');
  });

  it('makes grant, reservation, and settlement idempotent', async () => {
    const store = new InMemoryBillingStore();
    const billing = new BillingService({ store, plans: createDefaultPlanCatalog() });
    await billing.grantCredits({
      userId: 'user-4',
      amountCredits: '10',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'same-grant',
      reason: 'test seed',
    });
    await billing.grantCredits({
      userId: 'user-4',
      amountCredits: '10',
      transactionType: 'PROMO_CREDIT',
      idempotencyKey: 'same-grant',
      reason: 'replay',
    });
    const reservation = await billing.reserveTask({
      userId: 'user-4',
      planId: 'STUDENT',
      taskId: 'task-4',
      modelId: 'approved-core',
      mode: 'BUILD',
      amountCredits: '5',
      idempotencyKey: 'same-reservation',
    });
    const duplicate = await billing.reserveTask({
      userId: 'user-4',
      planId: 'STUDENT',
      taskId: 'task-4',
      modelId: 'approved-core',
      mode: 'BUILD',
      amountCredits: '5',
      idempotencyKey: 'same-reservation',
    });
    expect(duplicate.reservationId).toBe(reservation.reservationId);
    const first = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'same-settlement',
      providerActualCostUsd: '0.001000',
      customerBillableCostUsd: '0.001000',
    });
    const replay = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'same-settlement',
      providerActualCostUsd: '0.001000',
      customerBillableCostUsd: '0.001000',
    });
    expect(replay.settlementId).toBe(first.settlementId);
    expect((await billing.getWallet('user-4')).availableCredits).toBe('9.9');
  });
});

describe('Wallet ledger append-only (spec §79 item 37)', () => {
  it('ledger only grows — entries cannot be removed', async () => {
    const store = new InMemoryBillingStore();
    const userId = 'user-append-only';

    await store.grantCredits({
      userId,
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'l1',
      reason: 'g',
    });
    const before = await store.listLedger(userId);
    expect(before).toHaveLength(1);

    await store.grantCredits({
      userId,
      amountCredits: '50',
      transactionType: 'CREDIT_PURCHASE',
      idempotencyKey: 'l2',
      reason: 'g2',
    });
    const after = await store.listLedger(userId);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]); // First entry unchanged
  });
});
