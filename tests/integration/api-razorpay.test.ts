import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BillingService,
  InMemoryBillingStore,
  InMemoryPaymentStore,
  RazorpayWebhookService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';
import { buildApi } from '@lyntar/api';

describe('Razorpay API boundary', () => {
  it('accepts only server-verified webhook signatures and remains idempotent', async () => {
    const secret = 'route-test-secret';
    const planCatalog = createDefaultPlanCatalog();
    const billing = new BillingService({ store: new InMemoryBillingStore(), plans: planCatalog });
    const payments = new InMemoryPaymentStore();
    const webhook = new RazorpayWebhookService({ secret, payments, billing, plans: planCatalog });
    const app = buildApi({ razorpay: webhook });
    const body = {
      id: 'evt-route-1',
      event: 'subscription.charged',
      payload: {
        userId: 'user-route',
        planId: 'BASIC',
        providerSubscriptionId: 'sub-route',
        providerPaymentId: 'pay-route',
        periodStart: '2026-09-20T00:00:00.000Z',
        amountInr: '499',
      },
    };
    const rawBody = ` ${JSON.stringify(body)}\n`;
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    const headers = { 'content-type': 'application/json', 'x-razorpay-signature': signature };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/webhook',
      headers,
      payload: rawBody,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/payments/razorpay/webhook',
      headers,
      payload: rawBody,
    });
    expect(first.statusCode).toBe(200);
    expect(second.json().processed).toBe(false);
    expect(await payments.countPayments()).toBe(1);
    expect((await billing.getWallet('user-route')).availableCredits).toBe('300');
  });
});
