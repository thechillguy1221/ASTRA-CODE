import { describe, expect, it } from 'vitest';
import {
  BillingError,
  InMemoryOrganizationBillingStore,
  OrganizationBillingService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';

function service(): OrganizationBillingService {
  return new OrganizationBillingService({
    store: new InMemoryOrganizationBillingStore(),
    plans: createDefaultPlanCatalog(),
  });
}

describe('organization pooled billing', () => {
  it('allows only one concurrent reservation when the pooled wallet cannot fund both', async () => {
    const billing = service();
    await billing.grantCredits({
      organizationId: 'org-team',
      actorUserId: 'owner',
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'cycle:org-team:1',
      reason: 'Team monthly credits',
    });

    const results = await Promise.allSettled([
      billing.reserveTask({
        organizationId: 'org-team',
        actorUserId: 'member-a',
        roomId: 'room-a',
        planId: 'TEAM',
        taskId: 'task-a',
        modelId: 'model-a',
        mode: 'BUILD',
        amountCredits: '70',
        idempotencyKey: 'reserve:task-a',
        activeJobs: 0,
        activeSeats: 2,
      }),
      billing.reserveTask({
        organizationId: 'org-team',
        actorUserId: 'member-b',
        roomId: 'room-a',
        planId: 'TEAM',
        taskId: 'task-b',
        modelId: 'model-a',
        mode: 'BUILD',
        amountCredits: '70',
        idempotencyKey: 'reserve:task-b',
        activeJobs: 0,
        activeSeats: 2,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
    });
    await expect(billing.getWallet('org-team')).resolves.toMatchObject({
      availableCredits: '30',
      reservedCredits: '70',
      consumedCredits: '0',
    });
  });

  it('settles exact pooled usage, releases unused credits, and attributes the member and Room', async () => {
    const billing = service();
    await billing.grantCredits({
      organizationId: 'org-business',
      actorUserId: 'owner',
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'cycle:org-business:1',
      reason: 'Business monthly credits',
    });
    const reservation = await billing.reserveTask({
      organizationId: 'org-business',
      actorUserId: 'member',
      roomId: 'room-1',
      planId: 'BUSINESS',
      taskId: 'task-1',
      modelId: 'model-a',
      mode: 'BUILD',
      amountCredits: '80',
      idempotencyKey: 'reserve:task-1',
      activeJobs: 0,
      activeSeats: 1,
    });

    const settlement = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'settle:task-1',
      providerActualCostUsd: '0.37826',
      customerBillableCostUsd: '0.37826',
    });

    expect(settlement).toMatchObject({
      organizationId: 'org-business',
      actorUserId: 'member',
      roomId: 'room-1',
      providerActualCostUsd: '0.37826',
      customerBillableCostUsd: '0.37826',
      absorbedCostUsd: '0',
      reservedCredits: '80',
      settledCredits: '37.826',
      releasedCredits: '42.174',
    });
    await expect(billing.getWallet('org-business')).resolves.toMatchObject({
      availableCredits: '62.174',
      reservedCredits: '0',
      consumedCredits: '37.826',
    });
  });

  it('keeps provider cost and customer cost separate without allowing a duplicate settlement', async () => {
    const billing = service();
    await billing.grantCredits({
      organizationId: 'org-business',
      actorUserId: 'owner',
      amountCredits: '100',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'cycle:org-business:2',
      reason: 'Business monthly credits',
    });
    const reservation = await billing.reserveTask({
      organizationId: 'org-business',
      actorUserId: 'member',
      planId: 'BUSINESS',
      taskId: 'task-2',
      modelId: 'model-a',
      mode: 'BUILD',
      amountCredits: '20',
      idempotencyKey: 'reserve:task-2',
    });

    const first = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'settle:task-2',
      providerActualCostUsd: '0.1',
      customerBillableCostUsd: '0.05',
    });
    const duplicate = await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'settle:task-2',
      providerActualCostUsd: '0.1',
      customerBillableCostUsd: '0.05',
    });

    expect(duplicate).toEqual(first);
    expect(first.absorbedCostUsd).toBe('0.05');
    await expect(
      billing.settleTask({
        reservationId: reservation.reservationId,
        idempotencyKey: 'settle:task-2',
        providerActualCostUsd: '0.2',
        customerBillableCostUsd: '0.05',
      }),
    ).rejects.toMatchObject<BillingError>({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects a reservation that exceeds the organization plan task ceiling', async () => {
    const billing = service();
    await billing.grantCredits({
      organizationId: 'org-team',
      actorUserId: 'owner',
      amountCredits: '2000',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'cycle:org-team:3',
      reason: 'Team monthly credits',
    });

    await expect(
      billing.reserveTask({
        organizationId: 'org-team',
        actorUserId: 'member',
        planId: 'TEAM',
        taskId: 'task-expensive',
        modelId: 'model-a',
        mode: 'BUILD',
        amountCredits: '1200.0000001',
        idempotencyKey: 'reserve:too-expensive',
      }),
    ).rejects.toMatchObject({ name: 'PlanEntitlementError' });
  });

  it('rolls unused pooled subscription credits into one additional billing cycle idempotently', async () => {
    const billing = service();
    await billing.grantCredits({
      organizationId: 'org-team',
      actorUserId: 'owner',
      amountCredits: '6000',
      transactionType: 'SUBSCRIPTION_GRANT',
      idempotencyKey: 'cycle:org-team:old',
      reason: 'Team previous period',
      planCycle: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-10-01T00:00:00.000Z',
    });
    const first = await billing.rolloverSubscriptionCredits({
      organizationId: 'org-team',
      actorUserId: 'owner',
      monthlyAllocation: '6000',
      periodStart: '2026-09-01T00:00:00.000Z',
      newExpiresAt: '2026-10-01T00:00:00.000Z',
      idempotencyKey: 'rollover:org-team:2026-09',
      referenceId: 'sub-team',
    });
    const duplicate = await billing.rolloverSubscriptionCredits({
      organizationId: 'org-team',
      actorUserId: 'owner',
      monthlyAllocation: '6000',
      periodStart: '2026-09-01T00:00:00.000Z',
      newExpiresAt: '2026-10-01T00:00:00.000Z',
      idempotencyKey: 'rollover:org-team:2026-09',
      referenceId: 'sub-team',
    });

    expect(first).toBe('6000');
    expect(duplicate).toBe('6000');
    expect((await billing.getWallet('org-team')).availableCredits).toBe('6000');
    expect(
      (await billing.getBuckets('org-team')).filter((bucket) => bucket.remainingCredits === '6000'),
    ).toHaveLength(1);
  });
});
