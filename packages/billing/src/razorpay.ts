import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PlanCatalog } from '@lyntar/plans';
import type { BillingService } from './service.js';

export interface PaymentRecord {
  paymentId: string;
  userId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountInr: string;
  status: 'CAPTURED' | 'FAILED' | 'REFUNDED';
  createdAt: string;
}

export interface SubscriptionRecord {
  subscriptionId: string;
  userId: string;
  providerSubscriptionId: string;
  planId: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
}

export interface PaymentStore {
  claimWebhookEvent(
    providerEventId: string,
    metadata?: { eventType?: string; payloadHash?: string },
  ): Promise<boolean>;
  releaseWebhookEvent(providerEventId: string): Promise<void>;
  savePayment(payment: PaymentRecord): Promise<PaymentRecord>;
  saveSubscription(subscription: SubscriptionRecord): Promise<SubscriptionRecord>;
  countPayments(): Promise<number>;
  countSubscriptions(): Promise<number>;
  countWebhookEvents(): Promise<number>;
}

export class InMemoryPaymentStore implements PaymentStore {
  private readonly events = new Set<string>();
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly subscriptions = new Map<string, SubscriptionRecord>();

  async claimWebhookEvent(providerEventId: string): Promise<boolean> {
    if (this.events.has(providerEventId)) return false;
    this.events.add(providerEventId);
    return true;
  }

  async releaseWebhookEvent(providerEventId: string): Promise<void> {
    this.events.delete(providerEventId);
  }

  async savePayment(payment: PaymentRecord): Promise<PaymentRecord> {
    const existing = this.payments.get(payment.providerPaymentId);
    if (existing) return existing;
    this.payments.set(payment.providerPaymentId, payment);
    return payment;
  }

  async saveSubscription(subscription: SubscriptionRecord): Promise<SubscriptionRecord> {
    const existing = this.subscriptions.get(subscription.providerSubscriptionId);
    if (existing) {
      const updated = { ...existing, ...subscription };
      this.subscriptions.set(subscription.providerSubscriptionId, updated);
      return updated;
    }
    this.subscriptions.set(subscription.providerSubscriptionId, subscription);
    return subscription;
  }

  async countPayments(): Promise<number> {
    return this.payments.size;
  }

  async countSubscriptions(): Promise<number> {
    return this.subscriptions.size;
  }

  async countWebhookEvents(): Promise<number> {
    return this.events.size;
  }
}

export class RazorpayWebhookService {
  constructor(
    private readonly options: {
      secret: string;
      payments: PaymentStore;
      billing: BillingService;
      plans: PlanCatalog;
      onPlanGranted?: (userId: string, planId: string) => Promise<void>;
    },
  ) {}

  async handle(
    rawBody: string,
    signature: string,
  ): Promise<{ processed: boolean; eventId: string }> {
    const expected = createHmac('sha256', this.options.secret).update(rawBody).digest('hex');
    const valid =
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) throw new Error('Razorpay webhook signature is invalid');
    const payload = JSON.parse(rawBody) as {
      id?: unknown;
      event?: unknown;
      payload?: Record<string, unknown>;
    };
    const eventId = typeof payload.id === 'string' ? payload.id : '';
    if (!eventId || typeof payload.event !== 'string' || !payload.payload)
      throw new Error('Razorpay webhook payload is invalid');
    const claimed = await this.options.payments.claimWebhookEvent(eventId, {
      eventType: payload.event,
      payloadHash: createHash('sha256').update(rawBody).digest('hex'),
    });
    if (!claimed) return { processed: false, eventId };
    try {
      const data = payload.payload;
      if (payload.event === 'subscription.charged') {
        const userId = String(data.userId);
        const planId = String(data.planId);
        const providerSubscriptionId = String(data.providerSubscriptionId);
        const providerPaymentId = String(data.providerPaymentId);
        const periodStart = String(data.periodStart);
        const plan = this.options.plans.get(planId);
        await this.options.payments.savePayment({
          paymentId: eventId,
          userId,
          providerPaymentId,
          providerOrderId: typeof data.providerOrderId === 'string' ? data.providerOrderId : null,
          amountInr: String(data.amountInr),
          status: 'CAPTURED',
          createdAt: new Date().toISOString(),
        });
        await this.options.payments.saveSubscription({
          subscriptionId: providerSubscriptionId,
          userId,
          providerSubscriptionId,
          planId,
          status: 'ACTIVE',
          currentPeriodStart: periodStart,
          currentPeriodEnd: typeof data.periodEnd === 'string' ? data.periodEnd : null,
        });
        await this.options.billing.grantCredits({
          userId,
          amountCredits: plan.monthlyCredits,
          transactionType: 'SUBSCRIPTION_GRANT',
          idempotencyKey: `subscription-grant:${providerSubscriptionId}:${periodStart}`,
          reason: `${plan.displayName} subscription period grant`,
          metadata: { provider: 'razorpay', providerPaymentId, providerEventId: eventId },
        });
        if (this.options.onPlanGranted) await this.options.onPlanGranted(userId, planId);
      }
      return { processed: true, eventId };
    } catch (error) {
      await this.options.payments.releaseWebhookEvent(eventId);
      throw error;
    }
  }
}
