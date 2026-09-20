import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { PlanCatalog } from '@lyntar/plans';
import type { BillingService } from './service.js';
import type { OrganizationBillingService } from './organization-service.js';
import { TOP_UP_250, getConfiguredCreditPack, topUpExpiresAt } from './buckets.js';

export interface PaymentRecord {
  paymentId: string;
  userId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountInr: string;
  status: 'CAPTURED' | 'FAILED' | 'REFUNDED';
  createdAt: string;
}

export interface RefundRecord {
  refundId: string;
  userId: string;
  providerPaymentId: string;
  providerRefundId: string;
  amountInr: string;
  status: 'PROCESSED' | 'DISPUTED';
  createdAt: string;
}

export interface SubscriptionRecord {
  subscriptionId: string;
  userId: string;
  providerSubscriptionId: string;
  planId: string;
  status: 'CREATED' | 'AUTHENTICATED' | 'ACTIVE' | 'PENDING' | 'HALTED' | 'CANCELLED' | 'COMPLETED';
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  cancelledAt?: string | null;
  haltedAt?: string | null;
}

export interface PaymentStore {
  claimWebhookEvent(
    providerEventId: string,
    metadata?: { eventType?: string; payloadHash?: string },
  ): Promise<boolean>;
  releaseWebhookEvent(providerEventId: string): Promise<void>;
  savePayment(payment: PaymentRecord): Promise<PaymentRecord>;
  saveSubscription(subscription: SubscriptionRecord): Promise<SubscriptionRecord>;
  findSubscriptionByProvider(
    providerSubscriptionId: string,
  ): Promise<SubscriptionRecord | undefined>;
  updateSubscriptionStatus(
    providerSubscriptionId: string,
    status: SubscriptionRecord['status'],
    extra?: { cancelledAt?: string; haltedAt?: string },
  ): Promise<void>;
  saveRefund(refund: RefundRecord): Promise<RefundRecord>;
  countPayments(): Promise<number>;
  countSubscriptions(): Promise<number>;
  countWebhookEvents(): Promise<number>;
}

export class InMemoryPaymentStore implements PaymentStore {
  private readonly events = new Set<string>();
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly refunds = new Map<string, RefundRecord>();

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

  async findSubscriptionByProvider(
    providerSubscriptionId: string,
  ): Promise<SubscriptionRecord | undefined> {
    return this.subscriptions.get(providerSubscriptionId);
  }

  async updateSubscriptionStatus(
    providerSubscriptionId: string,
    status: SubscriptionRecord['status'],
    extra?: { cancelledAt?: string; haltedAt?: string },
  ): Promise<void> {
    const existing = this.subscriptions.get(providerSubscriptionId);
    if (existing) {
      this.subscriptions.set(providerSubscriptionId, { ...existing, status, ...extra });
    }
  }

  async saveRefund(refund: RefundRecord): Promise<RefundRecord> {
    this.refunds.set(refund.providerRefundId, refund);
    return refund;
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
      organizationBilling?: OrganizationBillingService;
      plans: PlanCatalog;
      onPlanGranted?: (userId: string, planId: string, eventId: string) => Promise<void>;
      onSubscriptionCancelled?: (userId: string, planId: string, eventId: string) => Promise<void>;
      onSubscriptionHalted?: (userId: string, planId: string, eventId: string) => Promise<void>;
      onPaymentFailed?: (userId: string, eventId: string) => Promise<void>;
      onOrganizationEntitlementChanged?: (
        organizationId: string,
        actorUserId: string,
        planId: string,
        status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
        eventId: string,
      ) => Promise<void>;
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
      const event = payload.event;

      if (event === 'subscription.charged') {
        const userId = String(data.userId);
        const planId = String(data.planId);
        const providerSubscriptionId = String(data.providerSubscriptionId);
        const providerPaymentId = String(data.providerPaymentId);
        const periodStart = String(data.periodStart);
        const plan = this.options.plans.get(planId);
        const organizationId =
          typeof data.organizationId === 'string' && data.organizationId
            ? data.organizationId
            : null;
        if (plan.pooledCredits && (!organizationId || !this.options.organizationBilling))
          throw new Error('Pooled subscription requires an organization billing context');
        if (plan.pooledCredits && organizationId && this.options.organizationBilling)
          await this.options.organizationBilling.rolloverSubscriptionCredits({
            organizationId,
            actorUserId: userId,
            monthlyAllocation: plan.monthlyCredits,
            periodStart,
            newExpiresAt: typeof data.periodEnd === 'string' ? data.periodEnd : null,
            idempotencyKey: `subscription-rollover:${providerSubscriptionId}:${periodStart}`,
            referenceId: providerSubscriptionId,
          });
        else if (!plan.pooledCredits)
          await this.options.billing.rolloverSubscriptionCredits({
            userId,
            monthlyAllocation: plan.monthlyCredits,
            periodStart,
            newExpiresAt: typeof data.periodEnd === 'string' ? data.periodEnd : null,
            idempotencyKey: `subscription-rollover:${providerSubscriptionId}:${periodStart}`,
            referenceId: providerSubscriptionId,
          });
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
        if (organizationId && this.options.organizationBilling) {
          await this.options.organizationBilling.grantCredits({
            organizationId,
            actorUserId: userId,
            amountCredits: plan.monthlyCredits,
            transactionType: 'SUBSCRIPTION_GRANT',
            idempotencyKey: `subscription-cycle:${providerSubscriptionId}:${periodStart}`,
            reason: `${plan.displayName} organization subscription period grant`,
            sourceType: 'subscription_monthly',
            planCycle: periodStart,
            expiresAt: typeof data.periodEnd === 'string' ? data.periodEnd : null,
            referenceId: providerSubscriptionId,
            metadata: { provider: 'razorpay', providerPaymentId, providerEventId: eventId },
          });
        } else {
          await this.options.billing.grantCredits({
            userId,
            amountCredits: plan.monthlyCredits,
            transactionType: 'SUBSCRIPTION_GRANT',
            idempotencyKey: `subscription-cycle:${providerSubscriptionId}:${periodStart}`,
            reason: `${plan.displayName} subscription period grant`,
            sourceType: 'subscription_monthly',
            planCycle: periodStart,
            expiresAt: typeof data.periodEnd === 'string' ? data.periodEnd : null,
            referenceId: providerSubscriptionId,
            metadata: { provider: 'razorpay', providerPaymentId, providerEventId: eventId },
          });
        }
        if (organizationId && this.options.onOrganizationEntitlementChanged)
          await this.options.onOrganizationEntitlementChanged(
            organizationId,
            userId,
            planId,
            'ACTIVE',
            eventId,
          );
        if (this.options.onPlanGranted) await this.options.onPlanGranted(userId, planId, eventId);
      } else if (event === 'subscription.authenticated') {
        const userId = String(data.userId);
        const planId = String(data.planId);
        const providerSubscriptionId = String(data.providerSubscriptionId);
        await this.options.payments.saveSubscription({
          subscriptionId: providerSubscriptionId,
          userId,
          providerSubscriptionId,
          planId,
          status: 'AUTHENTICATED',
          currentPeriodStart: new Date().toISOString(),
          currentPeriodEnd: null,
        });
      } else if (event === 'subscription.activated') {
        const providerSubscriptionId = String(data.providerSubscriptionId);
        await this.options.payments.updateSubscriptionStatus(providerSubscriptionId, 'ACTIVE');
      } else if (event === 'subscription.pending') {
        const providerSubscriptionId = String(data.providerSubscriptionId);
        await this.options.payments.updateSubscriptionStatus(providerSubscriptionId, 'PENDING');
      } else if (event === 'subscription.halted') {
        const userId = String(data.userId);
        const planId = String(data.planId);
        const organizationId =
          typeof data.organizationId === 'string' && data.organizationId
            ? data.organizationId
            : null;
        const providerSubscriptionId = String(data.providerSubscriptionId);
        await this.options.payments.updateSubscriptionStatus(providerSubscriptionId, 'HALTED', {
          haltedAt: new Date().toISOString(),
        });
        if (this.options.onSubscriptionHalted)
          await this.options.onSubscriptionHalted(userId, planId, eventId);
        if (organizationId && this.options.onOrganizationEntitlementChanged)
          await this.options.onOrganizationEntitlementChanged(
            organizationId,
            userId,
            'FREE',
            'CLOSED',
            eventId,
          );
      } else if (event === 'subscription.cancelled' || event === 'subscription.completed') {
        const userId = String(data.userId);
        const planId = String(data.planId);
        const organizationId =
          typeof data.organizationId === 'string' && data.organizationId
            ? data.organizationId
            : null;
        const providerSubscriptionId = String(data.providerSubscriptionId);
        const status = event === 'subscription.cancelled' ? 'CANCELLED' : 'COMPLETED';
        await this.options.payments.updateSubscriptionStatus(providerSubscriptionId, status, {
          cancelledAt: new Date().toISOString(),
        });
        // IMMEDIATE FREE: spec §32 — paid access ends immediately
        if (this.options.onSubscriptionCancelled)
          await this.options.onSubscriptionCancelled(userId, planId, eventId);
        if (organizationId && this.options.onOrganizationEntitlementChanged)
          await this.options.onOrganizationEntitlementChanged(
            organizationId,
            userId,
            'FREE',
            'CLOSED',
            eventId,
          );
      } else if (event === 'payment.captured') {
        const userId = String(data.userId);
        const providerPaymentId = String(data.providerPaymentId);
        const topUpSkuId = typeof data.topUpSkuId === 'string' ? data.topUpSkuId : null;
        const organizationId =
          typeof data.organizationId === 'string' && data.organizationId
            ? data.organizationId
            : null;
        if (topUpSkuId) {
          const amountInr = String(data.amountInr ?? '');
          const isLegacyTopUp = topUpSkuId === TOP_UP_250.id && amountInr === TOP_UP_250.priceInr;
          const configuredPack = (() => {
            try {
              return getConfiguredCreditPack(topUpSkuId);
            } catch {
              return null;
            }
          })();
          const isCurrentIndiaTopUp =
            configuredPack?.prices.INDIA.currency === 'INR' &&
            configuredPack.prices.INDIA.amount === amountInr;
          if (!isLegacyTopUp && !isCurrentIndiaTopUp)
            throw new Error('Top-up payment does not match the server catalog');
          const pack: { credits: string; displayName: string; validityDays: number } =
            configuredPack
              ? {
                  credits: configuredPack.credits,
                  displayName: `${configuredPack.credits} credits`,
                  validityDays: configuredPack.validityDays,
                }
              : {
                  credits: TOP_UP_250.credits,
                  displayName: TOP_UP_250.displayName,
                  validityDays: TOP_UP_250.validityDays,
                };
          const purchasedAt = new Date().toISOString();
          if (organizationId && this.options.organizationBilling) {
            await this.options.organizationBilling.grantCredits({
              organizationId,
              actorUserId: userId,
              amountCredits: pack.credits,
              transactionType: 'CREDIT_PURCHASE',
              idempotencyKey: `topup:${providerPaymentId}`,
              reason: `${pack.displayName} organization top-up purchase`,
              sourceType: 'purchased_topup',
              expiresAt: topUpExpiresAt(purchasedAt, pack.validityDays),
              referenceId: providerPaymentId,
              metadata: { provider: 'razorpay', providerEventId: eventId, topUpSkuId },
            });
          } else {
            await this.options.billing.grantCredits({
              userId,
              amountCredits: pack.credits,
              transactionType: 'CREDIT_PURCHASE',
              idempotencyKey: `topup:${providerPaymentId}`,
              reason: `${pack.displayName} top-up purchase`,
              sourceType: 'purchased_topup',
              expiresAt: topUpExpiresAt(purchasedAt, pack.validityDays),
              referenceId: providerPaymentId,
              metadata: { provider: 'razorpay', providerEventId: eventId, topUpSkuId },
            });
          }
        }
        await this.options.payments.savePayment({
          paymentId: eventId,
          userId,
          providerPaymentId,
          providerOrderId: typeof data.providerOrderId === 'string' ? data.providerOrderId : null,
          amountInr: String(data.amountInr),
          status: 'CAPTURED',
          createdAt: new Date().toISOString(),
        });
      } else if (event === 'payment.failed') {
        const userId = String(data.userId);
        const providerPaymentId = String(data.providerPaymentId ?? eventId);
        await this.options.payments.savePayment({
          paymentId: eventId,
          userId,
          providerPaymentId,
          providerOrderId: null,
          amountInr: String(data.amountInr ?? '0'),
          status: 'FAILED',
          createdAt: new Date().toISOString(),
        });
        // NOTE: payment.failed does NOT cancel subscription — Razorpay retries
        if (this.options.onPaymentFailed) await this.options.onPaymentFailed(userId, eventId);
      } else if (event === 'refund.created') {
        const userId = String(data.userId);
        const providerRefundId = String(data.providerRefundId ?? eventId);
        const providerPaymentId = String(data.providerPaymentId ?? '');
        await this.options.payments.saveRefund({
          refundId: randomUUID(),
          userId,
          providerPaymentId,
          providerRefundId,
          amountInr: String(data.amountInr ?? '0'),
          status: 'PROCESSED',
          createdAt: new Date().toISOString(),
        });
        // Wallet adjustment on refund is an explicit admin action, not automatic
      } else if (event === 'payment.dispute.created') {
        // Disputes flagged for admin review — no automatic wallet changes
        const userId = String(data.userId);
        const providerPaymentId = String(data.providerPaymentId ?? '');
        await this.options.payments.saveRefund({
          refundId: randomUUID(),
          userId,
          providerPaymentId,
          providerRefundId: eventId,
          amountInr: String(data.amountInr ?? '0'),
          status: 'DISPUTED',
          createdAt: new Date().toISOString(),
        });
      }

      return { processed: true, eventId };
    } catch (error) {
      await this.options.payments.releaseWebhookEvent(eventId);
      throw error;
    }
  }
}
