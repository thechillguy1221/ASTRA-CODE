import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('commercial database schema', () => {
  it('defines auth, plans, wallets, reservations, payments, and admin audit boundaries', async () => {
    const migration = [
      await readFile('packages/db/migrations/0001_agent_foundation.sql', 'utf8'),
      await readFile('packages/db/migrations/0002_v1_commercial.sql', 'utf8'),
    ].join('\n');
    for (const table of [
      'users',
      'device_sessions',
      'auth_sessions',
      'plans',
      'wallets',
      'wallet_buckets',
      'credit_reservations',
      'usage_settlements',
      'billing_periods',
      'subscription_credit_grants',
      'payments',
      'payment_webhook_events',
      'admin_audit_log',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(migration).toContain('UNIQUE (user_id, billing_period_id)');
    expect(migration).toContain('credit_ledger_entries_no_update');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('task_key text');
  });
});
