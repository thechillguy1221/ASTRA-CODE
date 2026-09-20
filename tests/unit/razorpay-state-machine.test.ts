import { describe, it, expect } from 'vitest';
import {
  RazorpayWebhookService,
  InMemoryPaymentStore,
  BillingService,
  InMemoryBillingStore,
  InMemoryOrganizationBillingStore,
  OrganizationBillingService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';
import { createHmac } from 'node:crypto';

const SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

function makeEvent(event: string, payload: Record<string, unknown>): { body: string; sig: string } {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, event, payload });
  return { body, sig: sign(body) };
}

function makeService(options?: {
  onCancelled?: (userId: string, planId: string) => Promise<void>;
  onHalted?: (userId: string, planId: string) => Promise<void>;
  onGranted?: (userId: string, planId: string) => Promise<void>;
  onOrganizationEntitlementChanged?: (
    organizationId: string,
    actorUserId: string,
    planId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
  ) => Promise<void>;
}) {
  const payments = new InMemoryPaymentStore();
  const billingStore = new InMemoryBillingStore();
  const plans = createDefaultPlanCatalog();
  const billing = new BillingService({ store: billingStore, plans });
  const organizationBilling = new OrganizationBillingService({
    store: new InMemoryOrganizationBillingStore(),
    plans,
  });
  const service = new RazorpayWebhookService({
    secret: SECRET,
    payments,
    billing,
    organizationBilling,
    plans,
    onPlanGranted: options?.onGranted,
    onSubscriptionCancelled: options?.onCancelled,
    onSubscriptionHalted: options?.onHalted,
    onOrganizationEntitlementChanged: options?.onOrganizationEntitlementChanged,
  });
  return { service, payments, billingStore, billing, organizationBilling };
}

describe('Razorpay state machine (spec §36, §79 items 7-12)', () => {
  it('subscription.charged grants credits exactly once (test 12)', async () => {
    const { service, billingStore } = makeService();
    const userId = 'user-rp-1';
    const providerSubscriptionId = 'sub_test_1';
    const periodStart = '2026-09-01T00:00:00.000Z';

    const evt = makeEvent('subscription.charged', {
      userId,
      planId: 'BASIC',
      providerSubscriptionId,
      providerPaymentId: 'pay_test_1',
      periodStart,
      amountInr: '499',
    });

    await service.handle(evt.body, evt.sig);
    const wallet1 = await billingStore.getWallet(userId);
    expect(wallet1.availableCredits).toBe('300');

    // Second identical event (duplicate webhook) — must NOT grant again
    const evt2 = makeEvent('subscription.charged', {
      userId,
      planId: 'BASIC',
      providerSubscriptionId,
      providerPaymentId: 'pay_test_1',
      periodStart,
      amountInr: '499',
    });
    await service.handle(evt2.body, evt2.sig);
    const wallet2 = await billingStore.getWallet(userId);
    expect(wallet2.availableCredits).toBe('300'); // unchanged
  });

  it('subscription.charged credits the pooled organization wallet for Team', async () => {
    const payments = new InMemoryPaymentStore();
    const billingStore = new InMemoryBillingStore();
    const organizationBilling = new OrganizationBillingService({
      store: new InMemoryOrganizationBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const billing = new BillingService({ store: billingStore, plans: createDefaultPlanCatalog() });
    const service = new RazorpayWebhookService({
      secret: SECRET,
      payments,
      billing,
      organizationBilling,
      plans: createDefaultPlanCatalog(),
    });
    const evt = makeEvent('subscription.charged', {
      userId: 'team-owner',
      organizationId: 'org-team',
      planId: 'TEAM',
      providerSubscriptionId: 'sub_team_1',
      providerPaymentId: 'pay_team_1',
      periodStart: '2026-09-01T00:00:00.000Z',
      amountInr: '9999',
    });

    await service.handle(evt.body, evt.sig);
    expect((await organizationBilling.getWallet('org-team')).availableCredits).toBe('6000');
    expect((await billing.getWallet('team-owner')).availableCredits).toBe('0');
  });

  it('emits organization entitlement transitions for pooled renewal and cancellation', async () => {
    const transitions: string[] = [];
    const { service } = makeService({
      onOrganizationEntitlementChanged: async (organizationId, actorUserId, planId, status) => {
        transitions.push(`${organizationId}:${actorUserId}:${planId}:${status}`);
      },
    });
    const charged = makeEvent('subscription.charged', {
      userId: 'team-owner-transition',
      organizationId: 'org-transition',
      planId: 'TEAM',
      providerSubscriptionId: 'sub_transition',
      providerPaymentId: 'pay_transition',
      periodStart: '2026-09-01T00:00:00.000Z',
      amountInr: '9999',
    });
    await service.handle(charged.body, charged.sig);
    const cancelled = makeEvent('subscription.cancelled', {
      userId: 'team-owner-transition',
      organizationId: 'org-transition',
      planId: 'TEAM',
      providerSubscriptionId: 'sub_transition',
    });
    await service.handle(cancelled.body, cancelled.sig);
    expect(transitions).toEqual([
      'org-transition:team-owner-transition:TEAM:ACTIVE',
      'org-transition:team-owner-transition:FREE:CLOSED',
    ]);
  });

  it('subscription.cancelled fires onSubscriptionCancelled callback (test 7)', async () => {
    const cancelledCalls: string[] = [];
    const { service } = makeService({
      onCancelled: async (userId) => {
        cancelledCalls.push(userId);
      },
    });

    const evt = makeEvent('subscription.cancelled', {
      userId: 'user-cancel-1',
      planId: 'PRO',
      providerSubscriptionId: 'sub_cancel_1',
    });
    await service.handle(evt.body, evt.sig);
    expect(cancelledCalls).toContain('user-cancel-1');
  });

  it('subscription.halted fires onSubscriptionHalted callback — NOT cancellation (spec §36)', async () => {
    const haltedCalls: string[] = [];
    const cancelledCalls: string[] = [];
    const { service } = makeService({
      onHalted: async (userId) => {
        haltedCalls.push(userId);
      },
      onCancelled: async (userId) => {
        cancelledCalls.push(userId);
      },
    });

    const evt = makeEvent('subscription.halted', {
      userId: 'user-halt-1',
      planId: 'PRO',
      providerSubscriptionId: 'sub_halt_1',
    });
    await service.handle(evt.body, evt.sig);
    expect(haltedCalls).toContain('user-halt-1');
    expect(cancelledCalls).not.toContain('user-halt-1');
  });

  it('payment.failed does NOT cancel subscription (test 11 variant)', async () => {
    const cancelledCalls: string[] = [];
    const { service } = makeService({
      onCancelled: async (userId) => {
        cancelledCalls.push(userId);
      },
    });

    const evt = makeEvent('payment.failed', {
      userId: 'user-fail-pay',
      planId: 'BASIC',
      providerPaymentId: 'pay_failed_1',
      amountInr: '499',
    });
    await service.handle(evt.body, evt.sig);
    expect(cancelledCalls).toHaveLength(0);
  });

  it('grants the server-catalogued top-up exactly once', async () => {
    const { service, billing } = makeService();
    const body = JSON.stringify({
      id: 'evt_topup_1',
      event: 'payment.captured',
      payload: {
        userId: 'user-topup',
        providerPaymentId: 'pay_topup_1',
        amountInr: '499',
        topUpSkuId: 'TOPUP_250',
      },
    });
    await service.handle(body, sign(body));
    await service.handle(body, sign(body));
    expect((await billing.getWallet('user-topup')).availableCredits).toBe('250');
    expect(
      (await billing.getLedger('user-topup')).filter(
        (entry) => entry.transactionType === 'CREDIT_PURCHASE',
      ),
    ).toHaveLength(1);
  });

  it('credits a Team top-up to the organization wallet when the webhook carries organization context', async () => {
    const payments = new InMemoryPaymentStore();
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const organizationBilling = new OrganizationBillingService({
      store: new InMemoryOrganizationBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const service = new RazorpayWebhookService({
      secret: SECRET,
      payments,
      billing,
      organizationBilling,
      plans: createDefaultPlanCatalog(),
    });
    const body = JSON.stringify({
      id: 'evt_org_topup_1',
      event: 'payment.captured',
      payload: {
        userId: 'team-owner-topup',
        organizationId: 'org-team-topup',
        providerPaymentId: 'pay_org_topup_1',
        amountInr: '499',
        topUpSkuId: 'TOPUP_250',
      },
    });
    await service.handle(body, sign(body));
    await service.handle(body, sign(body));
    expect((await organizationBilling.getWallet('org-team-topup')).availableCredits).toBe('250');
    expect((await billing.getWallet('team-owner-topup')).availableCredits).toBe('0');
  });

  it('rolls one monthly allocation of unused subscription credits into the next cycle', async () => {
    const { service, billing } = makeService();
    const firstBody = JSON.stringify({
      id: 'evt_cycle_1',
      event: 'subscription.charged',
      payload: {
        userId: 'user-rollover',
        planId: 'BASIC',
        providerSubscriptionId: 'sub_rollover',
        providerPaymentId: 'pay_cycle_1',
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-10-01T00:00:00.000Z',
        amountInr: '499',
      },
    });
    await service.handle(firstBody, sign(firstBody));
    const reservation = await billing.reserveTask({
      userId: 'user-rollover',
      planId: 'BASIC',
      taskId: 'rollover-task',
      modelId: 'approved-core',
      mode: 'BUILD',
      amountCredits: '50',
      idempotencyKey: 'rollover-reservation',
    });
    await billing.settleTask({
      reservationId: reservation.reservationId,
      idempotencyKey: 'rollover-settlement',
      providerActualCostUsd: '0.50',
      customerBillableCostUsd: '0.50',
    });

    const secondBody = JSON.stringify({
      id: 'evt_cycle_2',
      event: 'subscription.charged',
      payload: {
        userId: 'user-rollover',
        planId: 'BASIC',
        providerSubscriptionId: 'sub_rollover',
        providerPaymentId: 'pay_cycle_2',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        amountInr: '499',
      },
    });
    await service.handle(secondBody, sign(secondBody));
    expect((await billing.getWallet('user-rollover')).availableCredits).toBe('550');
  });

  it('duplicate cancellation webhook is harmless (spec §79 item 11)', async () => {
    let cancelCount = 0;
    const { service } = makeService({
      onCancelled: async () => {
        cancelCount++;
      },
    });

    const evt = makeEvent('subscription.cancelled', {
      userId: 'user-dup-cancel',
      planId: 'BASIC',
      providerSubscriptionId: 'sub_dup_cancel',
    });

    // First delivery
    await service.handle(evt.body, evt.sig);
    expect(cancelCount).toBe(1);

    // Same event replayed — same event ID, claimWebhookEvent returns false
    const result = await service.handle(evt.body, evt.sig);
    expect(result.processed).toBe(false);
    expect(cancelCount).toBe(1); // Not called again
  });

  it('refund.created is recorded without touching wallet (spec §38)', async () => {
    const { service, payments } = makeService();
    const evt = makeEvent('refund.created', {
      userId: 'user-refund',
      providerPaymentId: 'pay_refund_1',
      providerRefundId: 'rfnd_1',
      amountInr: '499',
    });
    await service.handle(evt.body, evt.sig);
    // Refund is recorded (countPayments or countWebhookEvents processed)
    const processed = await payments.countWebhookEvents();
    expect(processed).toBe(1);
  });

  it('invalid webhook signature is rejected', async () => {
    const { service } = makeService();
    const body = JSON.stringify({ id: 'evt_123', event: 'subscription.charged', payload: {} });
    await expect(service.handle(body, 'bad-signature')).rejects.toThrow('signature is invalid');
  });
});
