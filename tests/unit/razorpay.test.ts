import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryBillingStore,
  BillingService,
  InMemoryPaymentStore,
  RazorpayWebhookService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';

describe('Razorpay webhook boundary', () => {
  it('processes the same successful subscription webhook five times once', async () => {
    const secret = 'deterministic-webhook-secret';
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const payments = new InMemoryPaymentStore();
    let assignedPlan: { userId: string; planId: string } | undefined;
    const service = new RazorpayWebhookService({
      secret,
      payments,
      billing,
      plans: createDefaultPlanCatalog(),
      onPlanGranted: async (userId, planId) => {
        assignedPlan = { userId, planId };
      },
    });
    const body = JSON.stringify({
      id: 'evt_subscription_1',
      event: 'subscription.charged',
      payload: {
        userId: 'user-payment',
        planId: 'STUDENT',
        providerSubscriptionId: 'sub_1',
        providerPaymentId: 'pay_1',
        periodStart: '2026-09-20T00:00:00.000Z',
        amountInr: '149',
      },
    });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.handle(body, signature)),
    );
    expect(results.filter((result) => result.processed)).toHaveLength(1);
    expect(await payments.countPayments()).toBe(1);
    expect(await payments.countWebhookEvents()).toBe(1);
    expect((await billing.getWallet('user-payment')).availableCredits).toBe('500');
    expect(
      (await billing.getLedger('user-payment')).filter(
        (entry) => entry.transactionType === 'SUBSCRIPTION_GRANT',
      ),
    ).toHaveLength(1);
    expect(assignedPlan).toEqual({ userId: 'user-payment', planId: 'STUDENT' });
  });

  it('rejects a webhook with an invalid signature', async () => {
    const service = new RazorpayWebhookService({
      secret: 'secret',
      payments: new InMemoryPaymentStore(),
      billing: new BillingService({
        store: new InMemoryBillingStore(),
        plans: createDefaultPlanCatalog(),
      }),
      plans: createDefaultPlanCatalog(),
    });
    await expect(service.handle('{}', 'wrong')).rejects.toThrow('signature');
  });
});
