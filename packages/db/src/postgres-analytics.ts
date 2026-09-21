import type { Pool } from 'pg';
import type { EmailPreferenceStore } from '@astra/email';
import {
  NO_LIVE_DATA,
  type AdminAnalyticsPort,
  type AdminOverview,
  type AdminUsageRow,
} from '@astra/billing';

export class PostgresEmailPreferenceStore implements EmailPreferenceStore {
  constructor(private readonly pool: Pool) {}

  async get(
    userId: string,
  ): Promise<{ marketingAllowed: boolean; unsubscribedAt: string | null } | undefined> {
    const result = await this.pool.query(
      'SELECT marketing_allowed, unsubscribed_at FROM marketing_preferences WHERE user_id = $1',
      [userId],
    );
    const row = result.rows[0] as
      { marketing_allowed?: unknown; unsubscribed_at?: unknown } | undefined;
    return row
      ? {
          marketingAllowed: row.marketing_allowed === true,
          unsubscribedAt: row.unsubscribed_at
            ? new Date(String(row.unsubscribed_at)).toISOString()
            : null,
        }
      : undefined;
  }

  async set(
    userId: string,
    value: { marketingAllowed: boolean; unsubscribedAt: string | null },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO marketing_preferences (user_id, marketing_allowed, unsubscribed_at, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET marketing_allowed = EXCLUDED.marketing_allowed,
       unsubscribed_at = EXCLUDED.unsubscribed_at, updated_at = now()`,
      [userId, value.marketingAllowed, value.unsubscribedAt],
    );
  }
}

export class PostgresAdminAnalytics implements AdminAnalyticsPort {
  constructor(private readonly pool: Pool) {}

  async overview(): Promise<AdminOverview> {
    const result = await this.pool.query(`
      SELECT
        (SELECT count(*)::int FROM users) AS total_users,
        (SELECT count(*)::int FROM users WHERE email_verified_at IS NOT NULL) AS verified_users,
        (SELECT count(*)::int FROM users WHERE status = 'ACTIVE') AS active_users,
        (SELECT count(DISTINCT s.user_id)::int FROM agent_tasks t JOIN agent_sessions s ON s.id = t.session_id WHERE t.created_at >= date_trunc('day', now())) AS daily_active_users,
        (SELECT count(DISTINCT s.user_id)::int FROM agent_tasks t JOIN agent_sessions s ON s.id = t.session_id WHERE t.created_at >= now() - interval '30 days') AS monthly_active_users,
        (SELECT count(*)::int FROM users WHERE plan_id <> 'FREE' AND status = 'ACTIVE') AS paid_users,
        (SELECT count(*)::int FROM users WHERE plan_id = 'FREE' AND status = 'ACTIVE') AS free_users,
        (SELECT COALESCE(sum(available_delta_credits + consumed_delta_credits), 0)::text FROM credit_ledger_entries) AS credits_issued,
        (SELECT COALESCE(sum(consumed_delta_credits), 0)::text FROM credit_ledger_entries) AS credits_consumed,
        (SELECT COALESCE(sum(actual_cost_usd), 0)::text FROM usage_receipts) AS provider_cost_usd,
        (SELECT COALESCE(sum(customer_billable_cost_usd), 0)::text FROM usage_settlements) AS customer_cost_usd,
        (SELECT COALESCE(sum(absorbed_cost_usd), 0)::text FROM usage_settlements) AS absorbed_cost_usd,
        (SELECT COALESCE(sum(customer_billable_cost_usd), 0)::text FROM usage_settlements) AS revenue_usd,
        (SELECT COALESCE(sum(customer_billable_cost_usd - provider_actual_cost_usd), 0)::text FROM usage_settlements) AS gross_margin_usd,
        (SELECT CASE WHEN COALESCE(sum(customer_billable_cost_usd), 0) = 0 THEN NULL
                ELSE (sum(customer_billable_cost_usd - provider_actual_cost_usd) / sum(customer_billable_cost_usd) * 100)::float
              END FROM usage_settlements) AS gross_margin_percent,
        (SELECT count(*)::int FROM payments WHERE status = 'FAILED') AS payment_failures,
        (SELECT count(*)::int FROM usage_receipts WHERE billing_anomaly = true) AS billing_anomalies
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return this.noLiveOverview();
    return {
      dataStatus: 'LIVE',
      totalUsers: Number(row.total_users),
      verifiedUsers: Number(row.verified_users),
      activeUsers: Number(row.active_users),
      dailyActiveUsers: Number(row.daily_active_users),
      monthlyActiveUsers: Number(row.monthly_active_users),
      paidUsers: Number(row.paid_users),
      freeUsers: Number(row.free_users),
      creditsIssued: String(row.credits_issued),
      creditsConsumed: String(row.credits_consumed),
      providerCostUsd: String(row.provider_cost_usd),
      customerCostUsd: String(row.customer_cost_usd),
      absorbedCostUsd: String(row.absorbed_cost_usd),
      revenueUsd: String(row.revenue_usd),
      grossMarginUsd: String(row.gross_margin_usd),
      grossMarginPercent:
        row.gross_margin_percent === null ? null : Number(row.gross_margin_percent),
      paymentFailures: Number(row.payment_failures),
      billingAnomalies: Number(row.billing_anomalies),
    };
  }

  async usage(): Promise<{ dataStatus: 'LIVE' | typeof NO_LIVE_DATA; rows: AdminUsageRow[] }> {
    const result = await this.pool.query(`
      SELECT model_id, COALESCE(provider, 'unknown') AS provider,
        count(*)::int AS requests,
        COALESCE(sum(input_tokens), 0)::int AS input_tokens,
        COALESCE(sum(output_tokens), 0)::int AS output_tokens,
        sum(COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0))::int AS cache_tokens,
        sum(actual_cost_usd)::text AS provider_cost_usd
      FROM usage_receipts GROUP BY model_id, provider ORDER BY requests DESC
    `);
    const rows = result.rows.map((row) => ({
      modelId: String(row.model_id),
      provider: String(row.provider),
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cacheTokens: row.cache_tokens === null ? null : Number(row.cache_tokens),
      providerCostUsd: row.provider_cost_usd === null ? null : String(row.provider_cost_usd),
      customerCostUsd: null,
      credits: null,
    }));
    return { dataStatus: rows.length ? 'LIVE' : NO_LIVE_DATA, rows };
  }

  private noLiveOverview(): AdminOverview {
    return {
      dataStatus: NO_LIVE_DATA,
      totalUsers: null,
      verifiedUsers: null,
      activeUsers: null,
      dailyActiveUsers: null,
      monthlyActiveUsers: null,
      paidUsers: null,
      freeUsers: null,
      creditsIssued: null,
      creditsConsumed: null,
      providerCostUsd: null,
      customerCostUsd: null,
      absorbedCostUsd: null,
      revenueUsd: null,
      grossMarginUsd: null,
      grossMarginPercent: null,
      paymentFailures: null,
      billingAnomalies: null,
    };
  }
}
