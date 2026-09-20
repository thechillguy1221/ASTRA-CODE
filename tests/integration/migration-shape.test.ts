import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('database migration foundation', () => {
  it('contains safe workspace metadata, task records, usage receipts, and an immutable ledger shape', async () => {
    const migration = await readFile('packages/db/migrations/0001_agent_foundation.sql', 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS workspaces');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS agent_tasks');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS usage_receipts');
    expect(migration).toContain('actual_cost_usd');
    expect(migration).toContain('gateway_request_id');
    expect(migration).toContain('agent_session_id');
    expect(migration).toContain('calculated_expected_cost_usd');
    expect(migration).toContain('billing_anomaly');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS agent_events');
    expect(migration).toContain('prevent_credit_ledger_mutation');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS credit_ledger_entries');
    expect(migration).not.toContain('INSERT INTO credit_ledger_entries');
  });

  it('contains the authoritative commercial matrix and Room/rate-limit foundation', async () => {
    const migration = await readFile(
      'packages/db/migrations/0010_astra_commercial_matrix.sql',
      'utf8',
    );
    expect(migration).toContain("('BASIC', 'Basic', 499, 300");
    expect(migration).toContain("('TEAM', 'Team', 9999, 6000");
    expect(migration).toContain("('BUSINESS', 'Business', 19999, 12000");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS organizations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS room_invitations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS rate_limit_windows');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS organization_id');
    expect(migration).toContain('TOPUP_250');
  });
});
