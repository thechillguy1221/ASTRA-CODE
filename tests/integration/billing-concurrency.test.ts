import { describe, it, expect } from 'vitest';
import { InMemoryBillingStore } from '@astra/billing';
import { BillingService } from '@astra/billing';
import { createDefaultPlanCatalog } from '@astra/plans';

function makeService() {
  const store = new InMemoryBillingStore();
  const plans = createDefaultPlanCatalog();
  const billing = new BillingService({ store, plans });
  return { store, billing, plans };
}

describe('Double-spend prevention (spec §41, §79 items 20-22)', () => {
  it('concurrent reservations are rejected when balance is insufficient (test 20)', async () => {
    const { store } = makeService();
    const userId = 'user-concurrent';

    // Grant 120 credits
    await store.grantCredits({
      userId,
      amountCredits: '120',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'initial-grant',
      reason: 'Test grant',
    });

    // First reservation of 100 — should succeed
    await store.reserveCredits({
      userId,
      taskId: 'task-A',
      amountCredits: '100',
      idempotencyKey: 'reserve-A',
    });

    // Second reservation of 100 — should fail (only 20 available)
    await expect(
      store.reserveCredits({
        userId,
        taskId: 'task-B',
        amountCredits: '100',
        idempotencyKey: 'reserve-B',
      }),
    ).rejects.toThrow();

    const wallet = await store.getWallet(userId);
    expect(wallet.availableCredits).toBe('20');
    expect(wallet.reservedCredits).toBe('100');
  });

  it('two identical reservation keys are idempotent — no double reservation (test 21)', async () => {
    const { store } = makeService();
    const userId = 'user-idem-reserve';

    await store.grantCredits({
      userId,
      amountCredits: '50',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'grant-idem',
      reason: 'Test grant',
    });

    const key = 'reserve-idem-key';
    await store.reserveCredits({
      userId,
      taskId: 'task-X',
      amountCredits: '30',
      idempotencyKey: key,
    });
    await store.reserveCredits({
      userId,
      taskId: 'task-X',
      amountCredits: '30',
      idempotencyKey: key,
    });

    const wallet = await store.getWallet(userId);
    expect(wallet.availableCredits).toBe('20');
    expect(wallet.reservedCredits).toBe('30'); // Only reserved once
  });

  it('failed inference releases unused reservation (test 22)', async () => {
    const { store } = makeService();
    const userId = 'user-release';

    await store.grantCredits({
      userId,
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'grant-release-test',
      reason: 'Test grant',
    });

    await store.reserveCredits({
      userId,
      taskId: 'task-failed',
      amountCredits: '40',
      idempotencyKey: 'reserve-failed',
    });

    const wallet = await store.getWallet(userId);
    expect(wallet.availableCredits).toBe('60');
    expect(wallet.reservedCredits).toBe('40');

    // Find reservation by idempotency key effect: settle with 0 actual cost
    const reservations = await store.listLedger(userId);
    const reserveEntry = reservations.find((e) => e.transactionType === 'USAGE_RESERVE');
    expect(reserveEntry).toBeDefined();

    // For the in-memory store, find reservation by the reserve ledger entry metadata
    // Settle with 0 actual cost (inference failed before any provider billing)
    const store2 = new InMemoryBillingStore();
    await store2.grantCredits({
      userId: 'u3',
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'g3',
      reason: 'g',
    });
    const res = await store2.reserveCredits({
      userId: 'u3',
      taskId: 'task-res',
      amountCredits: '40',
      idempotencyKey: 'res-key-3',
    });

    const settlement = await store2.settleCredits({
      reservationId: res.reservationId,
      idempotencyKey: 'settle-3',
      providerActualCostUsd: '0',
      customerBillableCostUsd: '0',
    });

    expect(settlement.settledCredits).toBe('0');
    expect(settlement.releasedCredits).toBe('40');

    const finalWallet = await store2.getWallet('u3');
    expect(finalWallet.availableCredits).toBe('100'); // All credits returned
    expect(finalWallet.reservedCredits).toBe('0');
  });

  it('actual provider cost settles correctly (test 23)', async () => {
    const store = new InMemoryBillingStore();
    await store.grantCredits({
      userId: 'u-settle',
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'gs',
      reason: 'g',
    });
    const res = await store.reserveCredits({
      userId: 'u-settle',
      taskId: 'task-settle',
      amountCredits: '40',
      idempotencyKey: 'rs',
    });

    // $0.02734 USD = 27.34 credits
    const settlement = await store.settleCredits({
      reservationId: res.reservationId,
      idempotencyKey: 'ss',
      providerActualCostUsd: '0.02734',
      customerBillableCostUsd: '0.02734',
    });

    expect(parseFloat(settlement.settledCredits)).toBeGreaterThan(0);
    expect(parseFloat(settlement.releasedCredits)).toBeGreaterThan(0);
    expect(parseFloat(settlement.releasedCredits)).toBeLessThan(40);

    const wallet = await store.getWallet('u-settle');
    expect(wallet.reservedCredits).toBe('0');
    expect(parseFloat(wallet.consumedCredits)).toBeGreaterThan(0);
  });
});

describe('Wallet ledger immutability (spec §79 item 37)', () => {
  it('ledger entries are append-only — no modification supported', async () => {
    const store = new InMemoryBillingStore();
    await store.grantCredits({
      userId: 'u-ledger',
      amountCredits: '50',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'lg',
      reason: 'g',
    });
    const ledger1 = await store.listLedger('u-ledger');
    expect(ledger1).toHaveLength(1);

    // Grant again with different key
    await store.grantCredits({
      userId: 'u-ledger',
      amountCredits: '25',
      transactionType: 'ADJUSTMENT',
      idempotencyKey: 'lg2',
      reason: 'g2',
    });
    const ledger2 = await store.listLedger('u-ledger');
    expect(ledger2).toHaveLength(2);

    // Original entry must not have changed
    expect(ledger2[0]).toEqual(ledger1[0]);
  });
});
