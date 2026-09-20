import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PaymentRecord, PaymentStore, SubscriptionRecord } from '@lyntar/billing';

function requireUuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error(`${label} must be a UUID for PostgreSQL payments`);
  return value;
}

function mapPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    paymentId: String(row.id),
    userId: String(row.user_id),
    providerPaymentId: String(row.provider_payment_id),
    providerOrderId: row.provider_order_id ? String(row.provider_order_id) : null,
    amountInr: String(row.amount_inr),
    status: row.status as PaymentRecord['status'],
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapSubscription(row: Record<string, unknown>): SubscriptionRecord {
  return {
    subscriptionId: String(row.id),
    userId: String(row.user_id),
    providerSubscriptionId: String(row.provider_subscription_id),
    planId: String(row.plan_id),
    status: row.status as SubscriptionRecord['status'],
    currentPeriodStart: row.current_period_start
      ? new Date(String(row.current_period_start)).toISOString()
      : new Date(0).toISOString(),
    currentPeriodEnd: row.current_period_end
      ? new Date(String(row.current_period_end)).toISOString()
      : null,
  };
}

export class PostgresPaymentStore implements PaymentStore {
  constructor(private readonly pool: Pool) {}

  async claimWebhookEvent(
    providerEventId: string,
    metadata: { eventType?: string; payloadHash?: string } = {},
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO payment_webhook_events
         (id, provider, provider_event_id, event_type, payload_hash, processed_at)
       VALUES ($1, 'razorpay', $2, $3, $4, now())
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING provider_event_id`,
      [
        randomUUID(),
        providerEventId,
        metadata.eventType ?? 'unknown',
        metadata.payloadHash ?? createHash('sha256').update(providerEventId).digest('hex'),
      ],
    );
    return result.rowCount === 1;
  }

  async releaseWebhookEvent(providerEventId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM payment_webhook_events WHERE provider = $1 AND provider_event_id = $2',
      ['razorpay', providerEventId],
    );
  }

  async savePayment(payment: PaymentRecord): Promise<PaymentRecord> {
    const result = await this.pool.query(
      `INSERT INTO payments
         (id, user_id, provider, provider_payment_id, provider_order_id, amount_inr, status, created_at, updated_at)
       VALUES ($1, $2, 'razorpay', $3, $4, $5, $6, $7, $7)
       ON CONFLICT (provider_payment_id) DO UPDATE SET
         provider_order_id = EXCLUDED.provider_order_id,
         amount_inr = EXCLUDED.amount_inr,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        randomUUID(),
        requireUuid(payment.userId, 'userId'),
        payment.providerPaymentId,
        payment.providerOrderId,
        payment.amountInr,
        payment.status,
        payment.createdAt,
      ],
    );
    return mapPayment(result.rows[0] as Record<string, unknown>);
  }

  async saveSubscription(subscription: SubscriptionRecord): Promise<SubscriptionRecord> {
    const result = await this.pool.query(
      `INSERT INTO subscriptions
         (id, user_id, provider, provider_subscription_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
       VALUES ($1, $2, 'razorpay', $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (provider_subscription_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = now()
       RETURNING *`,
      [
        randomUUID(),
        requireUuid(subscription.userId, 'userId'),
        subscription.providerSubscriptionId,
        subscription.planId,
        subscription.status,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      ],
    );
    return mapSubscription(result.rows[0] as Record<string, unknown>);
  }

  async findSubscriptionByProvider(
    providerSubscriptionId: string,
  ): Promise<SubscriptionRecord | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM subscriptions WHERE provider_subscription_id = $1',
      [providerSubscriptionId],
    );
    return result.rows[0] ? mapSubscription(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async updateSubscriptionStatus(
    providerSubscriptionId: string,
    status: SubscriptionRecord['status'],
    extra?: { cancelledAt?: string; haltedAt?: string },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE subscriptions
       SET status = $2,
           cancelled_at = COALESCE($3, cancelled_at),
           halted_at = COALESCE($4, halted_at),
           updated_at = now()
       WHERE provider_subscription_id = $1`,
      [providerSubscriptionId, status, extra?.cancelledAt ?? null, extra?.haltedAt ?? null],
    );
  }

  async saveRefund(
    refund: import('@lyntar/billing').RefundRecord,
  ): Promise<import('@lyntar/billing').RefundRecord> {
    await this.pool.query(
      `INSERT INTO payments
         (id, user_id, provider, provider_payment_id, amount_inr, status, refunded_at, created_at, updated_at)
       VALUES ($1, $2, 'razorpay', $3, $4, 'REFUNDED', now(), $5, now())
       ON CONFLICT (provider_payment_id) DO UPDATE SET
         status = 'REFUNDED',
         refunded_at = now(),
         updated_at = now()`,
      [
        refund.refundId,
        requireUuid(refund.userId, 'userId'),
        refund.providerPaymentId || refund.providerRefundId,
        refund.amountInr,
        refund.createdAt,
      ],
    );
    return refund;
  }

  async countPayments(): Promise<number> {
    const result = await this.pool.query('SELECT count(*)::int AS count FROM payments');
    return Number(result.rows[0]?.count ?? 0);
  }

  async countSubscriptions(): Promise<number> {
    const result = await this.pool.query('SELECT count(*)::int AS count FROM subscriptions');
    return Number(result.rows[0]?.count ?? 0);
  }

  async countWebhookEvents(): Promise<number> {
    const result = await this.pool.query(
      'SELECT count(*)::int AS count FROM payment_webhook_events WHERE provider = $1',
      ['razorpay'],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
